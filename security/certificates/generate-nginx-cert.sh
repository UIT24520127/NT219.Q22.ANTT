#!/bin/bash

# ============================================================================
# GENERATE NGINX HTTPS CERTIFICATE (self-signed, localhost)
# ============================================================================
# Tạo cert.pem + key.pem cho nginx HTTPS.
# Chạy SAU generate-mtls-certs.sh (dùng chung CA đã tạo).
#
# USAGE:
#   chmod +x security/certificates/generate-nginx-cert.sh
#   ./security/certificates/generate-nginx-cert.sh
# ============================================================================

set -e

CERT_DIR="${MTLS_CERT_DIR:-./security/nginx}/certs"
CERT_VALIDITY_DAYS=365

echo "========================================================================="
echo "  Nginx HTTPS Certificate Generator"
echo "========================================================================="

# Kiểm tra CA đã tạo chưa (cần chạy generate-mtls-certs.sh trước)
if [ ! -f "$CERT_DIR/ca-cert.pem" ] || [ ! -f "$CERT_DIR/ca-key.pem" ]; then
    echo "❌ CA chưa tồn tại. Chạy generate-mtls-certs.sh trước."
    exit 1
fi

mkdir -p "$CERT_DIR"

echo "[1/3] Tạo nginx private key..."
openssl genrsa -out "$CERT_DIR/key.pem" 2048

echo "[2/3] Tạo certificate signing request..."
# SAN bắt buộc với Chrome/Firefox hiện đại — thiếu SAN sẽ bị reject
cat > /tmp/nginx-san.conf << EOF
[req]
distinguished_name = req_distinguished_name
req_extensions = v3_req
prompt = no

[req_distinguished_name]
C  = VN
O  = DRM-System
CN = localhost

[v3_req]
keyUsage = keyEncipherment, dataEncipherment
extendedKeyUsage = serverAuth
subjectAltName = @alt_names

[alt_names]
DNS.1 = localhost
DNS.2 = nginx
DNS.3 = drm_nginx
IP.1  = 127.0.0.1
IP.2  = ::1
EOF

openssl req -new \
  -key "$CERT_DIR/key.pem" \
  -out /tmp/nginx.csr \
  -config /tmp/nginx-san.conf

echo "[3/3] Ký cert bằng CA nội bộ..."
openssl x509 -req \
  -days $CERT_VALIDITY_DAYS \
  -in /tmp/nginx.csr \
  -CA "$CERT_DIR/ca-cert.pem" \
  -CAkey "$CERT_DIR/ca-key.pem" \
  -CAcreateserial \
  -out "$CERT_DIR/cert.pem" \
  -extensions v3_req \
  -extfile /tmp/nginx-san.conf

# Dọn dẹp
rm /tmp/nginx.csr /tmp/nginx-san.conf

# Permissions
chmod 600 "$CERT_DIR/key.pem"
chmod 644 "$CERT_DIR/cert.pem"

echo ""
echo "========================================================================="
echo "✅ Nginx HTTPS Certificate Generated!"
echo "========================================================================="
echo ""
echo "Files tạo ra (mount vào nginx tại /etc/nginx/ssl/):"
echo "  $CERT_DIR/cert.pem   ← ssl_certificate"
echo "  $CERT_DIR/key.pem    ← ssl_certificate_key"
echo ""
echo "📋 Certificate Details:"
openssl x509 -in "$CERT_DIR/cert.pem" -text -noout \
  | grep -E "Subject:|Issuer:|Not Before:|Not After :|DNS:|IP Address"
echo ""
echo "⚠️  Browser sẽ cảnh báo self-signed cert."
echo "   Để bỏ cảnh báo khi dev, trust CA vào system:"
echo ""
echo "   Windows (PowerShell admin):"
echo "     Import-Certificate -FilePath $CERT_DIR/ca-cert.pem \\"
echo "       -CertStoreLocation Cert:\LocalMachine\Root"
echo ""
echo "   macOS:"
echo "     sudo security add-trusted-cert -d -r trustRoot \\"
echo "       -k /Library/Keychains/System.keychain $CERT_DIR/ca-cert.pem"
echo ""
echo "   Linux:"
echo "     sudo cp $CERT_DIR/ca-cert.pem /usr/local/share/ca-certificates/drm-ca.crt"
echo "     sudo update-ca-certificates"
echo "========================================================================="