$(document).ready(function() {
    const table = $('#actionsTable').DataTable({
        ajax: {
            url: '/api/viber/bot-actions',
            dataSrc: ''
        },
        columns: [
            { 
                data: 'created_at',
                render: function(data) {
                    return new Date(data).toLocaleString('ru-RU');
                }
            },
            { data: 'plot_number' },
            { data: 'full_name' },
            { 
                data: 'action_type',
                render: function(data) {
                    return `<span class="action-type ${data}">${data}</span>`;
                }
            },
            { data: 'action_data' }
        ],
        order: [[0, 'desc']],
        language: {
            url: '//cdn.datatables.net/plug-ins/1.10.24/i18n/Russian.json'
        },
        pageLength: 25,
        responsive: true,
        dom: '<"row"<"col-sm-12 col-md-6"l><"col-sm-12 col-md-6"f>>' +
             '<"row"<"col-sm-12"tr>>' +
             '<"row"<"col-sm-12 col-md-5"i><"col-sm-12 col-md-7"p>>',
        initComplete: function() {
            // Добавляем классы Bootstrap к элементам DataTables
            $('.dataTables_length select').addClass('form-select');
            $('.dataTables_filter input').addClass('form-control');
        }
    });

    // Обновление данных каждые 30 секунд
    setInterval(function() {
        table.ajax.reload(null, false);
    }, 30000);
}); 