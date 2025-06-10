import express from "express";
import path from "path";
import cors from "cors";
import mysql from "mysql2/promise";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname } from "path";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import viberRoutes from "./viber-api.js";
import { sendViberMessage, getCommandButtons } from './viber-api';

dotenv.config();

if (!process.env.JWT_SECRET) {
  console.error("\u274C JWT_SECRET не задан в .env");
  process.exit(1);
}

const app = express();
const PORT = process.env.PORT || 8080;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let db;
try {
  db = await mysql.createPool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
  });
  console.log("\u2705 MySQL connected");
} catch (err) {
  console.error("\u274C MySQL connection error:", err.message);
  process.exit(1);
}

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

// Добавляем маршруты Viber
app.use("/viber", viberRoutes(db));

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Нет токена" });
  }
  const token = authHeader.split(" ")[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch {
    res.status(401).json({ message: "Неверный токен" });
  }
}

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public/index.html"));
});

function getMonthRange(month) {
  // month: 'YYYY-MM'
  const [year, m] = month.split('-').map(Number);
  const firstDay = `${year}-${String(m).padStart(2, '0')}-01`;
  const lastDay = new Date(year, m, 0); // 0-й день следующего месяца = последний день текущего
  const lastDayStr = `${year}-${String(m).padStart(2, '0')}-${String(lastDay.getDate()).padStart(2, '0')}`;
  return { from: firstDay, to: lastDayStr };
}

app.get("/api/users", authMiddleware, async (req, res) => {
  try {
    const { month } = req.query;
    let rows;
    const sqlPeriod = `
      SELECT 
        u.id,
        u.plot_number,
        u.full_name,
        u.phone,
        r_last.id as reading_id,
        r_last.value AS last_reading,
        r_last.reading_date AS last_reading_date,
        r_prev.value AS prev_reading,
        r_prev.reading_date AS prev_reading_date,
        (r_last.value - IFNULL(r_prev.value, 0)) AS consumption,
        p.payment_date AS paid_date,
        p.paid_reading AS paid_kwh,
        p.id as payment_id
      FROM users u
      INNER JOIN (
        SELECT r1.*
        FROM readings r1
        INNER JOIN (
          SELECT user_id, MAX(reading_date) AS max_date
          FROM readings
          WHERE reading_date BETWEEN ? AND ?
          GROUP BY user_id
        ) r2 ON r1.user_id = r2.user_id AND r1.reading_date = r2.max_date
      ) r_last ON u.id = r_last.user_id
      LEFT JOIN (
        SELECT r1.*
        FROM readings r1
        INNER JOIN (
          SELECT user_id, MAX(reading_date) AS prev_date
          FROM readings
          WHERE (user_id, reading_date) NOT IN (
            SELECT user_id, MAX(reading_date)
            FROM readings
            WHERE reading_date BETWEEN ? AND ?
            GROUP BY user_id
          )
          GROUP BY user_id
        ) r2 ON r1.user_id = r2.user_id AND r1.reading_date = r2.prev_date
      ) r_prev ON u.id = r_prev.user_id
      LEFT JOIN (
        SELECT p1.*
        FROM payments p1
        INNER JOIN (
          SELECT user_id, MAX(payment_date) AS max_date
          FROM payments
          WHERE payment_date BETWEEN ? AND ?
          GROUP BY user_id
        ) p2 ON p1.user_id = p2.user_id AND p1.payment_date = p2.max_date
      ) p ON u.id = p.user_id
      ORDER BY u.plot_number
    `;
    const sqlAll = `
      SELECT 
        u.id,
        u.plot_number,
        u.full_name,
        u.phone,
        r_last.id as reading_id,
        r_last.value AS last_reading,
        r_last.reading_date AS last_reading_date,
        r_prev.value AS prev_reading,
        r_prev.reading_date AS prev_reading_date,
        (r_last.value - IFNULL(r_prev.value, 0)) AS consumption,
        p.payment_date AS paid_date,
        p.paid_reading AS paid_kwh,
        p.id as payment_id
      FROM users u
      LEFT JOIN (
        SELECT r1.*
        FROM readings r1
        INNER JOIN (
          SELECT user_id, MAX(reading_date) AS max_date
          FROM readings
          GROUP BY user_id
        ) r2 ON r1.user_id = r2.user_id AND r1.reading_date = r2.max_date
      ) r_last ON u.id = r_last.user_id
      LEFT JOIN (
        SELECT r1.*
        FROM readings r1
        INNER JOIN (
          SELECT user_id, MAX(reading_date) AS prev_date
          FROM readings
          WHERE (user_id, reading_date) NOT IN (
            SELECT user_id, MAX(reading_date)
            FROM readings
            GROUP BY user_id
          )
          GROUP BY user_id
        ) r2 ON r1.user_id = r2.user_id AND r1.reading_date = r2.prev_date
      ) r_prev ON u.id = r_prev.user_id
      LEFT JOIN (
        SELECT p1.*
        FROM payments p1
        INNER JOIN (
          SELECT user_id, MAX(payment_date) AS max_date
          FROM payments
          GROUP BY user_id
        ) p2 ON p1.user_id = p2.user_id AND p1.payment_date = p2.max_date
      ) p ON u.id = p.user_id
      ORDER BY u.plot_number
    `;
    if (month) {
      const { from, to } = getMonthRange(month);
      [rows] = await db.query(sqlPeriod, [from, to, from, to, from, to]);
      if (!rows || rows.length === 0) {
        return res.status(404).json({ error: `За выбранный период (${month}) данные отсутствуют.` });
      }
    } else {
      [rows] = await db.query(sqlAll);
    }
    res.json(rows);
  } catch (err) {
    console.error("Ошибка в /api/users:", err);
    res.status(500).json({ error: "Database error", details: err.message });
  }
});

