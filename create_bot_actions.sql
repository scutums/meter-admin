CREATE TABLE IF NOT EXISTS bot_actions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    viber_id VARCHAR(255) NOT NULL,
    action_type VARCHAR(50) NOT NULL,
    action_data TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_viber_id (viber_id),
    INDEX idx_created_at (created_at)
); 