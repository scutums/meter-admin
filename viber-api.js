import express from "express";

export default function viberRoutes(db) {
  const router = express.Router();

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