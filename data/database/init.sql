-- [THÊM] Database cho Keycloak (phải tạo trước khi Keycloak start)
CREATE DATABASE IF NOT EXISTS keycloak
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

-- [XÓA] encrypted_files — thừa, đã được thay bởi bảng tracks
-- CREATE TABLE IF NOT EXISTS encrypted_files ...

CREATE TABLE IF NOT EXISTS tracks (
    id VARCHAR(36) PRIMARY KEY,
    filename VARCHAR(255) NOT NULL,
    duration INT DEFAULT 0,
    kid VARCHAR(32) NOT NULL UNIQUE,
    encrypted_cek TEXT NOT NULL,
    source_format VARCHAR(20),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_kid (kid),
    INDEX idx_created_at (created_at)
);

CREATE TABLE IF NOT EXISTS dash_manifests (
    id INT AUTO_INCREMENT PRIMARY KEY,
    track_id VARCHAR(36) NOT NULL,
    mpd_path VARCHAR(255) NOT NULL,
    manifest_data LONGTEXT,
    is_active BOOLEAN DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE CASCADE,
    INDEX idx_track_id (track_id),
    INDEX idx_is_active (is_active)
);

CREATE TABLE IF NOT EXISTS audit_logs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    action VARCHAR(50),
    user_id VARCHAR(100),
    target_file VARCHAR(255),
    track_id VARCHAR(36),
    kid VARCHAR(32),
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_track_id (track_id),
    INDEX idx_kid (kid),
    INDEX idx_timestamp (timestamp)
);