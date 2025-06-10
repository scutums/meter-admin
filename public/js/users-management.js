document.addEventListener('DOMContentLoaded', function() {
    loadNavbar();
    loadUsers();
    setupEventListeners();
});

function setupEventListeners() {
    document.getElementById('saveUserChanges').addEventListener('click', saveUserChanges);
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
        const response = await fetch('/api/users', {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            }
        });
        
        if (!response.ok) {
            throw new Error('Не удалось загрузить данные пользователей');
        }

        const users = await response.json();
        const tableBody = document.getElementById('usersTableBody');
        tableBody.innerHTML = '';

        users.forEach(user => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${user.plot_number}</td>
                <td>${user.full_name}</td>
                <td>${user.phone || '-'}</td>
                <td class="text-center">
                    ${user.viber_registered ? '✅' : '❌'}
                </td>
                <td class="text-center">
                    ${user.reminder_enabled ? '✅' : '❌'}
                </td>
                <td class="text-center">
                    ${user.days_until_reminder !== null ? user.days_until_reminder : '-'}
                </td>
                <td class="text-center">
                    <button class="btn btn-sm btn-primary edit-user" data-user-id="${user.id}">
                        Редактировать
                    </button>
                </td>
            `;
            tableBody.appendChild(row);
        });

        // Добавляем обработчики событий для кнопок редактирования
        document.querySelectorAll('.edit-user').forEach(button => {
            button.addEventListener('click', () => openEditModal(button.dataset.userId));
        });

    } catch (error) {
        console.error('Ошибка загрузки пользователей:', error);
        alert('Ошибка при загрузке данных пользователей');
    }
}

// Открывает модальное окно редактирования
function openEditModal(userId) {
    const user = document.querySelector(`[data-user-id="${userId}"]`).closest('tr');
    const plotNumber = user.cells[0].textContent;
    const fullName = user.cells[1].textContent;
    const phone = user.cells[2].textContent;

    document.getElementById('editUserId').value = userId;
    document.getElementById('editPlotNumber').value = plotNumber;
    document.getElementById('editFullName').value = fullName;
    document.getElementById('editPhone').value = phone;

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