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
import PDFDocument from "pdfkit";
import axios from "axios";

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

// Middleware для защиты HTML файлов
function protectHtmlFiles(req, res, next) {
  if (req.path.endsWith('.html') && req.path !== '/login.html') {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      return res.redirect('/login.html');
    }
    const token = authHeader.split(" ")[1];
    try {
      jwt.verify(token, process.env.JWT_SECRET);
      next();
    } catch {
      res.redirect('/login.html');
    }
  } else {
    next();
  }
}

// Настройка статических файлов с защитой
app.use(express.static(path.join(__dirname, "public")));
app.use(protectHtmlFiles);

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
      ORDER BY 
        CASE 
          WHEN u.plot_number IN ('Ск1', 'Ск2', 'Ск3', 'Союз') THEN 1 
          ELSE 0 
        END,
        CAST(REGEXP_REPLACE(u.plot_number, '[^0-9]', '') AS UNSIGNED), 
        u.plot_number
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
      ORDER BY 
        CASE 
          WHEN u.plot_number IN ('Ск1', 'Ск2', 'Ск3', 'Союз') THEN 1 
          ELSE 0 
        END,
        CAST(REGEXP_REPLACE(u.plot_number, '[^0-9]', '') AS UNSIGNED), 
        u.plot_number
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
  try {
    const { user_id, reading_date, value } = req.body;
    
    // Добавляем показание
    const [result] = await db.query(
      "INSERT INTO readings (user_id, reading_date, value) VALUES (?, ?, ?)",
      [user_id, reading_date, value]
    );

    // Отправляем уведомление о новом показании
    try {
      await axios.post(`${process.env.BASE_URL || 'http://localhost:3000'}/api/viber/notify-reading`, {
        user_id,
        reading_date,
        value
      });
    } catch (err) {
      console.error("Error sending reading notification:", err);
    }

    res.json({ id: result.insertId });
  } catch (err) {
    console.error("Error in /api/readings:", err);
    res.status(500).json({ error: "Database error", details: err.message });
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
  try {
    console.log('Received payment request:', req.body);
    const { user_id, payment_date, paid_reading } = req.body;
    
    if (!user_id || !payment_date || paid_reading == null) {
      console.log('Missing required fields:', { user_id, payment_date, paid_reading });
      return res.status(400).json({ error: "Не все поля заполнены" });
    }

    // Получаем последнее показание
    const [[lastReading]] = await db.query(
      `SELECT value FROM readings WHERE user_id = ? ORDER BY reading_date DESC LIMIT 1`,
      [user_id]
    );

    console.log('Last reading:', lastReading);

    if (!lastReading) {
      console.log('No readings found for user:', user_id);
      return res.status(400).json({ error: "Нет показаний для пользователя" });
    }

    // Рассчитываем неоплаченные кВт⋅ч
    const unpaid_kwh = lastReading.value - paid_reading;
    console.log('Calculated unpaid_kwh:', unpaid_kwh);

    // Получаем текущий тариф
    const [[tariffRow]] = await db.query(
      `SELECT value FROM tariff WHERE effective_date <= ? ORDER BY effective_date DESC LIMIT 1`,
      [payment_date]
    );
    const tariff = tariffRow?.value || 4.75;
    console.log('Current tariff:', tariff);

    // Рассчитываем долг
    const debt = unpaid_kwh * tariff;
    console.log('Calculated debt:', debt);

    // Добавляем оплату
    const [result] = await db.query(
      `INSERT INTO payments (user_id, payment_date, paid_reading, unpaid_kwh, debt) 
       VALUES (?, ?, ?, ?, ?)`,
      [user_id, payment_date, paid_reading, unpaid_kwh, debt]
    );
    console.log('Payment inserted with ID:', result.insertId);

    // Отправляем уведомление о новой оплате
    try {
      await axios.post(`${process.env.BASE_URL || 'http://localhost:3000'}/api/viber/notify-payment`, {
        user_id,
        payment_date,
        paid_reading,
        tariff
      });
      console.log('Payment notification sent');
    } catch (err) {
      console.error("Error sending payment notification:", err);
    }

    res.json({ 
      id: result.insertId,
      unpaid_kwh,
      debt,
      tariff
    });
  } catch (err) {
    console.error("Error in /api/payments:", err);
    res.status(500).json({ error: "Database error", details: err.message });
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
      ORDER BY 
        CASE 
          WHEN u.plot_number IN ('Ск1', 'Ск2', 'Ск3', 'Союз') THEN 1 
          ELSE 0 
        END,
        CAST(REGEXP_REPLACE(u.plot_number, '[^0-9]', '') AS UNSIGNED), 
        u.plot_number
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
      ORDER BY 
        CASE 
          WHEN u.plot_number IN ('Ск1', 'Ск2', 'Ск3', 'Союз') THEN 1 
          ELSE 0 
        END,
        CAST(REGEXP_REPLACE(u.plot_number, '[^0-9]', '') AS UNSIGNED), 
        u.plot_number
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "Database error", details: err.message });
  }
});

