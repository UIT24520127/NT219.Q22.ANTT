#!/bin/bash

# 1. Định nghĩa các cấu hình endpoint non-sensitive từ hệ thống
BAO_API_URL=${BAO_ADDR:-"http://127.0.0.1:8200"}
BAO_TOKEN=${BAO_DEV_ROOT_TOKEN_ID:-"root-token"}
KMS_KEY_NAME=${KMS_TRANSIT_KEY_NAME:-"music-app-key"}
CONTAINER_NAME="drm_kms"

echo "[KMS INIT] Đang chờ dịch vụ OpenBao tại ${BAO_API_URL} khởi động..."

# Vòng lặp kiểm tra trạng thái cho đến khi OpenBao mở cổng hoàn toàn (Tốt hơn dùng lệnh sleep cố định)
until docker exec -e BAO_TOKEN="$BAO_TOKEN" -e VAULT_TOKEN="$BAO_TOKEN" $CONTAINER_NAME bao status > /dev/null 2>&1; do
  echo "..."
  sleep 2
done

echo "[KMS INIT] OpenBao đã sẵn sàng kết nối!"

# 2. Kích hoạt Transit Secret Engine để mã hóa/giải mã tầng ứng dụng (Application-layer Encryption)
# Kiểm tra nếu chưa bật engine thì mới kích hoạt để tránh báo lỗi lặp lại (Idempotent script)
if ! docker exec -e BAO_TOKEN="$BAO_TOKEN" -e VAULT_TOKEN="$BAO_TOKEN" $CONTAINER_NAME bao secrets list | grep -q "transit/"; then
  echo "[KMS INIT] Kích hoạt Transit Secret Engine..."
  docker exec -e BAO_TOKEN="$BAO_TOKEN" -e VAULT_TOKEN="$BAO_TOKEN" $CONTAINER_NAME bao secrets enable transit
else
  echo "[KMS INIT] Transit Secret Engine đã được bật trước đó."
fi

# 3. Tạo Master Key (Root Key) phục vụ cơ chế Envelope Encryption bảo vệ CEK
# Khóa này được OpenBao sinh ra và lưu hoàn toàn trong bộ nhớ RAM cô lập
echo "[KMS INIT] Khởi tạo Master Key: '${KMS_KEY_NAME}'..."
docker exec -e BAO_TOKEN="$BAO_TOKEN" -e VAULT_TOKEN="$BAO_TOKEN" $CONTAINER_NAME bao write -f transit/keys/$KMS_KEY_NAME

echo "--------------------------------------------------------"
echo "[SUCCESS] Hệ thống Quản lý khóa OpenBao đã sẵn sàng!"
echo "Master Key: ${KMS_KEY_NAME}"
echo "--------------------------------------------------------"