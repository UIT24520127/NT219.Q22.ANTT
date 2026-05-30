#!/bin/bash

# ============================================================================
# CONFIGURE OPENBAO WITH TLS CERTIFICATES
# ============================================================================
# This script configures OpenBao to use TLS for secure communication.
# It generates server certificates that OpenBao will use.
#
# USAGE:
#   chmod +x security/certificates/setup-openbao-tls.sh
#   ./security/certificates/setup-openbao-tls.sh
# ============================================================================

set -e

CERT_DIR="${MTLS_CERT_DIR:-./security/nginx}/certs"
BAO_CONTAINER="drm_kms"
BAO_CERT_DIR="/vault/config/certs"
CERT_VALIDITY_DAYS=365

echo "========================================================================="
echo "  OpenBao TLS Configuration Setup"
echo "========================================================================="

# Check if OpenBao container is running
if ! docker ps | grep -q "$BAO_CONTAINER"; then
    echo "❌ OpenBao container '$BAO_CONTAINER' is not running"
    echo "   Start it with: docker-compose up -d openbao"
    exit 1
fi

mkdir -p "$CERT_DIR"

echo "[1/4] Creating OpenBao server private key..."
openssl genrsa -out "$CERT_DIR/server-key.pem" 4096

echo "[2/4] Creating server certificate signing request..."
# Create config file for subject alternative names
cat > /tmp/server.conf << EOF
[req]
distinguished_name = req_distinguished_name
req_extensions = v3_req
prompt = no

[req_distinguished_name]
C = VN
O = DRM-System
CN = openbao.local

[v3_req]
keyUsage = keyEncipherment, dataEncipherment
extendedKeyUsage = serverAuth, clientAuth
subjectAltName = DNS:localhost, DNS:openbao, DNS:drm_kms, IP:127.0.0.1
EOF

openssl req -new -key "$CERT_DIR/server-key.pem" \
  -out "$CERT_DIR/server.csr" \
  -config /tmp/server.conf

echo "[3/4] Signing server certificate with CA..."
openssl x509 -req -days $CERT_VALIDITY_DAYS \
  -in "$CERT_DIR/server.csr" \
  -CA "$CERT_DIR/ca-cert.pem" \
  -CAkey "$CERT_DIR/ca-key.pem" \
  -CAcreateserial \
  -out "$CERT_DIR/server-cert.pem" \
  -extensions v3_req \
  -extfile /tmp/server.conf

rm /tmp/server.conf "$CERT_DIR/server.csr"

echo "[4/4] Copying certificates to OpenBao container..."

# Create directory in container
docker exec "$BAO_CONTAINER" mkdir -p "$BAO_CERT_DIR"

# Copy certificates
docker cp "$CERT_DIR/server-cert.pem" "$BAO_CONTAINER:$BAO_CERT_DIR/"
docker cp "$CERT_DIR/server-key.pem" "$BAO_CONTAINER:$BAO_CERT_DIR/"
docker cp "$CERT_DIR/ca-cert.pem" "$BAO_CONTAINER:$BAO_CERT_DIR/"

# Set permissions inside container
docker exec "$BAO_CONTAINER" chmod 400 "$BAO_CERT_DIR/server-key.pem"
docker exec "$BAO_CONTAINER" chmod 444 "$BAO_CERT_DIR/server-cert.pem"
docker exec "$BAO_CONTAINER" chmod 444 "$BAO_CERT_DIR/ca-cert.pem"

# Set proper permissions locally
chmod 644 "$CERT_DIR/server-key.pem"
chmod 444 "$CERT_DIR/server-cert.pem"

echo ""
echo "========================================================================="
echo "✅ OpenBao TLS Configuration Completed!"
echo "========================================================================="
echo ""
echo "Certificate Location (Local): $CERT_DIR"
echo "Certificate Location (Container): $BAO_CERT_DIR"
echo ""
echo "Generated files:"
echo "  - server-cert.pem  (Server Certificate)"
echo "  - server-key.pem   (Server Private Key)"
echo ""
echo "📋 Server Certificate Details:"
openssl x509 -in "$CERT_DIR/server-cert.pem" -text -noout | grep -E "Subject:|Issuer:|Not Before|Not After"
echo ""
echo "🔐 To enable TLS in OpenBao, configure:"
echo "   - Update BAO_ADDR to use https:// instead of http://"
echo "   - Example: export BAO_ADDR=https://localhost:8200"
echo ""
echo "⚠️  PRODUCTION RECOMMENDATIONS:"
echo "   1. Use HashiCorp Vault's Auto-Unseal with TLS"
echo "   2. Implement certificate rotation before expiration"
echo "   3. Use proper CA certificates instead of self-signed"
echo "   4. Enable mutual TLS (mTLS) enforcement in Vault/OpenBao config"
echo ""
echo "========================================================================="
