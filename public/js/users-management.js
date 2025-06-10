document.addEventListener('DOMContentLoaded', function() {
    loadUsers();
    setupEventListeners();
});

function setupEventListeners() {
    document.getElementById('saveUserChanges').addEventListener('click', saveUserChanges);
}

async function loadUsers() {
    try {
        const response = await fetch('/api/users', {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            }
        });
        
        if (!response.ok) {
            throw new Error('Failed to load users');
        }

        const users = await response.json();
        const tableBody = document.getElementById('usersTableBody');
        tableBody.innerHTML = '';

        users.forEach(user => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${user.plot_number}</td>
                <td>${user.full_name}</td>
                <td>${user.phone || ''}</td>
                <td>
                    <button class="btn btn-sm btn-primary edit-user" data-user-id="${user.id}">
                        Редактировать
                    </button>
                </td>
            `;
            tableBody.appendChild(row);
        });

        // Add event listeners to edit buttons
        document.querySelectorAll('.edit-user').forEach(button => {
            button.addEventListener('click', () => openEditModal(button.dataset.userId));
        });

    } catch (error) {
        console.error('Error loading users:', error);
        alert('Ошибка при загрузке данных пользователей');
    }
}

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
            throw new Error('Failed to update user');
        }

        // Close modal and reload users
        const modal = bootstrap.Modal.getInstance(document.getElementById('editUserModal'));
        modal.hide();
        loadUsers();
        
        alert('Данные успешно обновлены');
    } catch (error) {
        console.error('Error updating user:', error);
        alert('Ошибка при обновлении данных пользователя');
    }
} 