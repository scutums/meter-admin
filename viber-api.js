import express from "express";
import axios from "axios";

// Получаем токен авторизации Viber из переменных окружения или используем значение по умолчанию
// Токен используется для аутентификации всех запросов к API Viber
const VIBER_AUTH_TOKEN = process.env.VIBER_AUTH_TOKEN || '507a9cdad4e7e728-44afb7e01b8d3350-b88a8c0308784366';

/**
 * Основная функция для создания маршрутов Viber бота
 * @param {Object} db - Объект базы данных для выполнения запросов
 * @returns {Object} Express router с настроенными маршрутами
 */
export default function viberRoutes(db) {
  // Создаем новый роутер Express
  const router = express.Router();

  /**
   * Получение информации о пользователе Viber через API
   * @param {string} viber_id - Уникальный идентификатор пользователя в Viber
   * @returns {Object|null} Информация о пользователе или null в случае ошибки
   */
  async function getViberUserDetails(viber_id) {
    try {
      // Логируем начало запроса информации о пользователе
      console.log('Getting user details for:', viber_id);
      
      // Выполняем запрос к API Viber для получения информации о пользователе
      const response = await axios.post("https://chatapi.viber.com/pa/get_user_details", {
        id: viber_id
      }, {
        headers: {
          "X-Viber-Auth-Token": VIBER_AUTH_TOKEN
        }
      });
      
      // Логируем полный ответ от API Viber
      console.log('Full Viber API response:', JSON.stringify(response.data, null, 2));
      
      // Логируем основные данные пользователя
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
      // Логируем ошибку при получении информации о пользователе
      console.error("Error getting Viber user details:", err.response?.data || err.message);
      return null;
    }
  }

  /**
   * Получение кнопок для основного меню команд
   * @returns {Array} Массив объектов с текстом и командой для каждой кнопки
   */
  function getCommandButtons() {
    return [
      { text: "📋 Инфо", command: "инфо" },           // Информация об участке
      { text: "📊 Показания", command: "показания" }, // Показания счетчика
      { text: "💰 История оплат", command: "оплата" }, // История оплат
      { text: "💳 Реквизиты", command: "реквизиты" }, // Реквизиты для оплаты
      { text: "📈 Расход", command: "расход" },       // Расход электроэнергии
      { text: "🔔 Уведомления", command: "уведомления" }, // Настройка уведомлений
      { text: "⏰ Напоминание", command: "напоминание" }, // Настройка напоминаний
      { text: "📱 Телефон", command: "телефон" },     // Информация о телефоне
      { text: "❌ Отвязать", command: "отвязать" },    // Отвязка Viber от участка
      { text: "❓ Помощь", command: "помощь" }         // Справка по командам
    ];
  }

  /**
   * Получение кнопок для процесса регистрации
   * @returns {Array} Массив объектов с текстом и командой для кнопок регистрации
   */
  function getRegistrationButtons() {
    return [
      { text: "❌ Отмена", command: "отмена" } // Кнопка отмены регистрации
    ];
  }

  /**
   * Обработка отписки пользователя от бота
   * @param {string} viber_id - ID пользователя в Viber
   */
  async function handleUnsubscribe(viber_id) {
    try {
      console.log('Processing unsubscribe for viber_id:', viber_id);
      
      // Обновляем данные пользователя
      await db.query(
        `UPDATE users 
         SET viber_id = NULL, 
             viber_details = NULL,
             notifications_enabled = 1
         WHERE viber_id = ?`,
        [viber_id]
      );

      // Логируем отписку
      await db.query(
        `INSERT INTO bot_actions (viber_id, action_type, action_data) 
         VALUES (?, ?, ?)`,
        [viber_id, 'unsubscribe', 'Пользователь отписался от бота']
      );

      console.log('Successfully processed unsubscribe for viber_id:', viber_id);
    } catch (err) {
      console.error('Error processing unsubscribe:', err);
    }
  }

  /**
   * Отправка сообщения пользователю в Viber
   * @param {string} viber_id - ID пользователя в Viber
   * @param {string} message - Текст сообщения
   * @param {Array} buttons - Массив кнопок для клавиатуры (опционально)
   */
  async function sendViberMessage(viber_id, message, buttons = null) {
    try {
      // Логируем отправку сообщения
      console.log(`Sending message to ${viber_id}: ${message}`);
      console.log('Using Viber token:', VIBER_AUTH_TOKEN);
      
      // Формируем базовую структуру сообщения
      const messageData = {
        receiver: viber_id,
        type: "text",
        text: message
      };

      // Если есть кнопки, добавляем клавиатуру
      if (buttons) {
        messageData.keyboard = {
          Type: "keyboard",
          Buttons: buttons.map(button => ({
            Columns: 3, // Количество колонок для кнопки
            Rows: 1,    // Количество строк для кнопки
            Text: button.text, // Текст кнопки
            ActionType: "reply", // Тип действия при нажатии
            ActionBody: button.command, // Команда, которая будет отправлена при нажатии
            TextSize: "regular", // Размер текста
            TextHAlign: "center", // Горизонтальное выравнивание
            TextVAlign: "middle", // Вертикальное выравнивание
            BgColor: "#FFFFFF", // Стандартный цвет фона Viber
            TextColor: "#000000", // Стандартный цвет текста Viber
            BorderWidth: 3, // Увеличенная ширина границы
            BorderColor: "#7367F0", // Фиолетовый цвет границы (стандартный цвет Viber)
            Silent: false // Звук при нажатии
          }))
        };
      }
      
      // Отправляем сообщение через API Viber
      const response = await axios.post("https://chatapi.viber.com/pa/send_message", messageData, {
        headers: {
          "X-Viber-Auth-Token": VIBER_AUTH_TOKEN
        }
      });
      console.log('Viber API response:', response.data);
    } catch (err) {
      // Логируем ошибку при отправке сообщения
      console.error("Error sending Viber message:", err.response?.data || err.message);
    }
  }

  /**
   * Расчет среднего расхода электроэнергии за указанный период
   * @param {number} userId - ID пользователя
   * @param {number} months - Количество месяцев для расчета
   * @returns {number|null} Средний расход или null при недостатке данных
   */
  async function calculateAverageConsumption(userId, months = 3) {
    // Получаем показания счетчика за последние N месяцев
    const [readings] = await db.query(
      `SELECT reading_date, value 
       FROM readings 
       WHERE user_id = ? 
       ORDER BY reading_date DESC 
       LIMIT ?`,
      [userId, months + 1]
    );

    // Если недостаточно данных, возвращаем null
    if (readings.length < 2) return null;

    // Рассчитываем общий расход
    let totalConsumption = 0;
    for (let i = 0; i < readings.length - 1; i++) {
      totalConsumption += readings[i].value - readings[i + 1].value;
    }

    // Возвращаем средний расход
    return Math.round(totalConsumption / (readings.length - 1));
  }

  /**
   * Обработка вебхуков от Viber
   * Обрабатывает различные события: сообщения, начало диалога, подписку и т.д.
   */
  router.post("/webhook", async (req, res) => {
    try {
      // Логируем полученный вебхук
      console.log('Received webhook:', JSON.stringify(req.body, null, 2));
      const { event, sender, message, user_id } = req.body;

      // Получаем viber_id из данных отправителя или события
      const viber_id = sender?.id || user_id;
      
      // Если viber_id не найден, завершаем обработку
      if (!viber_id) {
        console.log('No viber_id found in webhook data');
        return res.status(200).json({ status: "ok" });
      }

      // Обработка отписки от бота
      if (event === "unsubscribed") {
        console.log('User unsubscribed:', viber_id);
        await handleUnsubscribe(viber_id);
        return res.status(200).json({ status: "ok" });
      }

      // Обработка текстовых сообщений от пользователя
      if (event === "message" && message && message.type === "text") {
        const message_text = message.text.toLowerCase();

        console.log(`Processing message from ${viber_id}: ${message_text}`);

        // Логируем действие пользователя в базу данных
        await db.query(
          `INSERT INTO bot_actions (viber_id, action_type, action_data) 
           VALUES (?, ?, ?)`,
          [viber_id, 'message', message_text]
        );

        // Проверяем, зарегистрирован ли пользователь
        const [users] = await db.query("SELECT * FROM users WHERE viber_id = ?", [viber_id]);
        console.log(`User lookup result:`, users);
        
        if (users.length > 0) {
          // Пользователь зарегистрирован - обрабатываем команды
          const user = users[0];
          
          // Обработка различных команд пользователя
          switch (message_text) {
            case "помощь":
              // Отправка списка доступных команд
              const helpMessage = `Доступные команды:
📋 инфо - общая информация по участку
📊 показания - последние показания счетчика
💰 история оплат - история платежей
💳 реквизиты - реквизиты для оплаты
📈 расход - расход электроэнергии
🔔 уведомления - настройка уведомлений
⏰ напоминание - настройка напоминаний
📱 телефон - показать привязанный номер телефона
❌ отвязать - отвязать Viber от участка
❓ помощь - показать это сообщение`;
              await sendViberMessage(viber_id, helpMessage, getCommandButtons());
              await db.query(
                `INSERT INTO bot_actions (viber_id, action_type, action_data) 
                 VALUES (?, ?, ?)`,
                [viber_id, 'help_request', 'Запрос списка команд']
              );
              break;

            case "телефон":
              // Отправка информации о привязанном телефоне
              if (user.phone) {
                await sendViberMessage(
                  viber_id,
                  `Ваш привязанный номер телефона: ${user.phone}`,
                  getCommandButtons()
                );
              } else {
                await sendViberMessage(
                  viber_id,
                  "У вас не привязан номер телефона в системе.",
                  getCommandButtons()
                );
              }
              await db.query(
                `INSERT INTO bot_actions (viber_id, action_type, action_data) 
                 VALUES (?, ?, ?)`,
                [viber_id, 'phone_check', 'Проверка привязанного номера телефона']
              );
              break;

            case "расход":
              // Получение и отправка информации о расходе электроэнергии
              const [consumptionReadings] = await db.query(
                `SELECT reading_date, value 
                 FROM readings 
                 WHERE user_id = ? 
                 ORDER BY reading_date DESC 
                 LIMIT 6`,
                [user.id]
              );

              if (consumptionReadings.length < 2) {
                await sendViberMessage(viber_id, "Недостаточно данных для расчета расхода.", getCommandButtons());
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

                await sendViberMessage(viber_id, consumptionMessage, getCommandButtons());
              }
              await db.query(
                `INSERT INTO bot_actions (viber_id, action_type, action_data) 
                 VALUES (?, ?, ?)`,
                [viber_id, 'consumption_request', `Запрос расхода по участку ${user.plot_number}`]
              );
              break;

            case "уведомления":
              // Включение/выключение уведомлений
              const [settings] = await db.query(
                "SELECT notifications_enabled FROM users WHERE id = ?",
                [user.id]
              );
              const currentStatus = settings[0]?.notifications_enabled ? "включены" : "выключены";
              const newStatus = !settings[0]?.notifications_enabled;

              // Обновляем настройки уведомлений
              await db.query(
                "UPDATE users SET notifications_enabled = ? WHERE id = ?",
                [newStatus, user.id]
              );

              await sendViberMessage(
                viber_id,
                `Уведомления ${newStatus ? "включены" : "выключены"}.\n\nВы будете получать уведомления о:\n📊 Новых показаниях\n💰 Новых оплатах\n⚠️ Большом расходе`,
                getCommandButtons()
              );
              await db.query(
                `INSERT INTO bot_actions (viber_id, action_type, action_data) 
                 VALUES (?, ?, ?)`,
                [viber_id, 'notifications_toggle', `Изменение статуса уведомлений на ${newStatus}`]
              );
              break;

            case "напоминание":
              // Настройка дня напоминания
              const [reminderSettings] = await db.query(
                "SELECT reminder_day FROM users WHERE id = ?",
                [user.id]
              );
              const currentDay = reminderSettings[0]?.reminder_day || 25;

              await sendViberMessage(
                viber_id,
                `Текущий день напоминания: ${currentDay} число каждого месяца.\n\nДля изменения отправьте число от 1 до 28.`,
                getRegistrationButtons()
              );
              await db.query(
                `INSERT INTO bot_actions (viber_id, action_type, action_data) 
                 VALUES (?, ?, ?)`,
                [viber_id, 'reminder_request', `Запрос настройки напоминаний`]
              );
              break;

            case "инфо":
              // Получение и отправка общей информации об участке
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
💵 Текущий тариф: ${tariff} грн/кВт⋅ч`;
              
              await sendViberMessage(viber_id, message, getCommandButtons());
              await db.query(
                `INSERT INTO bot_actions (viber_id, action_type, action_data) 
                 VALUES (?, ?, ?)`,
                [viber_id, 'info_request', `Запрос информации по участку ${user.plot_number}`]
              );
              break;

            case "показания":
              // Получение и отправка последних показаний счетчика
              const [meterReadings] = await db.query(
                `SELECT reading_date, value 
                 FROM readings 
                 WHERE user_id = ? 
                 ORDER BY reading_date DESC 
                 LIMIT 3`,
                [user.id]
              );

              if (meterReadings.length === 0) {
                await sendViberMessage(viber_id, "Показания счетчика отсутствуют.", getCommandButtons());
              } else {
                let readingsMessage = "Последние показания счетчика:\n";
                meterReadings.forEach(r => {
                  const date = new Date(r.reading_date).toLocaleDateString('ru-RU');
                  readingsMessage += `📅 ${date}: ${r.value} кВт⋅ч\n`;
                });
                await sendViberMessage(viber_id, readingsMessage, getCommandButtons());
              }
              await db.query(
                `INSERT INTO bot_actions (viber_id, action_type, action_data) 
                 VALUES (?, ?, ?)`,
                [viber_id, 'readings_request', `Запрос показаний по участку ${user.plot_number}`]
              );
              break;

            case "оплата":
              // Получение и отправка информации о последней оплате
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
                await sendViberMessage(viber_id, "История оплат отсутствует.", getCommandButtons());
              } else {
                const paymentDate = new Date(lastPaymentInfo.payment_date).toLocaleDateString('ru-RU');
                const amount = (lastPaymentInfo.paid_reading * lastPaymentInfo.tariff).toFixed(2);
                const paymentMessage = `Последняя оплата:
📅 Дата: ${paymentDate}
⚡ Оплачено: ${lastPaymentInfo.paid_reading} кВт⋅ч
💵 Сумма: ${amount} грн.
💰 Тариф: ${lastPaymentInfo.tariff} грн/кВт⋅ч`;
                await sendViberMessage(viber_id, paymentMessage, getCommandButtons());
              }
              await db.query(
                `INSERT INTO bot_actions (viber_id, action_type, action_data) 
                 VALUES (?, ?, ?)`,
                [viber_id, 'payment_request', `Запрос информации об оплате по участку ${user.plot_number}`]
              );
              break;

            case "реквизиты":
              // Отправка информации о реквизитах для оплаты
              const requisitesMessage = `💳 Реквизиты для оплаты:

🏦 Банк: ПриватБанк
💳 Номер карты: 4444 5555 6666 7777
👤 Получатель: Иванов Иван Иванович
📝 Назначение: Оплата за электроэнергию, участок ${user.plot_number}

❗️ ВАЖНО: При оплате обязательно указывайте номер участка в назначении платежа.`;
              await sendViberMessage(viber_id, requisitesMessage, getCommandButtons());
              await db.query(
                `INSERT INTO bot_actions (viber_id, action_type, action_data) 
                 VALUES (?, ?, ?)`,
                [viber_id, 'requisites_request', `Запрос реквизитов для оплаты по участку ${user.plot_number}`]
              );
              break;

            case "отвязать":
              // Отвязка Viber от участка
              await db.query(
                "UPDATE users SET viber_id = NULL WHERE id = ?",
                [user.id]
              );
              await sendViberMessage(
                viber_id,
                `Viber успешно отвязан от участка ${user.plot_number}. Для повторной привязки отправьте номер участка.`,
                getRegistrationButtons()
              );
              await db.query(
                `INSERT INTO bot_actions (viber_id, action_type, action_data) 
                 VALUES (?, ?, ?)`,
                [viber_id, 'unlink', `Отвязка Viber от участка ${user.plot_number}`]
              );
              break;

            default:
              // Обработка процесса регистрации
              const [tempRegistrations] = await db.query(
                "SELECT * FROM temp_registrations WHERE viber_id = ?",
                [viber_id]
              );

              if (tempRegistrations.length === 0) {
                
                // Проверка реального номера телефона
                const phoneNumber = message_text.trim();
                console.log('Original phone number:', phoneNumber);
                
                // Нормализация номера телефона
                const normalizedPhone = phoneNumber.replace(/\D/g, '');
                console.log('Normalized phone number:', normalizedPhone);
                
                // Проверка формата номера
                const isValidFormat = normalizedPhone.match(/^380\d{9}$/);
                console.log('Is valid format:', isValidFormat);
                
                if (isValidFormat) {
                  console.log('Phone number format is valid');
                  
                  // Поиск пользователя по номеру телефона
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
                        "Этот номер телефона уже привязан к другому пользователю Viber. Пожалуйста, обратитесь в правление для решения вопроса.",
                        getRegistrationButtons()
                      );
                    } else {
                      console.log('Saving to temp_registrations');
                      // Сохранение номера телефона во временную таблицу
                      await db.query(
                        "INSERT INTO temp_registrations (viber_id, phone) VALUES (?, ?)",
                        [viber_id, normalizedPhone]
                      );

                      await sendViberMessage(
                        viber_id,
                        "Номер телефона подтвержден. Теперь, пожалуйста, отправьте номер вашего участка (только цифры).",
                        getRegistrationButtons()
                      );
                    }
                  } else {
                    console.log('No user found with this phone number');
                    await sendViberMessage(
                      viber_id,
                      "Номер телефона не найден в базе данных. Пожалуйста, проверьте номер и попробуйте снова или обратитесь в правление.",
                      getRegistrationButtons()
                    );
                  }
                } else {
                  console.log('Invalid phone number format');
                  await sendViberMessage(
                    viber_id,
                    "Неверный формат номера телефона. Пожалуйста, отправьте номер в формате 380XXXXXXXXX (без +)",
                    getRegistrationButtons()
                  );
                }
              } else {
                // Второй шаг регистрации: проверка номера участка
                const plotNumber = message_text.trim();
                console.log('Checking plot number:', plotNumber);
                console.log('Temp registration:', tempRegistrations[0]);
                
                if (plotNumber.match(/^\d+$/)) {
                  // Получаем сохраненный номер телефона
                  const tempReg = tempRegistrations[0];
                  console.log('Using phone from temp registration:', tempReg.phone);
                  
                  // Проверяем принадлежность участка
                  const [usersByPlot] = await db.query(
                    "SELECT * FROM users WHERE plot_number = ? AND phone = ? AND viber_id IS NULL",
                    [plotNumber, tempReg.phone]
                  );
                  console.log('Users found by plot and phone:', usersByPlot);

                  if (usersByPlot.length > 0) {
                    // Получаем информацию о пользователе Viber
                    const viberUser = await getViberUserDetails(viber_id);
                    const userDetails = viberUser ? JSON.stringify(viberUser) : null;

                    // Обновляем данные пользователя
                    await db.query(
                      "UPDATE users SET viber_id = ?, viber_details = ? WHERE id = ?",
                      [viber_id, userDetails, usersByPlot[0].id]
                    );

                    // Удаляем временную регистрацию
                    await db.query(
                      "DELETE FROM temp_registrations WHERE viber_id = ?",
                      [viber_id]
                    );

                    // Логируем успешную регистрацию
                    await db.query(
                      `INSERT INTO bot_actions (viber_id, action_type, action_data) 
                       VALUES (?, ?, ?)`,
                      [viber_id, 'registration', `Регистрация пользователя с участком ${plotNumber} и телефоном ${tempReg.phone}`]
                    );

                    await sendViberMessage(
                      viber_id,
                      `Успешная регистрация! Теперь вы можете получать информацию о вашем участке ${plotNumber}.\n\nОтправьте "помощь" для просмотра доступных команд.`,
                      getCommandButtons()
                    );
                  } else {
                    console.log('No matching plot found for phone:', tempReg.phone);
                    await sendViberMessage(
                      viber_id,
                      "Участок с таким номером не найден или не привязан к вашему номеру телефона.\n\nПожалуйста, проверьте номер и попробуйте снова.\n\nЕсли вы уверены, что номер правильный, обратитесь в правление.",
                      getRegistrationButtons()
                    );
                  }
                } else if (message_text.toLowerCase() === 'отмена') {
                  // Отмена регистрации
                  await db.query(
                    "DELETE FROM temp_registrations WHERE viber_id = ?",
                    [viber_id]
                  );
                  await sendViberMessage(
                    viber_id,
                    "Регистрация отменена. Для начала работы с ботом, пожалуйста, отправьте номер вашего телефона в формате 380XXXXXXXXX (без +)"
                  );
                } else {
                  console.log('Invalid plot number format:', plotNumber);
                  await sendViberMessage(
                    viber_id,
                    "Неверный формат номера участка. Пожалуйста, отправьте только цифры номера участка.",
                    getRegistrationButtons()
                  );
                }
              }
          }
          return res.status(200).json({ status: "ok" });
        }

        // Если пользователь не найден, начинаем процесс регистрации
        const [tempRegistrations] = await db.query(
          "SELECT * FROM temp_registrations WHERE viber_id = ?",
          [viber_id]
        );
        console.log('Temp registration lookup:', tempRegistrations);

        if (tempRegistrations.length === 0) {
          
          // Проверка реального номера телефона
          const phoneNumber = message_text.trim();
          console.log('Original phone number:', phoneNumber);
          
          // Нормализация номера телефона
          const normalizedPhone = phoneNumber.replace(/\D/g, '');
          console.log('Normalized phone number:', normalizedPhone);
          
          // Проверка формата номера
          const isValidFormat = normalizedPhone.match(/^380\d{9}$/);
          console.log('Is valid format:', isValidFormat);
          
          if (isValidFormat) {
            console.log('Phone number format is valid');
            
            // Поиск пользователя по номеру телефона
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
                  "Этот номер телефона уже привязан к другому пользователю Viber. Пожалуйста, обратитесь в правление для решения вопроса.",
                  getRegistrationButtons()
                );
              } else {
                console.log('Saving to temp_registrations');
                // Сохранение номера телефона во временную таблицу
                await db.query(
                  "INSERT INTO temp_registrations (viber_id, phone) VALUES (?, ?)",
                  [viber_id, normalizedPhone]
                );

                await sendViberMessage(
                  viber_id,
                  "Номер телефона подтвержден. Теперь, пожалуйста, отправьте номер вашего участка (только цифры).",
                  getRegistrationButtons()
                );
              }
            } else {
              console.log('No user found with this phone number');
              await sendViberMessage(
                viber_id,
                "Номер телефона не найден в базе данных. Пожалуйста, проверьте номер и попробуйте снова или обратитесь в правление.",
                getRegistrationButtons()
              );
            }
          } else {
            console.log('Invalid phone number format');
            await sendViberMessage(
              viber_id,
              "Неверный формат номера телефона. Пожалуйста, отправьте номер в формате 380XXXXXXXXX (без +)",
              getRegistrationButtons()
            );
          }
        } else {
          // Второй шаг регистрации: проверка номера участка
          const plotNumber = message_text.trim();
          console.log('Checking plot number:', plotNumber);
          console.log('Temp registration:', tempRegistrations[0]);
          
          if (plotNumber.match(/^\d+$/)) {
            // Получаем сохраненный номер телефона
            const tempReg = tempRegistrations[0];
            console.log('Using phone from temp registration:', tempReg.phone);
            
            // Проверяем принадлежность участка
            const [usersByPlot] = await db.query(
              "SELECT * FROM users WHERE plot_number = ? AND phone = ? AND viber_id IS NULL",
              [plotNumber, tempReg.phone]
            );
            console.log('Users found by plot and phone:', usersByPlot);

            if (usersByPlot.length > 0) {
              // Получаем информацию о пользователе Viber
              const viberUser = await getViberUserDetails(viber_id);
              const userDetails = viberUser ? JSON.stringify(viberUser) : null;

              // Обновляем данные пользователя
              await db.query(
                "UPDATE users SET viber_id = ?, viber_details = ? WHERE id = ?",
                [viber_id, userDetails, usersByPlot[0].id]
              );

              // Удаляем временную регистрацию
              await db.query(
                "DELETE FROM temp_registrations WHERE viber_id = ?",
                [viber_id]
              );

              // Логируем успешную регистрацию
              await db.query(
                `INSERT INTO bot_actions (viber_id, action_type, action_data) 
                 VALUES (?, ?, ?)`,
                [viber_id, 'registration', `Регистрация пользователя с участком ${plotNumber} и телефоном ${tempReg.phone}`]
              );

              await sendViberMessage(
                viber_id,
                `Успешная регистрация! Теперь вы можете получать информацию о вашем участке ${plotNumber}.\n\nОтправьте "помощь" для просмотра доступных команд.`,
                getCommandButtons()
              );
            } else {
              console.log('No matching plot found for phone:', tempReg.phone);
              await sendViberMessage(
                viber_id,
                "Участок с таким номером не найден или не привязан к вашему номеру телефона.\n\nПожалуйста, проверьте номер и попробуйте снова.\n\nЕсли вы уверены, что номер правильный, обратитесь в правление.",
                getRegistrationButtons()
              );
            }
          } else if (message_text.toLowerCase() === 'отмена') {
            // Отмена регистрации
            await db.query(
              "DELETE FROM temp_registrations WHERE viber_id = ?",
              [viber_id]
            );
            await sendViberMessage(
              viber_id,
              "Регистрация отменена. Для начала работы с ботом, пожалуйста, отправьте номер вашего телефона в формате 380XXXXXXXXX (без +)"
            );
          } else {
            console.log('Invalid plot number format:', plotNumber);
            await sendViberMessage(
              viber_id,
              "Неверный формат номера участка. Пожалуйста, отправьте только цифры номера участка.",
              getRegistrationButtons()
            );
          }
        }
        return res.status(200).json({ status: "ok" });
      } else if (event === "conversation_started") {
        // Обработка начала диалога с ботом
        if (!sender) {
          console.log('No sender data in conversation_started');
          return res.status(200).json({ status: "ok" });
        }
        console.log('Conversation started with:', sender);
        const viberUser = await getViberUserDetails(viber_id);
        console.log('New user details:', viberUser);

        await sendViberMessage(
          viber_id, 
          "Добро пожаловать! Для начала работы с ботом, пожалуйста, отправьте номер вашего телефона в формате 380XXXXXXXXX.",
          getRegistrationButtons()
        );
      } else if (event === "subscribed") {
        // Обработка подписки на бота
        if (!sender) {
          console.log('No sender data in subscribed');
          return res.status(200).json({ status: "ok" });
        }
        console.log('User subscribed:', sender);
        const viberUser = await getViberUserDetails(viber_id);
        console.log('New subscriber details:', viberUser);

        await sendViberMessage(
          viber_id, 
          "Спасибо за подписку! Для начала работы с ботом, пожалуйста, отправьте номер вашего телефона в формате 380XXXXXXXXX.",
          getRegistrationButtons()
        );
      } else if (event === "delivered" || event === "seen") {
        // Обработка событий доставки и прочтения сообщений
        console.log(`Message ${event} by user ${viber_id}`);
      } else {
        console.log('Received non-message event:', event);
      }

      res.status(200).json({ status: "ok" });
    } catch (err) {
      console.error("Error processing webhook:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  /**
   * Маршрут для отправки уведомлений о новых показаниях счетчика
   * @param {Object} req.body - Данные запроса (user_id, reading_date, value)
   */
  router.post("/notify-reading", async (req, res) => {
    try {
      const { user_id, reading_date, value } = req.body;
      
      // Получаем информацию о пользователе
      const [users] = await db.query(
        "SELECT viber_id, notifications_enabled, plot_number FROM users WHERE id = ?",
        [user_id]
      );

      // Отправляем уведомление, если пользователь подписан и включил уведомления
      if (users.length > 0 && users[0].viber_id && users[0].notifications_enabled) {
        const message = `📊 Новое показание по участку ${users[0].plot_number}:\nДата: ${new Date(reading_date).toLocaleDateString('ru-RU')}\nЗначение: ${value} кВт⋅ч`;
        await sendViberMessage(users[0].viber_id, message, getCommandButtons());
      }

      res.json({ status: "ok" });
    } catch (err) {
      console.error("Error sending reading notification:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  /**
   * Маршрут для отправки уведомлений о новых оплатах
   * @param {Object} req.body - Данные запроса (user_id, payment_date, paid_reading, tariff)
   */
  router.post("/notify-payment", async (req, res) => {
    try {
      const { user_id, payment_date, paid_reading, tariff } = req.body;
      
      // Получаем информацию о пользователе
      const [users] = await db.query(
        "SELECT viber_id, notifications_enabled, plot_number FROM users WHERE id = ?",
        [user_id]
      );

      // Отправляем уведомление, если пользователь подписан и включил уведомления
      if (users.length > 0 && users[0].viber_id && users[0].notifications_enabled) {
        const amount = (paid_reading * tariff).toFixed(2);
        const message = `💰 Новая оплата по участку ${users[0].plot_number}:\nДата: ${new Date(payment_date).toLocaleDateString('ru-RU')}\nОплачено: ${paid_reading} кВт⋅ч\nСумма: ${amount} грн.`;
        await sendViberMessage(users[0].viber_id, message, getCommandButtons());
      }

      res.json({ status: "ok" });
    } catch (err) {
      console.error("Error sending payment notification:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  /**
   * Маршрут для получения истории действий бота
   * Возвращает последние 100 действий с информацией о пользователях
   */
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

  /**
   * Маршрут для получения информации о пользователе
   * @param {Object} req.body - Данные запроса (viber_id)
   */
  router.post("/user-info", async (req, res) => {
    const { viber_id } = req.body;
    if (!viber_id) return res.status(400).json({ error: "viber_id обязателен" });

    try {
      // Получаем основную информацию о пользователе
      const [users] = await db.query("SELECT * FROM users WHERE viber_id = ?", [viber_id]);
      if (users.length === 0) return res.status(404).json({ error: "Пользователь не найден" });
      const user = users[0];

      // Получаем текущий тариф
      const [[tariffRow]] = await db.query(
        `SELECT value FROM tariff ORDER BY effective_date DESC LIMIT 1`
      );
      const tariff = tariffRow?.value || 4.75;

      // Получаем информацию о последней оплате
      const [[lastPayment]] = await db.query(
        `SELECT payment_date, paid_reading, debt, 
          (SELECT value FROM tariff WHERE effective_date <= payment_date ORDER BY effective_date DESC LIMIT 1) as tariff
         FROM payments WHERE user_id = ? ORDER BY payment_date DESC LIMIT 1`,
        [user.id]
      );

      const debt = lastPayment ? lastPayment.debt : null;

      // Получаем показания счетчика за последние 6 месяцев
      const [readings] = await db.query(
        `SELECT reading_date, value 
         FROM readings 
         WHERE user_id = ? AND reading_date >= DATE_SUB(CURDATE(), INTERVAL 6 MONTH)
         ORDER BY reading_date DESC`,
        [user.id]
      );

      // Логируем отправку уведомления
      const message = `Информация по участку ${user.plot_number}: долг ${debt ?? 'нет данных'}`;
      await db.query(
        `INSERT INTO notifications (user_id, message, via, success) VALUES (?, ?, 'viber', true)`,
        [user.id, message]
      );

      // Возвращаем собранную информацию
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

  /**
   * Маршрут для проверки статуса бота
   * Проверяет подключение к API Viber
   */
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

  /**
   * Маршрут для установки вебхука
   * @param {Object} req.body - Данные запроса (webhook_url)
   */
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