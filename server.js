// server.js

import express from "express";
import path from "path";
import cors from "cors";
import mysql from "mysql2/promise";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server is running at http://localhost:${PORT}`);
});

// Для совместимости с __dirname в ES-модулях
import { fileURLToPath } from "url";
import { dirname } from "path";
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Подключение к MySQL
const db = await mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
});

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public"))); // отдаёт index.html

// Главная страница
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public/index.html"));
});

// API: получить пользователей и последние показания
app.get("/api/users", async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT u.id, u.plot_number, u.full_name, u.phone,
             r.reading_date, r.value AS last_reading
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
      ORDER BY u.plot_number
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "Database error", details: err.message });
  }
});

// API: добавить новое показание
app.post("/api/readings", async (req, res) => {
  const { user_id, reading_date, value } = req.body;
  if (!user_id || !reading_date || !value) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  try {
    await db.query(
      `INSERT INTO readings (user_id, reading_date, value) VALUES (?, ?, ?)`,
      [user_id, reading_date, value]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Database insert error", details: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`✅ Server is running at http://localhost:${PORT}`);
});


app.use(express.json()); // уже должен быть включён

// Обновить пользователя
app.put("/api/users/:id", async (req, res) => {
  const { id } = req.params;
  const { plot_number, full_name, phone } = req.body;

  try {
    const [result] = await db.execute(
      "UPDATE users SET plot_number = ?, full_name = ?, phone = ? WHERE id = ?",
      [plot_number, full_name, phone, id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json({ message: "User updated" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error updating user" });
  }
});

async function loadUsers() {
  try {
    const res = await fetch("/api/users");
    const data = await res.json();

    if (!Array.isArray(data)) {
      throw new Error("Сервер вернул не массив");
    }

    userSelect.innerHTML = '<option selected disabled>Выберите пользователя</option>';
    data.forEach(user => {
      const opt = document.createElement("option");
      opt.value = user.id;
      opt.textContent = `${user.plot_number} — ${user.full_name}`;
      userSelect.appendChild(opt);
    });
  } catch (err) {
    console.error("Ошибка загрузки пользователей:", err);
    message.textContent = "❌ Не удалось загрузить список пользователей";
    message.className = "text-danger";
  }
}