// Получить показания за период
app.get("/api/readings", authMiddleware, async (req, res) => {
  try {
    const { from, to } = req.query;
    const [rows] = await db.query(`
      SELECT u.plot_number, u.full_name, r.reading_date, r.value
      FROM readings r
      JOIN users u ON r.user_id = u.id
      WHERE r.reading_date BETWEEN ? AND ?
      ORDER BY 
        CASE 
          WHEN u.plot_number IN ('Ск1', 'Ск2', 'Ск3', 'Союз') THEN 1 
          ELSE 0 
        END,
        CAST(REGEXP_REPLACE(u.plot_number, '[^0-9]', '') AS UNSIGNED), 
        u.plot_number, 
        r.reading_date
    `, [from, to]);
    res.json(rows);
  } catch (err) {
    console.error("Ошибка в /api/readings:", err);
    res.status(500).json({ error: "Database error", details: err.message });
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
       ORDER BY 
         CASE 
           WHEN u.plot_number IN ('Ск1', 'Ск2', 'Ск3', 'Союз') THEN 1 
           ELSE 0 
         END,
         CAST(REGEXP_REPLACE(u.plot_number, '[^0-9]', '') AS UNSIGNED), 
         u.plot_number
    `,
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
      ORDER BY 
        CASE 
          WHEN u.plot_number IN ('Ск1', 'Ск2', 'Ск3', 'Союз') THEN 1 
          ELSE 0 
        END,
        CAST(REGEXP_REPLACE(u.plot_number, '[^0-9]', '') AS UNSIGNED), 
        u.plot_number
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
      ORDER BY CAST(REGEXP_REPLACE(plot_number, '[^0-9]', '') AS UNSIGNED), plot_number
    `);
    
    res.json(rows);
  } catch (err) {
    console.error("Ошибка в /api/users-management:", err);
    res.status(500).json({ error: "Database error", details: err.message });
  }
});

// Функция для генерации PDF с показаниями
async function generateReadingsPDF(userId, db) {
  const [user] = await db.query("SELECT plot_number, full_name FROM users WHERE id = ?", [userId]);
  const [readings] = await db.query(
    "SELECT reading_date, value FROM readings WHERE user_id = ? ORDER BY reading_date DESC",
    [userId]
  );

  const doc = new PDFDocument({
    font: 'Helvetica'
  });
  const buffers = [];
  doc.on('data', buffers.push.bind(buffers));
  
  // Header
  doc.fontSize(20).text('Meter Readings Report', { align: 'center' });
  doc.moveDown();
  
  // User Information
  doc.fontSize(12);
  doc.text('Plot Number:', 50, doc.y);
  doc.text(user[0].plot_number, 150, doc.y);
  doc.moveDown();
  
  doc.text('Full Name:', 50, doc.y);
  doc.text(user[0].full_name, 150, doc.y);
  doc.moveDown();
  
  // Readings Table
  doc.fontSize(12).text('Readings History:', { underline: true });
  doc.moveDown();
  
  // Table Headers
  const tableTop = doc.y;
  doc.text('Date', 50, tableTop);
  doc.text('Reading', 250, tableTop);
  doc.moveDown();
  
  // Table Data
  readings.forEach(reading => {
    const date = new Date(reading.reading_date).toLocaleDateString('en-GB');
    doc.text(date, 50, doc.y);
    doc.text(reading.value.toString(), 250, doc.y);
    doc.moveDown();
  });
  
  doc.end();
  
  return new Promise((resolve, reject) => {
    doc.on('end', () => {
      const pdfData = Buffer.concat(buffers);
      resolve(pdfData);
    });
    doc.on('error', reject);
  });
}

