document.addEventListener('DOMContentLoaded', function() {
    // Проверяем наличие токена
    const token = localStorage.getItem("token");
    if (!token) {
        window.location.href = "/login.html";
        return;
    }

    // Инициализируем страницу
    initializePage();
});

async function initializePage() {
    try {
        await loadNavbar();
        await loadUsers();
        setupEventListeners();
    } catch (error) {
        console.error("Ошибка инициализации страницы:", error);
        alert("Ошибка при загрузке страницы");
    }
}

function setupEventListeners() {
    document.getElementById('saveUserChanges').addEventListener('click', saveUserChanges);
    document.getElementById('disconnectViber').addEventListener('click', disconnectViber);
}

// Загружает навигационную панель
async function loadNavbar() {
    const res = await fetch("/partials/nav.html");
    const html = await res.text();
    document.getElementById("navbar-placeholder").innerHTML = html;

    try {
        const token = localStorage.getItem("token");
        const resUser = await fetch("/api/auth-user-info", {
            headers: { Authorization: "Bearer " + token }
        });
        if (resUser.ok) {
            const user = await resUser.json();
            document.getElementById("username").textContent = "👤 " + (user.full_name || user.plot_number || "Пользователь");
        } else {
            document.getElementById("username").textContent = "👤 Пользователь";
        }
    } catch {
        document.getElementById("username").textContent = "👤 Пользователь";
    }

    document.getElementById("logoutBtn")?.addEventListener("click", () => {
        localStorage.removeItem("token");
        window.location.href = "/login.html";
    });
}

// Загружает список пользователей
async function loadUsers() {
    try {
        const token = localStorage.getItem('token');
        const response = await fetch("/api/users-management", {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        if (!response.ok) {
            throw new Error("Ошибка загрузки данных");
        }
        const users = await response.json();
        const tbody = document.getElementById("usersTableBody");
        if (!tbody) {
            throw new Error("Элемент таблицы не найден");
        }
        tbody.innerHTML = "";
        
        users.forEach(user => {
            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td>${user.plot_number}</td>
                <td>${user.full_name}</td>
                <td>${user.phone}</td>
                <td>${user.viber_id || '-'}</td>
                <td>${user.notifications_enabled ? 'Да' : 'Нет'}</td>
                <td>${user.reminder_day || '-'}</td>
                <td>
                    <button class="btn btn-sm btn-primary edit-btn" data-id="${user.id}">
                        Редактировать
                    </button>
                </td>
            `;
            tbody.appendChild(tr);
        });

        // Добавляем обработчики для кнопок редактирования
        document.querySelectorAll(".edit-btn").forEach(btn => {
            btn.addEventListener("click", () => {
                const userId = btn.dataset.id;
                const user = users.find(u => u.id === parseInt(userId));
                if (user) {
                    openEditModal(user);
                }
            });
        });
    } catch (error) {
        console.error("Ошибка:", error);
        alert("Ошибка при загрузке данных");
    }
}

// Открывает модальное окно редактирования
function openEditModal(user) {
    document.getElementById('editUserId').value = user.id;
    document.getElementById('editPlotNumber').textContent = user.plot_number;
    document.getElementById('editFullName').value = user.full_name;
    document.getElementById('editPhone').value = user.phone;
    document.getElementById('editViberId').textContent = user.viber_id || '-';
    document.getElementById('editNotificationsEnabled').textContent = user.notifications_enabled ? 'Включены' : 'Отключены';
    document.getElementById('editReminderDay').textContent = user.reminder_day || '-';

    // Показываем/скрываем кнопку отключения Viber
    const disconnectButton = document.getElementById('disconnectViber');
    disconnectButton.style.display = user.viber_id ? 'block' : 'none';

    const modal = new bootstrap.Modal(document.getElementById('editUserModal'));
    modal.show();
}

// Сохраняет изменения данных пользователя
async function saveUserChanges() {
    const userId = document.getElementById('editUserId').value;
    const fullName = document.getElementById('editFullName').value;
    const phone = document.getElementById('editPhone').value;

    try {
        const response = await fetch(`/api/users/${userId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            },
            body: JSON.stringify({
                full_name: fullName,
                phone: phone
            })
        });

        if (!response.ok) {
            throw new Error('Не удалось обновить данные пользователя');
        }

        // Закрываем модальное окно и обновляем список
        const modal = bootstrap.Modal.getInstance(document.getElementById('editUserModal'));
        modal.hide();
        loadUsers();
        
        alert('Данные успешно обновлены');
    } catch (error) {
        console.error('Ошибка обновления пользователя:', error);
        alert('Ошибка при обновлении данных пользователя');
    }
}

// Отключает пользователя от Viber
async function disconnectViber() {
    if (!confirm('Вы уверены, что хотите отключить пользователя от Viber?')) {
        return;
    }

    const userId = document.getElementById('editUserId').value;

    try {
        const token = localStorage.getItem('token');
        const response = await fetch(`/api/users/${userId}/disconnect-viber`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (!response.ok) {
            throw new Error('Не удалось отключить пользователя от Viber');
        }

        // Закрываем модальное окно и обновляем список
        const modal = bootstrap.Modal.getInstance(document.getElementById('editUserModal'));
        modal.hide();
        await loadUsers();
        
        alert('Пользователь успешно отключен от Viber');
    } catch (error) {
        console.error('Ошибка отключения от Viber:', error);
        alert('Ошибка при отключении пользователя от Viber');
    }
} 