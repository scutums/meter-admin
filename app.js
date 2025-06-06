// Маршрут для страницы действий бота
app.get('/bot-actions', (req, res) => {
    res.sendFile(path.join(__dirname, 'bot-actions.html'));
}); 