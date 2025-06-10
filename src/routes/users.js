import express from "express";
import { query, transaction } from "../utils/db.js";
import { authMiddleware, adminMiddleware } from "../middleware/auth.js";

const router = express.Router();

/**
 * @route GET /api/users/users-management
 * @desc Получить список всех пользователей с информацией о Viber
 * @access Private
 */
router.get("/users-management", authMiddleware, async (req, res) => {
    try {
        const users = await query(`
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
        
        res.json(users);
    } catch (err) {
        console.error("Ошибка в /api/users/users-management:", err);
        res.status(500).json({ 
            error: "Database error", 
            details: err.message 
        });
    }
});

/**
 * @route PUT /api/users/:id
 * @desc Обновить информацию о пользователе
 * @access Private
 */
router.put("/:id", authMiddleware, async (req, res) => {
    const { id } = req.params;
    const { full_name, phone } = req.body;

    if (!full_name || !phone) {
        return res.status(400).json({ 
            error: "Не все поля заполнены",
            details: "Требуются поля full_name и phone"
        });
    }

    try {
        await query(
            `UPDATE users 
             SET full_name = ?, 
                 phone = ?
             WHERE id = ?`,
            [full_name, phone, id]
        );

        res.json({ 
            message: "Данные пользователя обновлены",
            user: { id, full_name, phone }
        });
    } catch (err) {
        console.error("Ошибка обновления пользователя:", err);
        res.status(500).json({ 
            error: "Database error", 
            details: err.message 
        });
    }
});

/**
 * @route POST /api/users/:id/disconnect-viber
 * @desc Отключить пользователя от Viber
 * @access Private
 */
router.post("/:id/disconnect-viber", authMiddleware, async (req, res) => {
    const { id } = req.params;

    try {
        const result = await query(
            `UPDATE users 
             SET viber_id = NULL,
                 notifications_enabled = 1,
                 reminder_day = 25,
                 viber_details = NULL
             WHERE id = ?`,
            [id]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ 
                error: "Пользователь не найден",
                details: `Пользователь с ID ${id} не существует`
            });
        }

        res.json({ 
            message: "Пользователь успешно отключен от Viber",
            userId: id
        });
    } catch (err) {
        console.error("Ошибка при отключении пользователя от Viber:", err);
        res.status(500).json({ 
            error: "Database error", 
            details: err.message 
        });
    }
});

/**
 * @route GET /api/users/:id/readings
 * @desc Получить историю показаний пользователя
 * @access Private
 */
router.get("/:id/readings", authMiddleware, async (req, res) => {
    const { id } = req.params;

    try {
        const readings = await query(
            `SELECT reading_date, value 
             FROM readings 
             WHERE user_id = ? 
             ORDER BY reading_date DESC`,
            [id]
        );

        res.json(readings);
    } catch (err) {
        console.error("Ошибка получения показаний:", err);
        res.status(500).json({ 
            error: "Database error", 
            details: err.message 
        });
    }
});

/**
 * @route GET /api/users/:id/payments
 * @desc Получить историю платежей пользователя
 * @access Private
 */
router.get("/:id/payments", authMiddleware, async (req, res) => {
    const { id } = req.params;

    try {
        const payments = await query(
            `SELECT 
                p.payment_date, 
                p.paid_reading, 
                p.debt,
                (SELECT value 
                 FROM tariff 
                 WHERE effective_date <= p.payment_date 
                 ORDER BY effective_date DESC 
                 LIMIT 1) AS tariff
             FROM payments p
             WHERE p.user_id = ?
             ORDER BY p.payment_date DESC`,
            [id]
        );

        res.json(payments);
    } catch (err) {
        console.error("Ошибка получения платежей:", err);
        res.status(500).json({ 
            error: "Database error", 
            details: err.message 
        });
    }
});

export default router; 