// Функция для генерации PDF с оплатами
async function generatePaymentsPDF(userId, db) {
  const [user] = await db.query("SELECT plot_number, full_name FROM users WHERE id = ?", [userId]);
  const [payments] = await db.query(
    "SELECT payment_date, paid_reading, tariff, debt FROM payments WHERE user_id = ? ORDER BY payment_date DESC",
    [userId]
  );

  const doc = new PDFDocument({
    font: 'Helvetica'
  });
  const buffers = [];
  doc.on('data', buffers.push.bind(buffers));
  
  // Header
  doc.fontSize(20).text('Payments Report', { align: 'center' });
  doc.moveDown();
  
  // User Information
  doc.fontSize(12);
  doc.text('Plot Number:', 50, doc.y);
  doc.text(user[0].plot_number, 150, doc.y);
  doc.moveDown();
  
  doc.text('Full Name:', 50, doc.y);
  doc.text(user[0].full_name, 150, doc.y);
  doc.moveDown();
  
  // Payments Table
  doc.fontSize(12).text('Payment History:', { underline: true });
  doc.moveDown();
  
  // Table Headers
  const tableTop = doc.y;
  doc.text('Date', 50, tableTop);
  doc.text('Paid (kWh)', 150, tableTop);
  doc.text('Rate', 250, tableTop);
  doc.text('Amount', 350, tableTop);
  doc.text('Debt', 450, tableTop);
  doc.moveDown();
  
  // Table Data
  payments.forEach(payment => {
    const date = new Date(payment.payment_date).toLocaleDateString('en-GB');
    const sum = payment.paid_reading && payment.tariff ? (payment.paid_reading * payment.tariff).toFixed(2) : '-';
    doc.text(date, 50, doc.y);
    doc.text(payment.paid_reading?.toString() || '-', 150, doc.y);
    doc.text(payment.tariff?.toString() || '-', 250, doc.y);
    doc.text(sum, 350, doc.y);
    doc.text(payment.debt?.toString() || '-', 450, doc.y);
    doc.moveDown();
  });
  
  doc.end();
  
  return new Promise((resolve, reject) => {
    doc.on('end', () => {
      const pdfData = Buffer.concat(buffers);
      resolve(pdfData);
    });
    doc.on('error', reject);
  });
}

// Функция для генерации полного PDF-отчета
async function generateFullReportPDF(userId, db) {
  const [user] = await db.query("SELECT plot_number, full_name, phone, has_viber FROM users WHERE id = ?", [userId]);
  const [readings] = await db.query(
    "SELECT reading_date, value FROM readings WHERE user_id = ? ORDER BY reading_date DESC",
    [userId]
  );
  const [payments] = await db.query(
    "SELECT payment_date, paid_reading, tariff, debt FROM payments WHERE user_id = ? ORDER BY payment_date DESC",
    [userId]
  );

  const doc = new PDFDocument({
    font: 'Helvetica'
  });
  const buffers = [];
  doc.on('data', buffers.push.bind(buffers));
  
  // Header
  doc.fontSize(20).text('Complete Report', { align: 'center' });
  doc.moveDown();
  
  // User Information
  doc.fontSize(12);
  doc.text('Plot Number:', 50, doc.y);
  doc.text(user[0].plot_number, 150, doc.y);
  doc.moveDown();
  
  doc.text('Full Name:', 50, doc.y);
  doc.text(user[0].full_name, 150, doc.y);
  doc.moveDown();
  
  doc.text('Phone:', 50, doc.y);
  doc.text(user[0].phone || '-', 150, doc.y);
  doc.moveDown();
  
  doc.text('Viber:', 50, doc.y);
  doc.text(user[0].has_viber ? 'Registered' : 'Not Registered', 150, doc.y);
  doc.moveDown();
  
  // Readings
  doc.fontSize(14).text('Meter Readings History:', { underline: true });
  doc.moveDown();
  
  const readingsTableTop = doc.y;
  doc.fontSize(12);
  doc.text('Date', 50, readingsTableTop);
  doc.text('Reading', 250, readingsTableTop);
  doc.moveDown();
  
  readings.forEach(reading => {
    const date = new Date(reading.reading_date).toLocaleDateString('en-GB');
    doc.text(date, 50, doc.y);
    doc.text(reading.value.toString(), 250, doc.y);
    doc.moveDown();
  });
  
  doc.addPage();
  
  // Payments
  doc.fontSize(14).text('Payment History:', { underline: true });
  doc.moveDown();
  
  const paymentsTableTop = doc.y;
  doc.fontSize(12);
  doc.text('Date', 50, paymentsTableTop);
  doc.text('Paid (kWh)', 150, paymentsTableTop);
  doc.text('Rate', 250, paymentsTableTop);
  doc.text('Amount', 350, paymentsTableTop);
  doc.text('Debt', 450, paymentsTableTop);
  doc.moveDown();
  
  payments.forEach(payment => {
    const date = new Date(payment.payment_date).toLocaleDateString('en-GB');
    const sum = payment.paid_reading && payment.tariff ? (payment.paid_reading * payment.tariff).toFixed(2) : '-';
    doc.text(date, 50, doc.y);
    doc.text(payment.paid_reading?.toString() || '-', 150, doc.y);
    doc.text(payment.tariff?.toString() || '-', 250, doc.y);
    doc.text(sum, 350, doc.y);
    doc.text(payment.debt?.toString() || '-', 450, doc.y);
    doc.moveDown();
  });
  
  doc.end();
  
  return new Promise((resolve, reject) => {
    doc.on('end', () => {
      const pdfData = Buffer.concat(buffers);
      resolve(pdfData);
    });
    doc.on('error', reject);
  });
}

