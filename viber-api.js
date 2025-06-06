import express from "express";
import axios from "axios";

// Получаем токен из переменных окружения
const VIBER_AUTH_TOKEN = process.env.VIBER_AUTH_TOKEN || '507a9cdad4e7e728-44afb7e01b8d3350-b88a8c0308784366';

export default function viberRoutes(db) {
  const router = express.Router();

  // Функция для получения информации о пользователе Viber
  async function getViberUserDetails(viber_id) {
    try {
      console.log('Getting user details for:', viber_id);
      const response = await axios.post("https://chatapi.viber.com/pa/get_user_details", {
        id: viber_id
      }, {
        headers: {
          "X-Viber-Auth-Token": VIBER_AUTH_TOKEN
        }
      });
      console.log('Viber user details:', response.data);
      return response.data;
    } catch (err) {
      console.error("Error getting Viber user details:", err.response?.data || err.message);
      return null;
    }
  }

  // Функция для отправки сообщений в Viber
  async function sendViberMessage(viber_id, message) {
    try {
      console.log(`Sending message to ${viber_id}: ${message}`);
      console.log('Using Viber token:', VIBER_AUTH_TOKEN);
      
      const response = await axios.post("https://chatapi.viber.com/pa/send_message", {
        receiver: viber_id,
        type: "text",
        text: message
      }, {
        headers: {
          "X-Viber-Auth-Token": VIBER_AUTH_TOKEN
        }
      });
      console.log('Viber API response:', response.data);
    } catch (err) {
      console.error("Error sending Viber message:", err.response?.data || err.message);
    }
  }

  // Функция для расчета среднего расхода
  async function calculateAverageConsumption(userId, months = 3) {
    const [readings] = await db.query(
      `SELECT reading_date, value 
       FROM readings 
       WHERE user_id = ? 
       ORDER BY reading_date DESC 
       LIMIT ?`,
      [userId, months + 1]
    );

    if (readings.length < 2) return null;

    let totalConsumption = 0;
    for (let i = 0; i < readings.length - 1; i++) {
      totalConsumption += readings[i].value - readings[i + 1].value;
    }

    return Math.round(totalConsumption / (readings.length - 1));
  }

  // Webhook для Viber
  router.post("/webhook", async (req, res) => {
    try {
      console.log('Received webhook:', JSON.stringify(req.body, null, 2));
      const { event, sender, message } = req.body;

      // Проверяем, что это сообщение от пользователя
      if (event === "message" && message.type === "text") {
        const viber_id = sender.id;
        const message_text = message.text.toLowerCase();

        console.log(`Processing message from ${viber_id}: ${message_text}`);

        // Логируем действие пользователя
        await db.query(
          `INSERT INTO bot_actions (viber_id, action_type, action_data) 
           VALUES (?, ?, ?)`,
          [viber_id, 'message', message_text]
        );

        // Проверяем, существует ли пользователь
        const [users] = await db.query("SELECT * FROM users WHERE viber_id = ?", [viber_id]);
        console.log(`User lookup result:`, users);
        
        if (users.length === 0) {
          // Если пользователь не найден, отправляем сообщение о регистрации
          await sendViberMessage(
            viber_id, 
            "Для начала работы с ботом, пожалуйста, отправьте номер вашего телефона в формате +380XXXXXXXXX.\n\n" +
            "Если ваш номер телефона не найден в базе данных, обратитесь в правление для внесения или актуализации данных."
          );
          await db.query(
            `INSERT INTO bot_actions (viber_id, action_type, action_data) 
             VALUES (?, ?, ?)`,
            [viber_id, 'unregistered_user', 'Попытка использования бота без регистрации']
          );
          return res.status(200).json({ status: "ok" });
        }

        const user = users[0];

        // Обработка команд
        switch (message_text) {
          case "помощь":
            const helpMessage = `Доступные команды:
📋 инфо - общая информация по участку
📊 показания - последние показания счетчика
💰 оплата - информация о последней оплате
📈 расход - расход электроэнергии
🔔 уведомления - настройка уведомлений
⏰ напоминание - настройка напоминаний
❌ отвязать - отвязать Viber от участка
❓ помощь - показать это сообщение`;
            await sendViberMessage(viber_id, helpMessage);
            await db.query(
              `INSERT INTO bot_actions (viber_id, action_type, action_data) 
               VALUES (?, ?, ?)`,
              [viber_id, 'help_request', 'Запрос списка команд']
            );
            break;

          case "расход":
            const [consumptionReadings] = await db.query(
              `SELECT reading_date, value 
               FROM readings 
               WHERE user_id = ? 
               ORDER BY reading_date DESC 
               LIMIT 6`,
              [user.id]
            );

            if (consumptionReadings.length < 2) {
              await sendViberMessage(viber_id, "Недостаточно данных для расчета расхода.");
            } else {
              let consumptionMessage = "Расход электроэнергии:\n\n";
              for (let i = 0; i < consumptionReadings.length - 1; i++) {
                const currentDate = new Date(consumptionReadings[i].reading_date);
                const prevDate = new Date(consumptionReadings[i + 1].reading_date);
                const consumption = consumptionReadings[i].value - consumptionReadings[i + 1].value;
                const monthName = currentDate.toLocaleString('ru-RU', { month: 'long' });
                consumptionMessage += `${monthName}: ${consumption} кВт⋅ч\n`;
              }

              const avgConsumption = await calculateAverageConsumption(user.id);
              if (avgConsumption) {
                consumptionMessage += `\n📊 Средний расход: ${avgConsumption} кВт⋅ч/мес`;
              }

              await sendViberMessage(viber_id, consumptionMessage);
            }
            await db.query(
              `INSERT INTO bot_actions (viber_id, action_type, action_data) 
               VALUES (?, ?, ?)`,
              [viber_id, 'consumption_request', `Запрос расхода по участку ${user.plot_number}`]
            );
            break;

          case "уведомления":
            const [settings] = await db.query(
              "SELECT notifications_enabled FROM users WHERE id = ?",
              [user.id]
            );
            const currentStatus = settings[0]?.notifications_enabled ? "включены" : "выключены";
            const newStatus = !settings[0]?.notifications_enabled;

            await db.query(
              "UPDATE users SET notifications_enabled = ? WHERE id = ?",
              [newStatus, user.id]
            );

            await sendViberMessage(
              viber_id,
              `Уведомления ${newStatus ? "включены" : "выключены"}.\n\nВы будете получать уведомления о:\n📊 Новых показаниях\n💰 Новых оплатах\n⚠️ Большом расходе`
            );
            await db.query(
              `INSERT INTO bot_actions (viber_id, action_type, action_data) 
               VALUES (?, ?, ?)`,
              [viber_id, 'notifications_toggle', `Изменение статуса уведомлений на ${newStatus}`]
            );
            break;

          case "напоминание":
            const [reminderSettings] = await db.query(
              "SELECT reminder_day FROM users WHERE id = ?",
              [user.id]
            );
            const currentDay = reminderSettings[0]?.reminder_day || 25;

            await sendViberMessage(
              viber_id,
              `Текущий день напоминания: ${currentDay} число каждого месяца.\n\nДля изменения отправьте число от 1 до 28.`
            );
            await db.query(
              `INSERT INTO bot_actions (viber_id, action_type, action_data) 
               VALUES (?, ?, ?)`,
              [viber_id, 'reminder_request', `Запрос настройки напоминаний`]
            );
            break;

          case "инфо":
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
            const message = `Информация по участку ${user.plot_number}:
👤 Владелец: ${user.full_name}
💰 Долг: ${debt ?? 'нет данных'}
💵 Текущий тариф: ${tariff} руб/кВт⋅ч`;
            
            await sendViberMessage(viber_id, message);
            await db.query(
              `INSERT INTO bot_actions (viber_id, action_type, action_data) 
               VALUES (?, ?, ?)`,
              [viber_id, 'info_request', `Запрос информации по участку ${user.plot_number}`]
            );
            break;

          case "показания":
            const [meterReadings] = await db.query(
              `SELECT reading_date, value 
               FROM readings 
               WHERE user_id = ? 
               ORDER BY reading_date DESC 
               LIMIT 3`,
              [user.id]
            );

            if (meterReadings.length === 0) {
              await sendViberMessage(viber_id, "Показания счетчика отсутствуют.");
            } else {
              let readingsMessage = "Последние показания счетчика:\n";
              meterReadings.forEach(r => {
                const date = new Date(r.reading_date).toLocaleDateString('ru-RU');
                readingsMessage += `📅 ${date}: ${r.value} кВт⋅ч\n`;
              });
              await sendViberMessage(viber_id, readingsMessage);
            }
            await db.query(
              `INSERT INTO bot_actions (viber_id, action_type, action_data) 
               VALUES (?, ?, ?)`,
              [viber_id, 'readings_request', `Запрос показаний по участку ${user.plot_number}`]
            );
            break;

          case "оплата":
            const [[lastPaymentInfo]] = await db.query(
              `SELECT payment_date, paid_reading, 
                (SELECT value FROM tariff WHERE effective_date <= payment_date ORDER BY effective_date DESC LIMIT 1) as tariff
               FROM payments 
               WHERE user_id = ? 
               ORDER BY payment_date DESC 
               LIMIT 1`,
              [user.id]
            );

            if (!lastPaymentInfo) {
              await sendViberMessage(viber_id, "Информация об оплатах отсутствует.");
            } else {
              const paymentDate = new Date(lastPaymentInfo.payment_date).toLocaleDateString('ru-RU');
              const amount = (lastPaymentInfo.paid_reading * lastPaymentInfo.tariff).toFixed(2);
              const paymentMessage = `Последняя оплата:
📅 Дата: ${paymentDate}
⚡ Оплачено: ${lastPaymentInfo.paid_reading} кВт⋅ч
💵 Сумма: ${amount} руб.
💰 Тариф: ${lastPaymentInfo.tariff} руб/кВт⋅ч`;
              await sendViberMessage(viber_id, paymentMessage);
            }
            await db.query(
              `INSERT INTO bot_actions (viber_id, action_type, action_data) 
               VALUES (?, ?, ?)`,
              [viber_id, 'payment_request', `Запрос информации об оплате по участку ${user.plot_number}`]
            );
            break;

          case "отвязать":
            await db.query(
              "UPDATE users SET viber_id = NULL WHERE id = ?",
              [user.id]
            );
            await sendViberMessage(
              viber_id,
              `Viber успешно отвязан от участка ${user.plot_number}. Для повторной привязки отправьте номер участка.`
            );
            await db.query(
              `INSERT INTO bot_actions (viber_id, action_type, action_data) 
               VALUES (?, ?, ?)`,
              [viber_id, 'unlink', `Отвязка Viber от участка ${user.plot_number}`]
            );
            break;

          default:
            // Проверяем, не является ли сообщение номером телефона
            const phoneNumber = message_text.replace(/\s+/g, '');
            console.log('Checking phone number:', phoneNumber);
            
            if (phoneNumber.match(/^\+380\d{9}$/)) {
              console.log('Phone number format is valid');
              
              // Ищем пользователя по номеру телефона
              const [usersByPhone] = await db.query(
                "SELECT * FROM users WHERE phone = ? AND viber_id IS NULL",
                [phoneNumber]
              );
              console.log('Users found by phone:', usersByPhone);

              if (usersByPhone.length > 0) {
                console.log('Found user:', usersByPhone[0]);
                // Получаем информацию о пользователе Viber
                const viberUser = await getViberUserDetails(viber_id);
                const userDetails = viberUser ? JSON.stringify(viberUser) : null;

                // Обновляем viber_id и информацию о пользователе
                await db.query(
                  "UPDATE users SET viber_id = ?, viber_details = ? WHERE id = ?",
                  [viber_id, userDetails, usersByPhone[0].id]
                );

                // Логируем регистрацию с деталями
                await db.query(
                  `INSERT INTO bot_actions (viber_id, action_type, action_data) 
                   VALUES (?, ?, ?)`,
                  [viber_id, 'registration', `Регистрация пользователя с участком ${usersByPhone[0].plot_number}. Viber details: ${userDetails}`]
                );

                await sendViberMessage(
                  viber_id,
                  `Успешная регистрация! Теперь вы можете получать информацию о вашем участке ${usersByPhone[0].plot_number}.\n\nОтправьте "помощь" для просмотра доступных команд.`
                );
              } else {
                // Проверяем, может номер уже привязан к другому пользователю
                const [existingUser] = await db.query(
                  "SELECT * FROM users WHERE phone = ? AND viber_id IS NOT NULL",
                  [phoneNumber]
                );
                console.log('Existing user with this phone:', existingUser);

                if (existingUser.length > 0) {
                  await sendViberMessage(
                    viber_id,
                    "Этот номер телефона уже привязан к другому пользователю Viber. Пожалуйста, обратитесь в правление для решения вопроса."
                  );
                } else {
                  await sendViberMessage(
                    viber_id,
                    "Ваш номер телефона не найден в базе данных. Пожалуйста, обратитесь в правление для внесения или актуализации данных."
                  );
                }
                await db.query(
                  `INSERT INTO bot_actions (viber_id, action_type, action_data) 
                   VALUES (?, ?, ?)`,
                  [viber_id, 'registration_failed', `Попытка регистрации с номером ${phoneNumber}`]
                );
              }
            } else {
              console.log('Invalid phone number format');
              await sendViberMessage(
                viber_id,
                "Неверный формат номера телефона. Пожалуйста, отправьте номер в формате +380XXXXXXXXX"
              );
            }
        }
      } else if (event === "conversation_started") {
        // Обработка начала диалога
        console.log('Conversation started with:', sender);
        const viberUser = await getViberUserDetails(sender.id);
        console.log('New user details:', viberUser);

        await sendViberMessage(
          sender.id, 
          "Добро пожаловать! Для начала работы с ботом, пожалуйста, отправьте номер вашего телефона в формате +380XXXXXXXXX.\n\n" +
          "Если ваш номер телефона не найден в базе данных, обратитесь в правление для внесения или актуализации данных."
        );
      } else if (event === "subscribed") {
        // Обработка подписки
        console.log('User subscribed:', sender);
        const viberUser = await getViberUserDetails(sender.id);
        console.log('New subscriber details:', viberUser);

        await sendViberMessage(
          sender.id, 
          "Спасибо за подписку! Для начала работы с ботом, пожалуйста, отправьте номер вашего телефона в формате +380XXXXXXXXX.\n\n" +
          "Если ваш номер телефона не найден в базе данных, обратитесь в правление для внесения или актуализации данных."
        );
      } else {
        console.log('Received non-message event:', event);
      }

      res.status(200).json({ status: "ok" });
    } catch (err) {
      console.error("Error processing webhook:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Маршрут для отправки уведомлений о новых показаниях
  router.post("/notify-reading", async (req, res) => {
    try {
      const { user_id, reading_date, value } = req.body;
      
      // Получаем информацию о пользователе
      const [users] = await db.query(
        "SELECT viber_id, notifications_enabled, plot_number FROM users WHERE id = ?",
        [user_id]
      );

      if (users.length > 0 && users[0].viber_id && users[0].notifications_enabled) {
        const message = `📊 Новое показание по участку ${users[0].plot_number}:\nДата: ${new Date(reading_date).toLocaleDateString('ru-RU')}\nЗначение: ${value} кВт⋅ч`;
        await sendViberMessage(users[0].viber_id, message);
      }

      res.json({ status: "ok" });
    } catch (err) {
      console.error("Error sending reading notification:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Маршрут для отправки уведомлений о новых оплатах
  router.post("/notify-payment", async (req, res) => {
    try {
      const { user_id, payment_date, paid_reading, tariff } = req.body;
      
      // Получаем информацию о пользователе
      const [users] = await db.query(
        "SELECT viber_id, notifications_enabled, plot_number FROM users WHERE id = ?",
        [user_id]
      );

      if (users.length > 0 && users[0].viber_id && users[0].notifications_enabled) {
        const amount = (paid_reading * tariff).toFixed(2);
        const message = `💰 Новая оплата по участку ${users[0].plot_number}:\nДата: ${new Date(payment_date).toLocaleDateString('ru-RU')}\nОплачено: ${paid_reading} кВт⋅ч\nСумма: ${amount} руб.`;
        await sendViberMessage(users[0].viber_id, message);
      }

      res.json({ status: "ok" });
    } catch (err) {
      console.error("Error sending payment notification:", err);
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

  // Добавляем маршрут для проверки статуса бота
  router.get("/status", async (req, res) => {
    try {
      const response = await axios.get("https://chatapi.viber.com/pa/get_account_info", {
        headers: {
          "X-Viber-Auth-Token": VIBER_AUTH_TOKEN
        }
      });
      res.json(response.data);
    } catch (err) {
      console.error("Error checking bot status:", err.response?.data || err.message);
      res.status(500).json({ error: "Failed to get bot status" });
    }
  });

  // Маршрут для установки вебхука
  router.post("/set-webhook", async (req, res) => {
    try {
      const { webhook_url } = req.body;
      if (!webhook_url) {
        return res.status(400).json({ error: "webhook_url is required" });
      }

      console.log('Setting webhook to:', webhook_url);
      const response = await axios.post("https://chatapi.viber.com/pa/set_webhook", {
        url: webhook_url,
        event_types: ["subscribed", "unsubscribed", "conversation_started", "message"]
      }, {
        headers: {
          "X-Viber-Auth-Token": VIBER_AUTH_TOKEN
        }
      });

      console.log('Webhook set response:', response.data);
      res.json(response.data);
    } catch (err) {
      console.error("Error setting webhook:", err.response?.data || err.message);
      res.status(500).json({ error: "Failed to set webhook" });
    }
  });

  return router;
} 