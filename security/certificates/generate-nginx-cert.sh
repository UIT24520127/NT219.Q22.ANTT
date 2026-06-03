#!/bin/bash

# ============================================================================
# GENERATE NGINX HTTPS CERTIFICATE (self-signed, ký bởi CA nội bộ)
# ============================================================================
# Tạo cert.pem + key.pem cho nginx HTTPS.
# PHẢI chạy generate-mtls-certs.sh trước (cần CA).
#
# Output: ./security/certificates/certs/
#   cert.pem  → nginx ssl_certificate      (mount: ./security/nginx/certs)
#   key.pem   → nginx ssl_certificate_key  (mount: ./security/nginx/certs)
#
# Script tự copy cert vào ./security/nginx/certs/ sau khi tạo xong
# để khớp với volume mount của nginx trong docker-compose:
#   nginx → ./security/nginx/certs:/etc/nginx/ssl:ro
# ============================================================================

set -euo pipefail

CERT_DIR="${MTLS_CERT_DIR:-./security/certificates/certs}"
NGINX_CERT_DIR="./security/nginx/certs"
CERT_VALIDITY_DAYS=365
DOMAIN="${DOMAIN:-localhost}"   # Override bằng env: DOMAIN=yourdomain.com ./generate-nginx-cert.sh

echo "========================================================================="
echo "  Nginx HTTPS Certificate Generator"
echo "  Domain: $DOMAIN"
echo "========================================================================="

# CA phải tồn tại trước
if [ ! -f "$CERT_DIR/ca-cert.pem" ] || [ ! -f "$CERT_DIR/ca-key.pem" ]; then
  echo "❌ CA không tồn tại tại $CERT_DIR. Chạy generate-mtls-certs.sh trước."
  exit 1
fi

mkdir -p "$NGINX_CERT_DIR" || { echo "❌ Không tạo được $NGINX_CERT_DIR"; exit 1; }

echo "[1/3] Tạo nginx private key..."
openssl genrsa -out "$CERT_DIR/nginx-key.pem" 2048

echo "[2/3] Tạo CSR với SAN (Subject Alternative Names)..."
# SAN bắt buộc với Chrome/Firefox — thiếu SAN sẽ bị ERR_CERT_COMMON_NAME_INVALID
TMP_CONF=$(mktemp "$CERT_DIR/nginx-san.XXXXXX.conf")
trap "rm -f $TMP_CONF" EXIT

cat > "$TMP_CONF" << EOF
[req]
distinguished_name = req_distinguished_name
req_extensions = v3_req
prompt = no

[req_distinguished_name]
C  = VN
O  = DRM-System
CN = $DOMAIN

[v3_req]
keyUsage = digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName = @alt_names

[alt_names]
DNS.1 = $DOMAIN
DNS.2 = www.$DOMAIN
DNS.3 = localhost
DNS.4 = nginx
IP.1  = 127.0.0.1
EOF

openssl req -new \
  -key "$CERT_DIR/nginx-key.pem" \
  -out "$CERT_DIR/nginx.csr" \
  -config "$TMP_CONF"

echo "[3/3] Ký cert bằng CA nội bộ..."
openssl x509 -req \
  -days $CERT_VALIDITY_DAYS \
  -in "$CERT_DIR/nginx.csr" \
  -CA "$CERT_DIR/ca-cert.pem" \
  -CAkey "$CERT_DIR/ca-key.pem" \
  -CAcreateserial \
  -out "$CERT_DIR/nginx-cert.pem" \
  -extensions v3_req \
  -extfile "$TMP_CONF"

rm -f "$CERT_DIR/nginx.csr"

# ─── Copy vào nginx cert dir với tên nginx expect ────────────────────────────
# docker-compose mount: ./security/nginx/certs:/etc/nginx/ssl
# nginx.conf đọc:       /etc/nginx/ssl/cert.pem + /etc/nginx/ssl/key.pem
if [ ! -f "$CERT_DIR/nginx-cert.pem" ]; then
  echo "❌ nginx-cert.pem không được tạo tại $CERT_DIR"
  exit 1
fi
mkdir -p "$NGINX_CERT_DIR"
cp "$CERT_DIR/nginx-cert.pem" "$NGINX_CERT_DIR/cert.pem"
cp "$CERT_DIR/nginx-key.pem"  "$NGINX_CERT_DIR/key.pem"
echo "   ✓ Copied to $NGINX_CERT_DIR/"

# Permissions
chmod 600 "$CERT_DIR/nginx-key.pem"
chmod 644 "$CERT_DIR/nginx-cert.pem"
chmod 600 "$NGINX_CERT_DIR/key.pem"
chmod 644 "$NGINX_CERT_DIR/cert.pem"

echo ""
echo "========================================================================="
echo "✅ Nginx Certificates Generated!"
echo "========================================================================="
echo ""
echo "  Cert dir (nguồn):  $CERT_DIR/nginx-{cert,key}.pem"
echo "  Nginx dir (mount): $NGINX_CERT_DIR/{cert,key}.pem"
echo "    cert.pem → ssl_certificate"
echo "    key.pem  → ssl_certificate_key"
echo ""
echo "📋 Certificate details:"
openssl x509 -in "$CERT_DIR/nginx-cert.pem" -noout \
  -subject -issuer -dates
openssl x509 -in "$CERT_DIR/nginx-cert.pem" -noout -text \
  | grep -A1 "Subject Alternative Name"
echo ""

if [ "$DOMAIN" = "localhost" ]; then
  echo "⚠️  Đây là self-signed cert cho localhost."
  echo "   Browser sẽ cảnh báo — trust CA vào system để bỏ cảnh báo:"
  echo ""
  echo "   macOS:"
  echo "     sudo security add-trusted-cert -d -r trustRoot \\"
  echo "       -k /Library/Keychains/System.keychain $CERT_DIR/ca-cert.pem"
  echo ""
  echo "   Windows (PowerShell admin):"
  echo "     Import-Certificate -FilePath $CERT_DIR/ca-cert.pem \\"
  echo "       -CertStoreLocation Cert:\LocalMachine\Root"
  echo ""
  echo "   Linux:"
  echo "     sudo cp $CERT_DIR/ca-cert.pem /usr/local/share/ca-certificates/drm-ca.crt"
  echo "     sudo update-ca-certificates"
else
  echo "💡 Cho production với domain thật, dùng Let's Encrypt thay self-signed:"
  echo "   sudo certbot certonly --standalone -d $DOMAIN"
  echo "   Sau đó mount /etc/letsencrypt/live/$DOMAIN/ vào nginx."
fi
echo "========================================================================="