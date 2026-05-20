-- Tạo bảng để lưu trữ thông tin file đã mã hóa
CREATE TABLE IF NOT EXISTS encrypted_files (
    id INT AUTO_INCREMENT PRIMARY KEY,
    file_name VARCHAR(255) NOT NULL,
    ciphertext TEXT NOT NULL,      -- Đây là nơi lưu chuỗi mã hóa trả về từ OpenBao
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tạo bảng tracks để lưu trữ thông tin nhạc/media cần mã hóa DASH
CREATE TABLE IF NOT EXISTS tracks (
    id VARCHAR(36) PRIMARY KEY,                -- UUID (track_id)
    filename VARCHAR(255) NOT NULL,           -- Tên file gốc (e.g., song.m4a)
    duration INT DEFAULT 0,                   -- Độ dài nhạc tính bằng giây
    kid VARCHAR(32) NOT NULL UNIQUE,          -- Key ID (16 bytes hex string, Widevine standard)
    encrypted_cek TEXT NOT NULL,              -- Chuỗi mã hóa CEK từ OpenBao (vault:v1:...)
    source_format VARCHAR(20),                -- Định dạng gốc (e.g., AAC, M4A)
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_kid (kid),
    INDEX idx_created_at (created_at)
);

-- Tạo bảng dash_manifests để lưu trữ metadata của DASH packages
CREATE TABLE IF NOT EXISTS dash_manifests (
    id INT AUTO_INCREMENT PRIMARY KEY,
    track_id VARCHAR(36) NOT NULL,            -- FK tới tracks.id
    mpd_path VARCHAR(255) NOT NULL,           -- Đường dẫn tới file .mpd
    manifest_data LONGTEXT,                   -- Nội dung MPD XML (optional, lưu cache)
    is_active BOOLEAN DEFAULT 1,              -- Xác định manifest có đang dùng hay không
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE CASCADE,
    INDEX idx_track_id (track_id),
    INDEX idx_is_active (is_active)
);

-- (Tùy chọn) Tạo thêm bảng Audit Log để ghi lại ai đã mã hóa/giải mã
CREATE TABLE IF NOT EXISTS audit_logs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    action VARCHAR(50),            -- 'ENCRYPT', 'DECRYPT', 'PACKAGE_CREATED', 'LICENSE_ISSUED'
    user_id VARCHAR(100),
    target_file VARCHAR(255),
    track_id VARCHAR(36),          -- FK để liên kết với track nếu có
    kid VARCHAR(32),               -- Key ID cho audit trail
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_track_id (track_id),
    INDEX idx_kid (kid),
    INDEX idx_timestamp (timestamp)
);