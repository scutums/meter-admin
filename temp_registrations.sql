CREATE TABLE IF NOT EXISTS temp_registrations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    viber_id VARCHAR(255) NOT NULL,
    phone VARCHAR(20) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY unique_viber_id (viber_id)
); 