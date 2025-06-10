document.addEventListener('DOMContentLoaded', function() {
    // Загрузка навигационной панели
    fetch('/partials/nav.html')
        .then(response => response.text())
        .then(data => {
            document.getElementById('nav-placeholder').innerHTML = data;
        });

    // Загрузка пользователей
    loadUsers();
});

function loadUsers() {
    fetch('/api/users-management', {
        headers: {
            'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
    })
    .then(response => response.json())
    .then(users => {
        const tbody = document.getElementById('usersTableBody');
        tbody.innerHTML = '';

        users.forEach(user => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${user.plot_number}</td>
                <td>${user.full_name}</td>
                <td>${user.phone}</td>
                <td>${user.viber_id || 'Не подключен'}</td>
                <td>${user.notifications_enabled ? 'Включены' : 'Отключены'}</td>
                <td>${user.reminder_day || 'Не установлен'}</td>
                <td>
                    <a href="/edit-user.html?id=${user.id}" class="btn btn-primary btn-sm">
                        <i class="fas fa-edit"></i> Редактировать
                    </a>
                </td>
            `;
            tbody.appendChild(row);
        });
    })
    .catch(error => {
        console.error('Ошибка при загрузке пользователей:', error);
        alert('Ошибка при загрузке пользователей');
    });
} 