import mysql from "mysql2/promise";
import dotenv from "dotenv";

dotenv.config();

/**
 * Конфигурация подключения к базе данных
 * @type {Object}
 */
const dbConfig = {
    host: process.env.DB_HOST,
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
};

/**
 * Пул соединений с базой данных
 * @type {Pool}
 */
let pool;

/**
 * Инициализирует пул соединений с базой данных
 * @returns {Promise<void>}
 * @throws {Error} Если не удалось подключиться к базе данных
 */
export async function initializePool() {
    try {
        pool = await mysql.createPool(dbConfig);
        console.log("✅ MySQL connection pool initialized");
    } catch (err) {
        console.error("❌ MySQL connection error:", err.message);
        throw new Error("Failed to initialize database connection");
    }
}

/**
 * Выполняет SQL запрос с параметрами
 * @param {string} sql - SQL запрос
 * @param {Array} params - Параметры запроса
 * @returns {Promise<Array>} Результат запроса
 * @throws {Error} Если произошла ошибка при выполнении запроса
 */
export async function query(sql, params = []) {
    try {
        const [rows] = await pool.query(sql, params);
        return rows;
    } catch (err) {
        console.error("Database query error:", err);
        throw new Error("Database query failed");
    }
}

/**
 * Выполняет транзакцию
 * @param {Function} callback - Функция, выполняющая операции в транзакции
 * @returns {Promise<any>} Результат выполнения транзакции
 * @throws {Error} Если произошла ошибка при выполнении транзакции
 */
export async function transaction(callback) {
    const connection = await pool.getConnection();
    await connection.beginTransaction();

    try {
        const result = await callback(connection);
        await connection.commit();
        return result;
    } catch (err) {
        await connection.rollback();
        throw err;
    } finally {
        connection.release();
    }
}

/**
 * Проверяет соединение с базой данных
 * @returns {Promise<boolean>} true если соединение активно
 */
export async function checkConnection() {
    try {
        await pool.query('SELECT 1');
        return true;
    } catch (err) {
        console.error("Database connection check failed:", err);
        return false;
    }
}

// Экспортируем пул для прямого доступа (если необходимо)
export { pool }; 