#!/bin/bash

# ============================================================================
# SCRIPT KIỂM THỬ TỔNG THỂ HỆ THỐNG DRM
# ============================================================================
# Script này sẽ kiểm tra:
# 1. Trạng thái hoạt động của các Docker Containers
# 2. Vùng Tối (Dark Zone) của DB và KMS
# 3. Rules cấu hình của tường lửa Nginx (Allow/Block API)
# 4. Trạng thái của OpenBao KMS
# 5. Quyền thực thi của script upload R2
# ============================================================================

echo "========================================================================="
echo "  🛠️ BẮT ĐẦU KIỂM TRA HỆ THỐNG"
echo "========================================================================="

# ============================================================================
# 1. KIỂM TRA CONTAINERS
# ============================================================================
echo "1️⃣ Kiểm tra trạng thái Docker Containers..."
if ! docker-compose ps | grep -q "Up"; then
    echo "❌ LỖI: Docker Compose có vẻ chưa được khởi động (docker-compose up -d)."
    exit 1
else
    echo "✅ Các container đang hoạt động."
fi

# ============================================================================
# 2. KIỂM TRA VÙNG TỐI (DARK ZONE)
# ============================================================================
echo ""
echo "2️⃣ Kiểm tra tính biệt lập của Database và KMS..."

# Hàm check port sử dụng bash builtin
check_port() {
    local port=$1
    if timeout 1 bash -c "</dev/tcp/127.0.0.1/$port" 2>/dev/null; then
        return 0 # Port is open
    else
        return 1 # Port is closed
    fi
}

if check_port 3306; then
    echo "❌ LỖI: Port 3306 (MariaDB) vẫn đang bị mở ra ngoài máy host!"
else
    echo "✅ MariaDB đã được giấu an toàn trong Vùng Tối."
fi

if check_port 8200; then
    echo "❌ LỖI: Port 8200 (OpenBao) vẫn đang bị mở ra ngoài máy host!"
else
    echo "✅ OpenBao đã được giấu an toàn trong Vùng Tối."
fi

# ============================================================================
# 3. KIỂM TRA TƯỜNG LỬA NGINX
# ============================================================================
echo ""
echo "3️⃣ Kiểm tra Tường lửa Nginx (API Routing)..."

# Hàm test Nginx API
test_api() {
    local endpoint=$1
    local expect_blocked=$2
    # Gửi request HTTPS bỏ qua xác thực chứng chỉ (do có thể dùng self-signed)
    local status=$(curl -s -o /dev/null -w "%{http_code}" -k https://localhost${endpoint})
    
    if [ "$expect_blocked" = true ]; then
        if [ "$status" = "403" ]; then
            echo "  ✅ Đã CHẶN thành công: $endpoint (HTTP $status)"
        else
            echo "  ❌ LỖI BẢO MẬT: Không chặn được $endpoint (HTTP $status, thay vì 403)"
        fi
    else
        if [ "$status" = "403" ]; then
            echo "  ❌ LỖI: Bị chặn sai (False positive) tại $endpoint (HTTP $status)"
        elif [ "$status" = "000" ]; then
            echo "  ❌ LỖI: Không thể kết nối tới Nginx ở port 443!"
        else
            echo "  ✅ Đã CHO PHÉP thành công: $endpoint (HTTP $status)"
        fi
    fi
}

# Các route hợp lệ
test_api "/" false
test_api "/api/license/v1/get" false
test_api "/api/auth/login" false
test_api "/api/media/signed-url" false
test_api "/api/ingest/upload" false

# Các route giả lập tấn công / cần bị chặn
test_api "/api/database/dump" true
test_api "/api/admin/users" true
test_api "/api/secret/keys" true

# ============================================================================
# 4. KIỂM TRA OPENBAO KMS
# ============================================================================
echo ""
echo "4️⃣ Kiểm tra trạng thái OpenBao KMS (Transit Engine)..."
BAO_TOKEN="root-token"
if docker exec -e BAO_TOKEN=$BAO_TOKEN drm_kms bao secrets list 2>/dev/null | grep -q "transit/"; then
    echo "✅ OpenBao Transit Engine đã được cấu hình và kích hoạt."
else
    echo "⚠️ CẢNH BÁO: OpenBao Transit Engine chưa được kích hoạt!"
    echo "   Bạn có thể cần chạy script: ./security/openbao/setup-bao.sh"
fi

# ============================================================================
# 5. KIỂM TRA SCRIPT UPLOAD R2
# ============================================================================
echo ""
echo "5️⃣ Kiểm tra Script Upload R2..."
if [ -x "ingest/scripts/upload_to_r2.sh" ]; then
    echo "✅ Script upload_to_r2.sh đã tồn tại và có quyền thực thi."
else
    echo "❌ LỖI: Không tìm thấy script upload_to_r2.sh hoặc nó chưa được cấp quyền thực thi (chmod +x)."
fi

echo "========================================================================="
echo "  🎉 HOÀN TẤT KIỂM TRA"
echo "========================================================================="
