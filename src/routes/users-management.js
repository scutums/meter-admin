import express from "express";
import { query } from "../utils/db.js";
import { authMiddleware } from "../middleware/auth.js";

const router = express.Router();

/**
 * @route GET /api/users-management/list
 * @desc Получить список всех пользователей
 * @access Private
 */
router.get("/list", authMiddleware, async (req, res) => {
    try {
        console.log("Fetching users data...");
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
        
        console.log(`Found ${users.length} users`);
        res.json(users);
    } catch (err) {
        console.error("Ошибка получения списка пользователей:", err);
        res.status(500).json({ 
            error: "Database error", 
            details: err.message,
            stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
        });
    }
});

/**
 * @route PUT /api/users-management/update/:id
 * @desc Обновить информацию о пользователе
 * @access Private
 */
router.put("/update/:id", authMiddleware, async (req, res) => {
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
 * @route POST /api/users-management/disconnect-viber/:id
 * @desc Отключить пользователя от Viber
 * @access Private
 */
router.post("/disconnect-viber/:id", authMiddleware, async (req, res) => {
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

export default router; 