// Добавляем новые эндпоинты для PDF
app.get("/api/user-readings/:id/pdf", authMiddleware, async (req, res) => {
  try {
    const userId = req.params.id;
    const pdfData = await generateReadingsPDF(userId, db);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=readings_${userId}.pdf`);
    res.send(pdfData);
  } catch (err) {
    console.error("Ошибка при генерации PDF показаний:", err);
    res.status(500).json({ error: "Ошибка при формировании отчета" });
  }
});

app.get("/api/user-payments/:id/pdf", authMiddleware, async (req, res) => {
  try {
    const userId = req.params.id;
    const pdfData = await generatePaymentsPDF(userId, db);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=payments_${userId}.pdf`);
    res.send(pdfData);
  } catch (err) {
    console.error("Ошибка при генерации PDF оплат:", err);
    res.status(500).json({ error: "Ошибка при формировании отчета" });
  }
});

app.get("/api/user-report/:id/pdf", authMiddleware, async (req, res) => {
  try {
    const userId = req.params.id;
    const pdfData = await generateFullReportPDF(userId, db);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=full_report_${userId}.pdf`);
    res.send(pdfData);
  } catch (err) {
    console.error("Ошибка при генерации полного PDF:", err);
    res.status(500).json({ error: "Ошибка при формировании отчета" });
  }
});

// Функция для отправки напоминаний
async function sendReminders() {
  try {
    const today = new Date();
    const currentDay = today.getDate();
    const currentMonth = today.getMonth();
    const currentYear = today.getFullYear();

    // Получаем пользователей, у которых сегодня день напоминания
    const [users] = await db.query(
      `SELECT u.id, u.viber_id, u.plot_number, u.reminder_day 
       FROM users u 
       WHERE u.reminder_day = ? 
       AND u.viber_id IS NOT NULL 
       AND u.notifications_enabled = 1`,
      [currentDay]
    );

    for (const user of users) {
      // Проверяем, есть ли уже показания за текущий месяц
      const [readings] = await db.query(
        `SELECT id FROM readings 
         WHERE user_id = ? 
         AND MONTH(reading_date) = ? 
         AND YEAR(reading_date) = ?`,
        [user.id, currentMonth + 1, currentYear]
      );

      // Если показаний еще нет, отправляем напоминание
      if (readings.length === 0) {
        const message = `⏰ Напоминание по участку ${user.plot_number}:

❗️ Пожалуйста, не забудьте передать показания счетчика за текущий месяц.

Для передачи показаний используйте команду "показания" в меню бота.`;

        try {
          await axios.post(`${process.env.BASE_URL || 'http://localhost:3000'}/api/viber/send-message`, {
            viber_id: user.viber_id,
            message: message
          });

          // Логируем отправку напоминания
          await db.query(
            `INSERT INTO notifications (user_id, message, via, success) 
             VALUES (?, ?, 'viber', true)`,
            [user.id, `Отправлено напоминание о передаче показаний`]
          );
        } catch (err) {
          console.error(`Error sending reminder to user ${user.id}:`, err);
          
          // Логируем ошибку отправки
          await db.query(
            `INSERT INTO notifications (user_id, message, via, success) 
             VALUES (?, ?, 'viber', false)`,
            [user.id, `Ошибка отправки напоминания: ${err.message}`]
          );
        }
      }
    }
  } catch (err) {
    console.error("Error in sendReminders:", err);
  }
}

// Запускаем отправку напоминаний каждый день в 9:00
setInterval(() => {
  const now = new Date();
  if (now.getHours() === 9 && now.getMinutes() === 0) {
    sendReminders();
  }
}, 60000); // Проверяем каждую минуту

app.listen(PORT, () => {
  console.log(`✅ Server is running on port ${PORT}`);
});