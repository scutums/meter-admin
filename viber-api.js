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
      console.log('Full Viber API response:', JSON.stringify(response.data, null, 2));
      
      // Проверяем наличие номера телефона
      if (response.data && response.data.user) {
        console.log('User details from Viber:', {
          id: response.data.user.id,
          name: response.data.user.name,
          phone_number: response.data.user.phone_number,
          language: response.data.user.language,
          country: response.data.user.country
        });
      }
      
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
      const { event, sender, message, user_id } = req.body;

      // Для событий delivered и seen используем user_id вместо sender.id
      const viber_id = sender?.id || user_id;
      
      if (!viber_id) {
        console.log('No viber_id found in webhook data');
        return res.status(200).json({ status: "ok" });
      }

      // Проверяем, что это сообщение от пользователя
      if (event === "message" && message && message.type === "text") {
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
          // Проверяем, есть ли сохраненный номер телефона для этого viber_id
          const [tempRegistrations] = await db.query(
            "SELECT * FROM temp_registrations WHERE viber_id = ?",
            [viber_id]
          );
          console.log('Temp registration lookup:', tempRegistrations);

          if (tempRegistrations.length === 0) {
            // Простая заглушка для тестирования
            if (message_text === '123') {
              console.log('Test phone number detected');
              // Сохраняем номер телефона во временную таблицу
              await db.query(
                "INSERT INTO temp_registrations (viber_id, phone) VALUES (?, ?)",
                [viber_id, '380505699852'] // Сохраняем реальный номер в базу
              );

              await sendViberMessage(
                viber_id,
                "Номер телефона подтвержден. Теперь, пожалуйста, отправьте номер вашего участка (только цифры)."
              );
              return res.status(200).json({ status: "ok" });
            }
            
            // Проверка реального номера телефона
            const phoneNumber = message_text.trim();
            console.log('Original phone number:', phoneNumber);
            
            // Нормализуем номер телефона (оставляем только цифры)
            const normalizedPhone = phoneNumber.replace(/\D/g, '');
            console.log('Normalized phone number:', normalizedPhone);
            
            // Проверяем формат номера (12 цифр, начинается с 380)
            const isValidFormat = normalizedPhone.match(/^380\d{9}$/);
            console.log('Is valid format:', isValidFormat);
            
            if (isValidFormat) {
              console.log('Phone number format is valid');
              
              // Ищем пользователя по номеру телефона
              const [usersByPhone] = await db.query(
                "SELECT * FROM users WHERE phone = ?",
                [normalizedPhone]
              );
              console.log('Users found by phone:', usersByPhone);

              if (usersByPhone.length > 0) {
                const user = usersByPhone[0];
                console.log('Found user:', user);
                
                if (user.viber_id) {
                  console.log('User already has viber_id:', user.viber_id);
                  await sendViberMessage(
                    viber_id,
                    "Этот номер телефона уже привязан к другому пользователю Viber. Пожалуйста, обратитесь в правление для решения вопроса."
                  );
                } else {
                  console.log('Saving to temp_registrations');
                  // Сохраняем номер телефона во временную таблицу
                  await db.query(
                    "INSERT INTO temp_registrations (viber_id, phone) VALUES (?, ?)",
                    [viber_id, normalizedPhone]
                  );

                  await sendViberMessage(
                    viber_id,
                    "Номер телефона подтвержден. Теперь, пожалуйста, отправьте номер вашего участка (только цифры)."
                  );
                }
              } else {
                console.log('No user found with this phone number');
                await sendViberMessage(
                  viber_id,
                  "Номер телефона не найден в базе данных. Пожалуйста, проверьте номер и попробуйте снова или обратитесь в правление."
                );
              }
            } else {
              console.log('Invalid phone number format');
              await sendViberMessage(
                viber_id,
                "Неверный формат номера телефона. Пожалуйста, отправьте номер в формате 380XXXXXXXXX (без +) или 123 для тестирования"
              );
            }
            return res.status(200).json({ status: "ok" });
          } else {
            // Второй шаг: проверяем номер участка
            const plotNumber = message_text.trim();
            console.log('Checking plot number:', plotNumber);
            
            if (plotNumber.match(/^\d+$/)) {
              // Получаем сохраненный номер телефона
              const tempReg = tempRegistrations[0];
              
              // Проверяем, что участок принадлежит этому пользователю
              const [usersByPlot] = await db.query(
                "SELECT * FROM users WHERE plot_number = ? AND phone = ? AND viber_id IS NULL",
                [plotNumber, tempReg.phone]
              );
              console.log('Users found by plot and phone:', usersByPlot);

              if (usersByPlot.length > 0) {
                // Получаем информацию о пользователе Viber
                const viberUser = await getViberUserDetails(viber_id);
                const userDetails = viberUser ? JSON.stringify(viberUser) : null;

                // Обновляем viber_id и информацию о пользователе
                await db.query(
                  "UPDATE users SET viber_id = ?, viber_details = ? WHERE id = ?",
                  [viber_id, userDetails, usersByPlot[0].id]
                );

                // Удаляем временную регистрацию
                await db.query(
                  "DELETE FROM temp_registrations WHERE viber_id = ?",
                  [viber_id]
                );

                // Логируем регистрацию
                await db.query(
                  `INSERT INTO bot_actions (viber_id, action_type, action_data) 
                   VALUES (?, ?, ?)`,
                  [viber_id, 'registration', `Регистрация пользователя с участком ${plotNumber} и телефоном ${tempReg.phone}`]
                );

                await sendViberMessage(
                  viber_id,
                  `Успешная регистрация! Теперь вы можете получать информацию о вашем участке ${plotNumber}.\n\nОтправьте "помощь" для просмотра доступных команд.`
                );
              } else {
                await sendViberMessage(
                  viber_id,
                  "Участок с таким номером не найден или не привязан к вашему номеру телефона.\n\nПожалуйста, проверьте номер и попробуйте снова.\n\nЕсли вы уверены, что номер правильный, обратитесь в правление.\n\nДля отмены регистрации отправьте 'отмена'"
                );
              }
            } else if (message_text.toLowerCase() === 'отмена') {
              // Удаляем временную регистрацию
              await db.query(
                "DELETE FROM temp_registrations WHERE viber_id = ?",
                [viber_id]
              );
              await sendViberMessage(
                viber_id,
                "Регистрация отменена. Для начала работы с ботом, пожалуйста, отправьте номер вашего телефона в формате 380XXXXXXXXX (без +) или 123 для тестирования"
              );
            } else {
              await sendViberMessage(
                viber_id,
                "Неверный формат номера участка. Пожалуйста, отправьте только цифры номера участка.\n\nДля отмены регистрации отправьте 'отмена'"
              );
            }
          }
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
📱 телефон - показать привязанный номер телефона
❌ отвязать - отвязать Viber от участка
❓ помощь - показать это сообщение`;
            await sendViberMessage(viber_id, helpMessage);
            await db.query(
              `INSERT INTO bot_actions (viber_id, action_type, action_data) 
               VALUES (?, ?, ?)`,
              [viber_id, 'help_request', 'Запрос списка команд']
            );
            break;

          case "телефон":
            if (user.phone) {
              await sendViberMessage(
                viber_id,
                `Ваш привязанный номер телефона: ${user.phone}`
              );
            } else {
              await sendViberMessage(
                viber_id,
                "У вас не привязан номер телефона в системе."
              );
            }
            await db.query(
              `INSERT INTO bot_actions (viber_id, action_type, action_data) 
               VALUES (?, ?, ?)`,
              [viber_id, 'phone_check', 'Проверка привязанного номера телефона']
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
            // Проверяем, есть ли сохраненный номер телефона для этого viber_id
            const [tempRegistrations] = await db.query(
              "SELECT * FROM temp_registrations WHERE viber_id = ?",
              [viber_id]
            );

            if (tempRegistrations.length === 0) {
              // Простая заглушка для тестирования
              if (message_text === '123') {
                console.log('Test phone number detected');
                // Сохраняем номер телефона во временную таблицу
                await db.query(
                  "INSERT INTO temp_registrations (viber_id, phone) VALUES (?, ?)",
                  [viber_id, '380505699852'] // Сохраняем реальный номер в базу
                );

                await sendViberMessage(
                  viber_id,
                  "Номер телефона подтвержден. Теперь, пожалуйста, отправьте номер вашего участка (только цифры)."
                );
                return res.status(200).json({ status: "ok" });
              }

              // Проверка реального номера телефона
              const phoneNumber = message_text.trim();
              console.log('Original phone number:', phoneNumber);
              
              // Нормализуем номер телефона (оставляем только цифры)
              const normalizedPhone = phoneNumber.replace(/\D/g, '');
              console.log('Normalized phone number:', normalizedPhone);
              
              // Проверяем формат номера (12 цифр, начинается с 380)
              const isValidFormat = normalizedPhone.match(/^380\d{9}$/);
              console.log('Is valid format:', isValidFormat);
              
              if (isValidFormat) {
                console.log('Phone number format is valid');
                
                // Ищем пользователя по номеру телефона
                const [usersByPhone] = await db.query(
                  "SELECT * FROM users WHERE phone = ?",
                  [normalizedPhone]
                );
                console.log('Users found by phone:', usersByPhone);

                if (usersByPhone.length > 0) {
                  const user = usersByPhone[0];
                  console.log('Found user:', user);
                  
                  if (user.viber_id) {
                    console.log('User already has viber_id:', user.viber_id);
                    await sendViberMessage(
                      viber_id,
                      "Этот номер телефона уже привязан к другому пользователю Viber. Пожалуйста, обратитесь в правление для решения вопроса."
                    );
                  } else {
                    console.log('Saving to temp_registrations');
                    // Сохраняем номер телефона во временную таблицу
                    await db.query(
                      "INSERT INTO temp_registrations (viber_id, phone) VALUES (?, ?)",
                      [viber_id, normalizedPhone]
                    );

                    await sendViberMessage(
                      viber_id,
                      "Номер телефона подтвержден. Теперь, пожалуйста, отправьте номер вашего участка (только цифры)."
                    );
                  }
                } else {
                  console.log('No user found with this phone number');
                  await sendViberMessage(
                    viber_id,
                    "Номер телефона не найден в базе данных. Пожалуйста, проверьте номер и попробуйте снова или обратитесь в правление."
                  );
                }
              } else {
                console.log('Invalid phone number format');
                await sendViberMessage(
                  viber_id,
                  "Неверный формат номера телефона. Пожалуйста, отправьте номер в формате 380XXXXXXXXX (без +) или 123 для тестирования"
                );
              }
            } else {
              // Второй шаг: проверяем номер участка
              const plotNumber = message_text.trim();
              console.log('Checking plot number:', plotNumber);
              
              if (plotNumber.match(/^\d+$/)) {
                // Получаем сохраненный номер телефона
                const tempReg = tempRegistrations[0];
                
                // Проверяем, что участок принадлежит этому пользователю
                const [usersByPlot] = await db.query(
                  "SELECT * FROM users WHERE plot_number = ? AND phone = ? AND viber_id IS NULL",
                  [plotNumber, tempReg.phone]
                );
                console.log('Users found by plot and phone:', usersByPlot);

                if (usersByPlot.length > 0) {
                  // Получаем информацию о пользователе Viber
                  const viberUser = await getViberUserDetails(viber_id);
                  const userDetails = viberUser ? JSON.stringify(viberUser) : null;

                  // Обновляем viber_id и информацию о пользователе
                  await db.query(
                    "UPDATE users SET viber_id = ?, viber_details = ? WHERE id = ?",
                    [viber_id, userDetails, usersByPlot[0].id]
                  );

                  // Удаляем временную регистрацию
                  await db.query(
                    "DELETE FROM temp_registrations WHERE viber_id = ?",
                    [viber_id]
                  );

                  // Логируем регистрацию
                  await db.query(
                    `INSERT INTO bot_actions (viber_id, action_type, action_data) 
                     VALUES (?, ?, ?)`,
                    [viber_id, 'registration', `Регистрация пользователя с участком ${plotNumber} и телефоном ${tempReg.phone}`]
                  );

                  await sendViberMessage(
                    viber_id,
                    `Успешная регистрация! Теперь вы можете получать информацию о вашем участке ${plotNumber}.\n\nОтправьте "помощь" для просмотра доступных команд.`
                  );
                } else {
                  await sendViberMessage(
                    viber_id,
                    "Участок с таким номером не найден или не привязан к вашему номеру телефона.\n\nПожалуйста, проверьте номер и попробуйте снова.\n\nЕсли вы уверены, что номер правильный, обратитесь в правление.\n\nДля отмены регистрации отправьте 'отмена'"
                  );
                }
              } else if (message_text.toLowerCase() === 'отмена') {
                // Удаляем временную регистрацию
                await db.query(
                  "DELETE FROM temp_registrations WHERE viber_id = ?",
                  [viber_id]
                );
                await sendViberMessage(
                  viber_id,
                  "Регистрация отменена. Для начала работы с ботом, пожалуйста, отправьте номер вашего телефона в формате 380XXXXXXXXX (без +) или 123 для тестирования"
                );
              } else {
                await sendViberMessage(
                  viber_id,
                  "Неверный формат номера участка. Пожалуйста, отправьте только цифры номера участка.\n\nДля отмены регистрации отправьте 'отмена'"
                );
              }
            }
        }
      } else if (event === "conversation_started") {
        // Обработка начала диалога
        if (!sender) {
          console.log('No sender data in conversation_started');
          return res.status(200).json({ status: "ok" });
        }
        console.log('Conversation started with:', sender);
        const viberUser = await getViberUserDetails(viber_id);
        console.log('New user details:', viberUser);

        await sendViberMessage(
          viber_id, 
          "Добро пожаловать! Для начала работы с ботом, пожалуйста, отправьте номер вашего телефона в формате 380XXXXXXXXX."
        );
      } else if (event === "subscribed") {
        // Обработка подписки
        if (!sender) {
          console.log('No sender data in subscribed');
          return res.status(200).json({ status: "ok" });
        }
        console.log('User subscribed:', sender);
        const viberUser = await getViberUserDetails(viber_id);
        console.log('New subscriber details:', viberUser);

        await sendViberMessage(
          viber_id, 
          "Спасибо за подписку! Для начала работы с ботом, пожалуйста, отправьте номер вашего телефона в формате 380XXXXXXXXX."
        );
      } else if (event === "delivered" || event === "seen") {
        // Обработка событий доставки и прочтения
        console.log(`Message ${event} by user ${viber_id}`);
        // Можно добавить логирование этих событий, если нужно
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