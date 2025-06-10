document.addEventListener('DOMContentLoaded', function() {
    // Проверяем наличие токена
    const token = localStorage.getItem("token");
    if (!token) {
        window.location.href = "/login.html";
        return;
    }

    // Загрузка навигационной панели
    fetch('/partials/nav.html')
        .then(response => response.text())
        .then(html => {
            document.getElementById('nav-placeholder').innerHTML = html;
        });

    // Загрузка пользователей
    loadUsers();

    // Обработчик формы редактирования
    document.getElementById('editUserForm').addEventListener('submit', function(e) {
        e.preventDefault();
        const userId = document.getElementById('editUserId').value;
        const fullName = document.getElementById('editFullName').value;
        const phone = document.getElementById('editPhone').value;

        fetch(`/api/users-management/update/${userId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                full_name: fullName,
                phone: phone
            })
        })
        .then(response => response.json())
        .then(data => {
            if (data.error) {
                alert('Ошибка: ' + data.error);
            } else {
                alert('Данные успешно обновлены');
                hideEditForm();
                loadUsers();
            }
        })
        .catch(error => {
            console.error('Ошибка:', error);
            alert('Произошла ошибка при обновлении данных');
        });
    });
});

function loadUsers() {
    const token = localStorage.getItem("token");
    fetch('/api/users-management/list', {
        headers: {
            'Authorization': `Bearer ${token}`
        }
    })
    .then(response => response.json())
    .then(users => {
        const tbody = document.querySelector('#usersTable tbody');
        tbody.innerHTML = '';

        users.forEach(user => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${user.plot_number}</td>
                <td>${user.full_name}</td>
                <td>${user.phone}</td>
                <td>${user.viber_id ? 'Да' : 'Нет'}</td>
                <td>${user.notifications_enabled ? 'Включены' : 'Отключены'}</td>
                <td>${user.reminder_day || '-'}</td>
                <td>${user.viber_details || '-'}</td>
                <td>
                    <button class="btn btn-sm btn-primary" onclick="editUser(${user.id}, '${user.full_name}', '${user.phone}')">
                        Редактировать
                    </button>
                    ${user.viber_id ? `
                        <button class="btn btn-sm btn-danger" onclick="disconnectViber(${user.id})">
                            Отключить Viber
                        </button>
                    ` : ''}
                </td>
            `;
            tbody.appendChild(row);
        });
    })
    .catch(error => {
        console.error('Ошибка:', error);
        alert('Произошла ошибка при загрузке данных');
    });
}

function editUser(id, fullName, phone) {
    document.getElementById('editUserId').value = id;
    document.getElementById('editFullName').value = fullName;
    document.getElementById('editPhone').value = phone;
    document.getElementById('editFormContainer').style.display = 'block';
    // Прокручиваем к форме
    document.getElementById('editFormContainer').scrollIntoView({ behavior: 'smooth' });
}

function hideEditForm() {
    document.getElementById('editFormContainer').style.display = 'none';
    document.getElementById('editUserForm').reset();
}

function disconnectViber(userId) {
    if (confirm('Вы уверены, что хотите отключить пользователя от Viber?')) {
        const token = localStorage.getItem("token");
        fetch(`/api/users-management/disconnect-viber/${userId}`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        })
        .then(response => response.json())
        .then(data => {
            if (data.error) {
                alert('Ошибка: ' + data.error);
            } else {
                alert('Пользователь успешно отключен от Viber');
                loadUsers();
            }
        })
        .catch(error => {
            console.error('Ошибка:', error);
            alert('Произошла ошибка при отключении пользователя от Viber');
        });
    }
} 