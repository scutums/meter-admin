import jwt from "jsonwebtoken";

/**
 * Middleware для проверки авторизации пользователя
 * Проверяет наличие и валидность JWT токена в заголовке Authorization
 * 
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 * @returns {void}
 */
export function authMiddleware(req, res, next) {
    // Получаем заголовок авторизации
    const authHeader = req.headers.authorization;
    
    // Проверяем наличие заголовка и его формат
    if (!authHeader?.startsWith("Bearer ")) {
        return res.status(401).json({ 
            message: "Нет токена авторизации",
            details: "Требуется токен в формате 'Bearer <token>'"
        });
    }

    // Извлекаем токен из заголовка
    const token = authHeader.split(" ")[1];

    try {
        // Проверяем валидность токена
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        // Добавляем информацию о пользователе в request
        req.user = decoded;
        
        // Передаем управление следующему middleware
        next();
    } catch (error) {
        // В случае ошибки валидации токена
        console.error("Ошибка авторизации:", error.message);
        res.status(401).json({ 
            message: "Неверный токен",
            details: "Токен недействителен или истек срок его действия"
        });
    }
}

/**
 * Middleware для проверки прав администратора
 * Должен использоваться после authMiddleware
 * 
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 * @returns {void}
 */
export function adminMiddleware(req, res, next) {
    // Проверяем, что пользователь авторизован
    if (!req.user) {
        return res.status(401).json({ 
            message: "Требуется авторизация",
            details: "Сначала выполните вход в систему"
        });
    }

    // Проверяем, что пользователь является администратором
    if (!req.user.isAdmin) {
        return res.status(403).json({ 
            message: "Доступ запрещен",
            details: "Требуются права администратора"
        });
    }

    next();
} 