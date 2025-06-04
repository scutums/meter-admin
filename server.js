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
      SELECT u.id, u.plot_number, u.full_name, u.phone,
             r.reading_date, r.value AS last_reading,
             (
               SELECT r2.value FROM readings r2
               WHERE r2.user_id = u.id AND r2.reading_date < r.reading_date
               ORDER BY r2.reading_date DESC LIMIT 1
             ) AS prev_reading,
             (
               SELECT r2.reading_date FROM readings r2
               WHERE r2.user_id = u.id AND r2.reading_date < r.reading_date
               ORDER BY r2.reading_date DESC LIMIT 1
             ) AS prev_date
      FROM users u
      LEFT JOIN (
        SELECT r1.* FROM readings r1
        INNER JOIN (
          SELECT user_id, MAX(reading_date) AS max_date
          FROM readings GROUP BY user_id
        ) r2 ON r1.user_id = r2.user_id AND r1.reading_date = r2.max_date
      ) r ON u.id = r.user_id
      ORDER BY u.plot_number
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "Database error", details: err.message });
  }
});

app.post("/api/readings", authMiddleware, async (req, res) => {
  const { user_id, reading_date, value } = req.body;
  if (!user_id || !reading_date || !value) {
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

app.put("/api/users/:id", authMiddleware, async (req, res) => {
  const { id } = req.params;
  const { plot_number, full_name, phone } = req.body;
  try {
    const [result] = await db.execute(
      "UPDATE users SET plot_number = ?, full_name = ?, phone = ? WHERE id = ?",
      [plot_number, full_name, phone, id]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Пользователь не найден" });
    }
    res.json({ message: "Пользователь обновлён" });
  } catch (err) {
    res.status(500).json({ message: "Ошибка обновления", details: err.message });
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
