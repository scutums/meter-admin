document.addEventListener('DOMContentLoaded', function() {
    // Загрузка навигационной панели
    fetch('/partials/nav.html')
        .then(response => response.text())
        .then(data => {
            document.getElementById('nav-placeholder').innerHTML = data;
        });

    // Получение ID пользователя из URL
    const urlParams = new URLSearchParams(window.location.search);
    const userId = urlParams.get('id');

    if (!userId) {
        alert('ID пользователя не указан');
        window.location.href = '/users-management.html';
        return;
    }

    // Загрузка данных пользователя
    fetch(`/api/users/edit/${userId}`, {
        headers: {
            'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
    })
    .then(response => {
        if (!response.ok) {
            throw new Error('Ошибка при загрузке данных пользователя');
        }
        return response.json();
    })
    .then(user => {
        document.getElementById('userId').value = user.id;
        document.getElementById('plotNumber').textContent = user.plot_number;
        document.getElementById('viberId').textContent = user.viber_id || 'Не подключен';
        document.getElementById('fullName').value = user.full_name;
        document.getElementById('phone').value = user.phone;
        document.getElementById('notifications').textContent = user.notifications_enabled ? 'Включены' : 'Отключены';
        document.getElementById('reminderDay').textContent = user.reminder_day || 'Не установлен';

        // Показываем кнопку отключения Viber только если пользователь подключен
        if (user.viber_id) {
            document.getElementById('disconnectViber').style.display = 'inline-block';
        }
    })
    .catch(error => {
        console.error('Ошибка при загрузке данных пользователя:', error);
        alert('Ошибка при загрузке данных пользователя');
    });

    // Обработка отправки формы
    document.getElementById('editUserForm').addEventListener('submit', function(e) {
        e.preventDefault();

        const userData = {
            full_name: document.getElementById('fullName').value,
            phone: document.getElementById('phone').value
        };

        fetch(`/api/users/edit/${userId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            },
            body: JSON.stringify(userData)
        })
        .then(response => {
            if (!response.ok) {
                throw new Error('Ошибка при обновлении данных');
            }
            return response.json();
        })
        .then(data => {
            if (data.success) {
                alert('Данные успешно обновлены');
                window.location.href = '/users-management.html';
            } else {
                alert(data.message || 'Ошибка при обновлении данных');
            }
        })
        .catch(error => {
            console.error('Ошибка при обновлении данных:', error);
            alert('Ошибка при обновлении данных');
        });
    });

    // Обработка отключения Viber
    document.getElementById('disconnectViber').addEventListener('click', function() {
        if (confirm('Вы уверены, что хотите отключить Viber для этого пользователя?')) {
            fetch(`/api/users/${userId}/disconnect-viber`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('token')}`
                }
            })
            .then(response => {
                if (!response.ok) {
                    throw new Error('Ошибка при отключении Viber');
                }
                return response.json();
            })
            .then(data => {
                if (data.success) {
                    alert('Viber успешно отключен');
                    window.location.reload();
                } else {
                    alert(data.message || 'Ошибка при отключении Viber');
                }
            })
            .catch(error => {
                console.error('Ошибка при отключении Viber:', error);
                alert('Ошибка при отключении Viber');
            });
        }
    });
}); 