app.post("/api/readings", authMiddleware, async (req, res) => {
  const { user_id, reading_date, value } = req.body;
  if (!user_id || !reading_date || value == null) {
    return res.status(400).json({ error: "Не все поля заполнены" });
  }

  try {
    // Проверяем, есть ли уже показания за эту дату
    const [existing] = await db.query(
      "SELECT id FROM readings WHERE user_id = ? AND reading_date = ?",
      [user_id, reading_date]
    );

    if (existing.length > 0) {
      return res.status(400).json({ 
        error: "Показания за эту дату уже существуют",
        details: "Нельзя ввести показания дважды за один день"
      });
    }

    // Добавляем показания
    await db.query(
      `INSERT INTO readings (user_id, reading_date, value) VALUES (?, ?, ?)`,
      [user_id, reading_date, value]
    );

    // Получаем информацию о пользователе и его настройках уведомлений
    const [userInfo] = await db.query(
      `SELECT viber_id, notifications_enabled, plot_number 
       FROM users 
       WHERE id = ?`,
      [user_id]
    );

    // Если у пользователя есть Viber ID и включены уведомления, отправляем сообщение
    if (userInfo[0]?.viber_id && userInfo[0]?.notifications_enabled) {
      const message = `📊 Новые показания по участку ${userInfo[0].plot_number}:
📅 Дата: ${new Date(reading_date).toLocaleDateString('ru-RU')}
⚡ Значение: ${value} кВт⋅ч`;

      try {
        await sendViberMessage(userInfo[0].viber_id, message, getCommandButtons());
        
        // Логируем отправку уведомления
        await db.query(
          `INSERT INTO bot_actions (viber_id, action_type, action_data) 
           VALUES (?, ?, ?)`,
          [userInfo[0].viber_id, 'reading_notification', `Уведомление о новых показаниях по участку ${userInfo[0].plot_number}`]
        );
      } catch (error) {
        console.error('Ошибка отправки уведомления:', error);
        // Не прерываем выполнение, если не удалось отправить уведомление
      }
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Ошибка вставки", details: err.message });
  }
});

app.delete("/api/readings/:id", authMiddleware, async (req, res) => {
  const { id } = req.params;
  try {
    await db.query("DELETE FROM readings WHERE id = ?", [id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Ошибка удаления", details: err.message });
  }
});

app.post("/api/payments", authMiddleware, async (req, res) => {
  const { user_id, payment_date, paid_reading } = req.body;

  if (!user_id || !payment_date || paid_reading == null) {
    return res.status(400).json({ message: "Не все поля заполнены" });
  }

  try {
    const [[lastReading]] = await db.query(
      `SELECT value FROM readings WHERE user_id = ? ORDER BY reading_date DESC LIMIT 1`,
      [user_id]
    );

    if (!lastReading) {
      return res.status(400).json({ message: "Нет показаний для пользователя" });
    }

    const unpaid_kwh = lastReading.value - paid_reading;

    const [[tariffRow]] = await db.query(
      `SELECT value FROM tariff WHERE effective_date <= ? ORDER BY effective_date DESC LIMIT 1`,
      [payment_date]
    );
    const tariff = tariffRow?.value || 4.75;
    const debt = unpaid_kwh * tariff;

    await db.query(
      `INSERT INTO payments (user_id, payment_date, paid_reading, unpaid_kwh, debt)
       VALUES (?, ?, ?, ?, ?)`,
      [user_id, payment_date, paid_reading, unpaid_kwh, debt]
    );

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: "Ошибка при добавлении оплаты", details: err.message });
  }
});

app.get("/api/users/:id", authMiddleware, async (req, res) => {
  const { id } = req.params;
  try {
    const [rows] = await db.query("SELECT id, plot_number, full_name, phone FROM users WHERE id = ?", [id]);
    if (rows.length === 0) return res.status(404).json({ message: "Пользователь не найден" });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: "Ошибка базы данных", details: err.message });
  }
});

