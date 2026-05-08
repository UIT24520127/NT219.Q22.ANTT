-- Tạo bảng để lưu trữ thông tin file đã mã hóa
CREATE TABLE IF NOT EXISTS encrypted_files (
    id INT AUTO_INCREMENT PRIMARY KEY,
    file_name VARCHAR(255) NOT NULL,
    ciphertext TEXT NOT NULL,      -- Đây là nơi lưu chuỗi mã hóa trả về từ OpenBao
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- (Tùy chọn) Tạo thêm bảng Audit Log để ghi lại ai đã mã hóa/giải mã
CREATE TABLE IF NOT EXISTS audit_logs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    action VARCHAR(50),            -- 'ENCRYPT' hoặc 'DECRYPT'
    user_id VARCHAR(100),
    target_file VARCHAR(255),
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);