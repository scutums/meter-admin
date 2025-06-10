document.addEventListener('DOMContentLoaded', function() {
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

        fetch(`/api/users/${userId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
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
                $('#editUserModal').modal('hide');
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
    fetch('/api/users/users-management')
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
    $('#editUserModal').modal('show');
}

function disconnectViber(userId) {
    if (confirm('Вы уверены, что хотите отключить пользователя от Viber?')) {
        fetch(`/api/users/${userId}/disconnect-viber`, {
            method: 'POST'
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