app.put("/api/users/:id", authMiddleware, async (req, res) => {
  try {
    const userId = req.params.id;
    const { full_name, phone } = req.body;

    if (!full_name) {
      return res.status(400).json({ error: "ФИО обязательно для заполнения" });
    }

    const [result] = await db.query(
      "UPDATE users SET full_name = ?, phone = ? WHERE id = ?",
      [full_name, phone, userId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Пользователь не найден" });
    }

    res.json({ message: "Данные успешно обновлены" });
  } catch (err) {
    console.error("Ошибка при обновлении пользователя:", err);
    res.status(500).json({ error: "Database error", details: err.message });
  }
});

app.post("/api/login", async (req, res) => {
  const { login, password, captcha } = req.body;
  if (!login || !password) {
    return res.status(400).json({ message: "Логин и пароль обязательны" });
  }
  if (captcha !== '7') {
    return res.status(400).json({ message: "Неверная капча" });
  }
  try {
    const [users] = await db.query("SELECT * FROM users_auth WHERE login = ?", [login]);
    if (users.length === 0) return res.status(401).json({ message: "Неверные данные" });

    const user = users[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ message: "Неверные данные" });

    const token = jwt.sign({ id: user.id, login: user.login }, process.env.JWT_SECRET, {
      expiresIn: "1h",
    });
    res.json({ token });
  } catch (err) {
    res.status(500).json({ message: "Ошибка аутентификации", details: err.message });
  }
});


// Получить список тарифов
app.get("/api/tariffs", authMiddleware, async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT value, DATE_FORMAT(effective_date, '%Y-%m-%d') AS effective_date
      FROM tariff
      ORDER BY effective_date DESC
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: "Ошибка получения тарифов", details: err.message });
  }
});

// Получить последние показания по каждому пользователю
app.get("/api/last-readings", authMiddleware, async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT 
        u.id as user_id,
        u.plot_number,
        u.full_name,
        r.id as reading_id,
        r.reading_date,
        r.value
      FROM users u
      LEFT JOIN (
        SELECT r1.* FROM readings r1
        INNER JOIN (
          SELECT user_id, MAX(reading_date) AS max_date
          FROM readings
          GROUP BY user_id
        ) r2 ON r1.user_id = r2.user_id AND r1.reading_date = r2.max_date
      ) r ON u.id = r.user_id
      ORDER BY u.plot_number
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "Database error", details: err.message });
  }
});

// Получить последние оплаты по каждому пользователю
app.get("/api/last-payments", authMiddleware, async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT 
        u.id as user_id,
        u.plot_number,
        u.full_name,
        p.id as payment_id,
        p.payment_date,
        p.paid_reading,
        p.unpaid_kwh,
        p.debt
      FROM users u
      LEFT JOIN (
        SELECT p1.* FROM payments p1
        INNER JOIN (
          SELECT user_id, MAX(payment_date) AS max_date
          FROM payments
          GROUP BY user_id
        ) p2 ON p1.user_id = p2.user_id AND p1.payment_date = p2.max_date
      ) p ON u.id = p.user_id
      ORDER BY u.plot_number
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "Database error", details: err.message });
  }
});

// Получить показания за период
app.get("/api/readings", authMiddleware, async (req, res) => {
  const { from, to } = req.query;
  if (!from || !to) {
    return res.status(400).json({ error: "Необходимо указать параметры from и to" });
  }
  try {
    const [rows] = await db.query(`
      SELECT u.plot_number, u.full_name, r.reading_date, r.value
      FROM readings r
      JOIN users u ON r.user_id = u.id
      WHERE r.reading_date BETWEEN ? AND ?
      ORDER BY u.plot_number, r.reading_date
    `, [from, to]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "Ошибка получения показаний", details: err.message });
  }
});

// История показаний по пользователю
app.get("/api/user-readings/:id", authMiddleware, async (req, res) => {
  const { id } = req.params;
  try {
    const [rows] = await db.query(
      `SELECT reading_date, value FROM readings WHERE user_id = ? ORDER BY reading_date DESC`,
      [id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "Ошибка получения показаний", details: err.message });
  }
});

