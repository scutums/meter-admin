import express from "express";
import axios from "axios";

const VIBER_AUTH_TOKEN='507a9cdad4e7e728-44afb7e01b8d3350-b88a8c0308784366';

export default function viberRoutes(db) {
  const router = express.Router();

  // Webhook для Viber
  router.post("/webhook", async (req, res) => {
    try {
      const { event, sender, message } = req.body;

      // Проверяем, что это сообщение от пользователя
      if (event === "message" && message.type === "text") {
        const viber_id = sender.id;
        const message_text = message.text;

        // Логируем действие пользователя
        await db.query(
          `INSERT INTO bot_actions (viber_id, action_type, action_data) 
           VALUES (?, ?, ?)`,
          [viber_id, 'message', message_text]
        );

        // Проверяем, существует ли пользователь
        const [users] = await db.query("SELECT * FROM users WHERE viber_id = ?", [viber_id]);
        
        if (users.length === 0) {
          // Если пользователь не найден, отправляем сообщение о регистрации
          await sendViberMessage(viber_id, "Для начала работы с ботом, пожалуйста, зарегистрируйтесь на сайте.");
          await db.query(
            `INSERT INTO bot_actions (viber_id, action_type, action_data) 
             VALUES (?, ?, ?)`,
            [viber_id, 'unregistered_user', 'Попытка использования бота без регистрации']
          );
          return res.status(200).json({ status: "ok" });
        }

        // Обработка команд
        if (message_text.toLowerCase() === "инфо") {
          // Получаем информацию о пользователе
          const user = users[0];
          const [[tariffRow]] = await db.query(
            `SELECT value FROM tariff ORDER BY effective_date DESC LIMIT 1`
          );
          const tariff = tariffRow?.value || 4.75;

          const [[lastPayment]] = await db.query(
            `SELECT payment_date, paid_reading, debt, 
              (SELECT value FROM tariff WHERE effective_date <= payment_date ORDER BY effective_date DESC LIMIT 1) as tariff
             FROM payments WHERE user_id = ? ORDER BY payment_date DESC LIMIT 1`,
            [user.id]
          );

          const debt = lastPayment ? lastPayment.debt : null;
          const message = `Информация по участку ${user.plot_number}:\nДолг: ${debt ?? 'нет данных'}\nТекущий тариф: ${tariff}`;
          
          await sendViberMessage(viber_id, message);
          await db.query(
            `INSERT INTO bot_actions (viber_id, action_type, action_data) 
             VALUES (?, ?, ?)`,
            [viber_id, 'info_request', `Запрос информации по участку ${user.plot_number}`]
          );
        }
      }

      res.status(200).json({ status: "ok" });
    } catch (err) {
      console.error("Error processing webhook:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Новый маршрут для получения действий бота
  router.get("/bot-actions", async (req, res) => {
    try {
      const [actions] = await db.query(`
        SELECT 
          ba.id,
          ba.viber_id,
          u.plot_number,
          u.full_name,
          ba.action_type,
          ba.action_data,
          ba.created_at
        FROM bot_actions ba
        LEFT JOIN users u ON ba.viber_id = u.viber_id
        ORDER BY ba.created_at DESC
        LIMIT 100
      `);

      res.json(actions);
    } catch (err) {
      console.error("Error getting bot actions:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Функция для отправки сообщений в Viber
  async function sendViberMessage(viber_id, message) {
    try {
      await axios.post("https://chatapi.viber.com/pa/send_message", {
        receiver: viber_id,
        type: "text",
        text: message
      }, {
        headers: {
          "X-Viber-Auth-Token": process.env.VIBER_AUTH_TOKEN
        }
      });
    } catch (err) {
      console.error("Error sending Viber message:", err);
    }
  }

  router.post("/user-info", async (req, res) => {
    const { viber_id } = req.body;
    if (!viber_id) return res.status(400).json({ error: "viber_id обязателен" });

    try {
      const [users] = await db.query("SELECT * FROM users WHERE viber_id = ?", [viber_id]);
      if (users.length === 0) return res.status(404).json({ error: "Пользователь не найден" });
      const user = users[0];

      const [[tariffRow]] = await db.query(
        `SELECT value FROM tariff ORDER BY effective_date DESC LIMIT 1`
      );
      const tariff = tariffRow?.value || 4.75;

      const [[lastPayment]] = await db.query(
        `SELECT payment_date, paid_reading, debt, 
          (SELECT value FROM tariff WHERE effective_date <= payment_date ORDER BY effective_date DESC LIMIT 1) as tariff
         FROM payments WHERE user_id = ? ORDER BY payment_date DESC LIMIT 1`,
        [user.id]
      );

      const debt = lastPayment ? lastPayment.debt : null;

      const [readings] = await db.query(
        `SELECT reading_date, value 
         FROM readings 
         WHERE user_id = ? AND reading_date >= DATE_SUB(CURDATE(), INTERVAL 6 MONTH)
         ORDER BY reading_date DESC`,
        [user.id]
      );

      const message = `Информация по участку ${user.plot_number}: долг ${debt ?? 'нет данных'}`;
      await db.query(
        `INSERT INTO notifications (user_id, message, via, success) VALUES (?, ?, 'viber', true)`,
        [user.id, message]
      );

      res.json({
        plot_number: user.plot_number,
        full_name: user.full_name,
        debt,
        last_payment: lastPayment ? {
          date: lastPayment.payment_date,
          amount: lastPayment.paid_reading,
          tariff: lastPayment.tariff
        } : null,
        readings: readings.map(r => ({
          date: r.reading_date,
          value: r.value
        }))
      });
    } catch (err) {
      res.status(500).json({ error: "Ошибка сервера", details: err.message });
    }
  });

  return router;
} 