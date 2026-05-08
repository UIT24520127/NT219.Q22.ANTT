#!/bin/bash

# Đợi OpenBao khởi động xong
echo "Waiting for OpenBao to start..."
sleep 5

# Kích hoạt Transit Secret Engine (Trọng tâm Mật mã học)
docker exec drm_kms bao secrets enable transit

# Tạo Master Key có tên là 'music-app-key' 
# Khóa này dùng để mã hóa các CEK (Envelope Encryption)
docker exec drm_kms bao write -f transit/keys/music-app-key

echo "--- OpenBao Transit Engine is ready! ---"