// История оплат по пользователю
app.get("/api/user-payments/:id", authMiddleware, async (req, res) => {
  const { id } = req.params;
  try {
    const [rows] = await db.query(
      `SELECT 
         p.payment_date, 
         p.paid_reading, 
         p.debt,
         (SELECT value FROM tariff WHERE effective_date <= p.payment_date ORDER BY effective_date DESC LIMIT 1) AS tariff
       FROM payments p
       WHERE p.user_id = ?
       ORDER BY p.payment_date DESC`,
      [id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "Ошибка получения оплат", details: err.message });
  }
});

// Удаление оплаты по id
app.delete("/api/payments/:id", authMiddleware, async (req, res) => {
  const { id } = req.params;
  try {
    await db.query("DELETE FROM payments WHERE id = ?", [id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Ошибка удаления оплаты", details: err.message });
  }
});

// Получить последние показания и оплаты по каждому пользователю
app.get("/api/payments/last-stats", authMiddleware, async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT
        u.id AS id,
        u.plot_number,
        u.full_name,
        r.value AS last_reading,
        r.reading_date AS last_reading_date,
        p.paid_reading,
        p.payment_date,
        p.id AS payment_id,
        p.unpaid_kwh,
        p.debt
      FROM users u
      LEFT JOIN (
        SELECT r1.*
        FROM readings r1
        INNER JOIN (
          SELECT user_id, MAX(reading_date) AS max_date
          FROM readings
          GROUP BY user_id
        ) r2 ON r1.user_id = r2.user_id AND r1.reading_date = r2.max_date
      ) r ON u.id = r.user_id
      LEFT JOIN (
        SELECT p1.*
        FROM payments p1
        INNER JOIN (
          SELECT user_id, MAX(payment_date) AS max_date
          FROM payments
          GROUP BY user_id
        ) p2 ON p1.user_id = p2.user_id AND p1.payment_date = p2.max_date
      ) p ON u.id = p.user_id
      ORDER BY u.plot_number
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "Ошибка получения последних данных", details: err.message });
  }
});

app.get("/api/auth-user-info", async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      return res.status(401).json({ message: "Нет токена" });
    }
    const token = authHeader.split(" ")[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const login = decoded.login;
    const [rows] = await db.query("SELECT full_name, plot_number, phone FROM users_auth WHERE login = ?", [login]);
    if (!rows.length) return res.status(404).json({ message: "Пользователь не найден" });
    res.json(rows[0]);
  } catch (err) {
    res.status(401).json({ message: "Ошибка авторизации" });
  }
});

// Маршрут для страницы действий бота
app.get('/bot-actions', (req, res) => {
    res.sendFile(path.join(__dirname, 'bot-actions.html'));
});

app.post("/api/users/:id/disconnect-viber", authMiddleware, async (req, res) => {
  try {
    const userId = req.params.id;

    const [result] = await db.query(
      `UPDATE users 
       SET viber_id = NULL,
           notifications_enabled = 1,
           reminder_day = 25,
           viber_details = NULL
       WHERE id = ?`,
      [userId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Пользователь не найден" });
    }

    res.json({ message: "Пользователь успешно отключен от Viber" });
  } catch (err) {
    console.error("Ошибка при отключении пользователя от Viber:", err);
    res.status(500).json({ error: "Database error", details: err.message });
  }
});

// Эндпоинт для страницы управления пользователями
app.get("/api/users-management", authMiddleware, async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT 
        id,
        plot_number,
        full_name,
        phone,
        viber_id,
        notifications_enabled,
        reminder_day,
        viber_details
      FROM users 
      ORDER BY plot_number
    `);
    
    res.json(rows);
  } catch (err) {
    console.error("Ошибка в /api/users-management:", err);
    res.status(500).json({ error: "Database error", details: err.message });
  }
});

// Переключение статуса уведомлений
app.post("/api/users/:id/toggle-notifications", authMiddleware, async (req, res) => {
  try {
    const userId = req.params.id;

    // Получаем текущий статус
    const [settings] = await db.query(
      "SELECT notifications_enabled FROM users WHERE id = ?",
      [userId]
    );

    if (settings.length === 0) {
      return res.status(404).json({ error: "Пользователь не найден" });
    }

    const newStatus = !settings[0].notifications_enabled;

    // Обновляем статус
    await db.query(
      "UPDATE users SET notifications_enabled = ? WHERE id = ?",
      [newStatus, userId]
    );

    res.json({ notifications_enabled: newStatus });
  } catch (err) {
    console.error("Ошибка при изменении статуса уведомлений:", err);
    res.status(500).json({ error: "Database error", details: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`✅ Server is running on port ${PORT}`);
});