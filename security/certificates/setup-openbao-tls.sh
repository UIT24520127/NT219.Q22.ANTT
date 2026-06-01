#!/bin/bash

# ============================================================================
# GENERATE OPENBAO SERVER TLS CERTIFICATE
# ============================================================================
# Tạo server cert cho OpenBao — ký bởi CA nội bộ.
# PHẢI chạy generate-mtls-certs.sh trước.
#
# KHÔNG dùng `docker cp` — cert được mount qua volume:
#   openbao → ./security/certificates/certs:/vault/config/certs:ro
# Sau khi chạy script này, chỉ cần restart container là OpenBao nhận cert mới.
#
# Để OpenBao thực sự dùng TLS, cấu hình bao-config.hcl:
#   listener "tcp" {
#     address       = "0.0.0.0:8200"
#     tls_cert_file = "/vault/config/certs/server-cert.pem"
#     tls_key_file  = "/vault/config/certs/server-key.pem"
#     tls_client_ca_file = "/vault/config/certs/ca-cert.pem"  # bật mTLS
#   }
# Sau đó đổi BAO_ADDR=https://openbao:8200 trong .env
# ============================================================================

set -euo pipefail

CERT_DIR="${MTLS_CERT_DIR:-./security/certificates/certs}"
CERT_VALIDITY_DAYS=365

echo "========================================================================="
echo "  OpenBao Server TLS Certificate Generator"
echo "========================================================================="
echo "  Output dir: $CERT_DIR"
echo "========================================================================="

# CA phải tồn tại trước
if [ ! -f "$CERT_DIR/ca-cert.pem" ] || [ ! -f "$CERT_DIR/ca-key.pem" ]; then
  echo "❌ CA không tồn tại tại $CERT_DIR. Chạy generate-mtls-certs.sh trước."
  exit 1
fi

mkdir -p "$CERT_DIR"

echo "[1/3] Tạo OpenBao server private key (4096-bit)..."
openssl genrsa -out "$CERT_DIR/server-key.pem" 4096

echo "[2/3] Tạo CSR với SAN cho OpenBao..."
TMP_CONF=$(mktemp "$CERT_DIR/openbao-san.XXXXXX.conf")
trap "rm -f $TMP_CONF" EXIT

cat > "$TMP_CONF" << EOF
[req]
distinguished_name = req_distinguished_name
req_extensions = v3_req
prompt = no

[req_distinguished_name]
C  = VN
O  = DRM-System
CN = openbao

[v3_req]
keyUsage = keyEncipherment, dataEncipherment
extendedKeyUsage = serverAuth, clientAuth
subjectAltName = @alt_names

[alt_names]
DNS.1 = openbao
DNS.2 = drm_kms
DNS.3 = localhost
IP.1  = 127.0.0.1
EOF

openssl req -new \
  -key "$CERT_DIR/server-key.pem" \
  -out "$CERT_DIR/openbao.csr" \
  -config "$TMP_CONF"

echo "[3/3] Ký server certificate với CA nội bộ..."
openssl x509 -req \
  -days $CERT_VALIDITY_DAYS \
  -in "$CERT_DIR/openbao.csr" \
  -CA "$CERT_DIR/ca-cert.pem" \
  -CAkey "$CERT_DIR/ca-key.pem" \
  -CAcreateserial \
  -out "$CERT_DIR/server-cert.pem" \
  -extensions v3_req \
  -extfile "$TMP_CONF"

rm -f "$CERT_DIR/openbao.csr"

# Permissions — server-key chỉ owner đọc
chmod 600 "$CERT_DIR/server-key.pem"
chmod 644 "$CERT_DIR/server-cert.pem"

echo ""
echo "========================================================================="
echo "✅ OpenBao Server Certificate Generated!"
echo "========================================================================="
echo ""
echo "  Cert dir (mount vào container qua volume):"
echo "    $CERT_DIR/server-cert.pem  → /vault/config/certs/server-cert.pem"
echo "    $CERT_DIR/server-key.pem   → /vault/config/certs/server-key.pem"
echo "    $CERT_DIR/ca-cert.pem      → /vault/config/certs/ca-cert.pem (trust)"
echo ""
echo "📋 Server cert details:"
openssl x509 -in "$CERT_DIR/server-cert.pem" -noout \
  -subject -issuer -dates
openssl x509 -in "$CERT_DIR/server-cert.pem" -noout -text \
  | grep -A1 "Subject Alternative Name"
echo ""
echo "─────────────────────────────────────────────────────────────────────────"
echo "  Để bật TLS trong OpenBao, sửa security/config/bao-config.hcl:"
echo ""
echo '  listener "tcp" {'
echo '    address            = "0.0.0.0:8200"'
echo '    tls_cert_file      = "/vault/config/certs/server-cert.pem"'
echo '    tls_key_file       = "/vault/config/certs/server-key.pem"'
echo '    tls_client_ca_file = "/vault/config/certs/ca-cert.pem"'
echo '  }'
echo ""
echo "  Sau đó cập nhật .env:"
echo "    BAO_ADDR=https://openbao:8200"
echo ""
echo "  Rồi restart container (cert đã mount sẵn qua volume — không cần build lại):"
echo "    docker compose restart openbao app"
echo "─────────────────────────────────────────────────────────────────────────"
echo ""
echo "⚠️  QUAN TRỌNG — Thứ tự file trong $CERT_DIR:"
echo ""
echo "  File             | app mount | openbao mount | nginx mount"
echo "  -----------------|-----------|---------------|------------"
echo "  ca-cert.pem      | trust CA  | trust CA      | (không dùng)"
echo "  client-cert.pem  | dùng      | verify client | (không dùng)"
echo "  client-key.pem   | dùng      | (không dùng)  | (không dùng)"
echo "  server-cert.pem  | (không)   | serve TLS     | (không dùng)"
echo "  server-key.pem   | (không)   | serve TLS     | (không dùng)"
echo "  nginx-cert.pem   | (không)   | (không dùng)  | → nginx/certs/cert.pem"
echo "  nginx-key.pem    | (không)   | (không dùng)  | → nginx/certs/key.pem"
echo "========================================================================="