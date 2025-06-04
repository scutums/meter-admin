import express from "express";
import path from "path";
import cors from "cors";
import mysql from "mysql2/promise";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname } from "path";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";

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

app.get("/api/users", authMiddleware, async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT 
        u.id,
        u.plot_number,
        u.full_name,
        u.phone,
        r_last.reading_date AS last_reading_date,
        r_last.value AS last_reading,
        r_prev.reading_date AS prev_reading_date,
        r_prev.value AS prev_reading,
        p.payment_date,
        p.paid_reading,
        p.unpaid_kwh,
        p.debt
      FROM users u
      LEFT JOIN (
        SELECT * FROM readings r1
        WHERE (r1.user_id, r1.reading_date) IN (
          SELECT user_id, MAX(reading_date)
          FROM readings
          GROUP BY user_id
        )
      ) r_last ON u.id = r_last.user_id
      LEFT JOIN (
        SELECT * FROM readings r1
        WHERE (r1.user_id, r1.reading_date) IN (
          SELECT user_id, MAX(reading_date)
          FROM readings
          WHERE (user_id, reading_date) NOT IN (
            SELECT user_id, MAX(reading_date)
            FROM readings
            GROUP BY user_id
          )
          GROUP BY user_id
        )
      ) r_prev ON u.id = r_prev.user_id
      LEFT JOIN (
        SELECT * FROM payments p1
        WHERE (p1.user_id, p1.payment_date) IN (
          SELECT user_id, MAX(payment_date)
          FROM payments
          GROUP BY user_id
        )
      ) p ON u.id = p.user_id
      ORDER BY u.plot_number
    `);

    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "Database error", details: err.message });
  }
});

app.post("/api/readings", authMiddleware, async (req, res) => {
  const { user_id, reading_date, value } = req.body;
  if (!user_id || !reading_date || value == null) {
    return res.status(400).json({ error: "Не все поля заполнены" });
  }
  try {
    await db.query(
      `INSERT INTO readings (user_id, reading_date, value) VALUES (?, ?, ?)`,
      [user_id, reading_date, value]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Ошибка вставки", details: err.message });
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

app.post("/api/login", async (req, res) => {
  const { login, password } = req.body;
  if (!login || !password) {
    return res.status(400).json({ message: "Логин и пароль обязательны" });
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

app.listen(PORT, () => {
  console.log(`\u2705 Server is running on port ${PORT}`);
});
