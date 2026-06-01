#!/bin/bash

# ============================================================================
# GENERATE mTLS CERTIFICATES FOR NEXT.JS → OPENBAO COMMUNICATION
# ============================================================================
# Tạo: CA cert/key + client cert/key (Next.js dùng để authenticate với OpenBao)
#
# Thứ tự chạy:
#   1. ./generate-mtls-certs.sh      ← script này (tạo CA trước)
#   2. ./generate-nginx-cert.sh      ← dùng CA vừa tạo
#   3. ./setup-openbao-tls.sh        ← dùng CA vừa tạo
#
# Output: ./security/certificates/certs/
#   ca-cert.pem      → CA gốc (dùng chung cho cả 3 script)
#   ca-key.pem       → CA private key (bảo mật, không commit git)
#   client-cert.pem  → Next.js app dùng để xác thực với OpenBao
#   client-key.pem   → Next.js app private key
#
# Docker mounts (khớp với docker-compose.yml):
#   app     → ./security/certificates/certs:/app/certs:ro
#   openbao → ./security/certificates/certs:/vault/config/certs:ro
# ============================================================================

set -euo pipefail

# ─── Đây là CERT_DIR chuẩn — khớp với volume mount trong docker-compose ────
CERT_DIR="${MTLS_CERT_DIR:-./security/certificates/certs}"
CERT_VALIDITY_DAYS=365

echo "========================================================================="
echo "  mTLS Certificate Generator (CA + Client)"
echo "========================================================================="
echo "  Output dir: $CERT_DIR"
echo "========================================================================="

mkdir -p "$CERT_DIR"
chmod 755 "$CERT_DIR"

# ─── Nếu CA đã tồn tại thì không tạo lại ─────────────────────────────────────
# Việc tạo CA mới sẽ làm mọi cert cũ (nginx, server, client) invalid
if [ -f "$CERT_DIR/ca-cert.pem" ] && [ -f "$CERT_DIR/ca-key.pem" ]; then
  echo ""
  echo "⚠️  CA đã tồn tại tại $CERT_DIR/ca-cert.pem"
  echo "   Bỏ qua bước tạo CA — dùng lại CA cũ để các cert khác vẫn valid."
  echo "   Nếu muốn tạo lại CA (invalidate tất cả cert cũ), xóa file rồi chạy lại:"
  echo "     rm $CERT_DIR/ca-*.pem && $0"
  echo ""
else
  echo "[1/2] Tạo CA private key (4096-bit)..."
  openssl genrsa -out "$CERT_DIR/ca-key.pem" 4096

  # Dùng config file thay vì -subj inline để tránh Git Bash path conversion
  TMP_CA_CONF=$(mktemp "$CERT_DIR/ca-req.XXXXXX.conf")
  cat > "$TMP_CA_CONF" << EOF
[req]
distinguished_name = req_distinguished_name
prompt = no

[req_distinguished_name]
CN = DRM-KMS-CA
O  = DRM-System
C  = VN
EOF

  echo "[2/2] Tạo CA self-signed certificate..."
  openssl req -new -x509 \
    -days $CERT_VALIDITY_DAYS \
    -key "$CERT_DIR/ca-key.pem" \
    -out "$CERT_DIR/ca-cert.pem" \
    -config "$TMP_CA_CONF"

  rm -f "$TMP_CA_CONF"
  chmod 600 "$CERT_DIR/ca-key.pem"   # CA key phải bảo mật nhất
  chmod 644 "$CERT_DIR/ca-cert.pem"
  echo "✅ CA tạo xong."
fi

echo ""
echo "[3/4] Tạo client (Next.js app) private key..."
openssl genrsa -out "$CERT_DIR/client-key.pem" 4096

echo "[4/4] Tạo và ký client certificate..."
# Dùng config file thay vì -subj inline để tránh Git Bash path conversion
TMP_CLIENT_CONF=$(mktemp "$CERT_DIR/client-req.XXXXXX.conf")
trap "rm -f $TMP_CLIENT_CONF" EXIT

cat > "$TMP_CLIENT_CONF" << EOF
[req]
distinguished_name = req_distinguished_name
prompt = no

[req_distinguished_name]
CN = drm-backend
O  = DRM-System
C  = VN
EOF

openssl req -new \
  -key "$CERT_DIR/client-key.pem" \
  -config "$TMP_CLIENT_CONF" \
| openssl x509 -req \
    -days $CERT_VALIDITY_DAYS \
    -CA "$CERT_DIR/ca-cert.pem" \
    -CAkey "$CERT_DIR/ca-key.pem" \
    -CAcreateserial \
    -out "$CERT_DIR/client-cert.pem"

# Permissions: key phải chỉ owner đọc được
chmod 600 "$CERT_DIR/client-key.pem"
chmod 644 "$CERT_DIR/client-cert.pem"

echo ""
echo "========================================================================="
echo "✅ mTLS Certificates Generated!"
echo "========================================================================="
echo ""
echo "  $CERT_DIR/"
echo "    ca-cert.pem      CA certificate (dùng chung)"
echo "    ca-key.pem       CA private key  ← KHÔNG commit git"
echo "    client-cert.pem  Next.js client cert"
echo "    client-key.pem   Next.js client key ← KHÔNG commit git"
echo ""
echo "📋 Client cert details:"
openssl x509 -in "$CERT_DIR/client-cert.pem" -noout \
  -subject -issuer -dates
echo ""
echo "➡️  Bước tiếp theo:"
echo "   ./generate-nginx-cert.sh    (tạo nginx TLS cert)"
echo "   ./setup-openbao-tls.sh      (tạo OpenBao server cert)"
echo "========================================================================="