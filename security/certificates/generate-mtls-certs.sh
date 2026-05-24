#!/bin/bash

# ============================================================================
# GENERATE mTLS CERTIFICATES FOR NEXT.JS TO OPENBAO COMMUNICATION
# ============================================================================
# This script generates self-signed certificates for mutual TLS authentication
# between the Next.js backend and OpenBao KMS.
#
# USAGE:
#   chmod +x security/certificates/generate-mtls-certs.sh
#   ./security/certificates/generate-mtls-certs.sh
#
# PRODUCTION NOTE:
#   For production, use certificates issued by a trusted CA or use tools like:
#   - HashiCorp Vault for auto-rotation
#   - cert-manager in Kubernetes
#   - AWS Certificate Manager
# ============================================================================

set -e

CERT_DIR="${MTLS_CERT_DIR:-.}/certs"
CERT_VALIDITY_DAYS=365

echo "========================================================================="
echo "  mTLS Certificate Generator for OpenBao Integration"
echo "========================================================================="

# Create certificate directory
mkdir -p "$CERT_DIR"
chmod 700 "$CERT_DIR"

echo "[1/5] Creating CA private key..."
openssl genrsa -out "$CERT_DIR/ca-key.pem" 4096

echo "[2/5] Creating CA certificate..."
openssl req -new -x509 -days $CERT_VALIDITY_DAYS -key "$CERT_DIR/ca-key.pem" \
  -out "$CERT_DIR/ca-cert.pem" \
  -subj "/CN=DRM-KMS-CA/O=DRM-System/C=VN"

echo "[3/5] Creating client (Next.js) private key..."
openssl genrsa -out "$CERT_DIR/client-key.pem" 4096

echo "[4/5] Creating client certificate signing request..."
openssl req -new -key "$CERT_DIR/client-key.pem" \
  -out "$CERT_DIR/client.csr" \
  -subj "/CN=drm-backend/O=DRM-System/C=VN"

echo "[5/5] Signing client certificate with CA..."
openssl x509 -req -days $CERT_VALIDITY_DAYS \
  -in "$CERT_DIR/client.csr" \
  -CA "$CERT_DIR/ca-cert.pem" \
  -CAkey "$CERT_DIR/ca-key.pem" \
  -CAcreateserial \
  -out "$CERT_DIR/client-cert.pem"

# Clean up CSR
rm "$CERT_DIR/client.csr"

# Set proper permissions
chmod 400 "$CERT_DIR/ca-key.pem"
chmod 400 "$CERT_DIR/client-key.pem"
chmod 444 "$CERT_DIR/ca-cert.pem"
chmod 444 "$CERT_DIR/client-cert.pem"

echo ""
echo "========================================================================="
echo "✅ mTLS Certificates Generated Successfully!"
echo "========================================================================="
echo ""
echo "Certificate Location: $CERT_DIR"
echo "Validity: $CERT_VALIDITY_DAYS days"
echo ""
echo "Generated files:"
echo "  - ca-cert.pem      (CA Certificate)"
echo "  - ca-key.pem       (CA Private Key)"
echo "  - client-cert.pem  (Client Certificate)"
echo "  - client-key.pem   (Client Private Key)"
echo ""
echo "📋 Certificate Details:"
openssl x509 -in "$CERT_DIR/client-cert.pem" -text -noout | grep -E "Subject:|Issuer:|Not Before|Not After|Public Key"
echo ""
echo "⚠️  IMPORTANT NOTES:"
echo "   1. For production, use CA-signed certificates from a trusted authority"
echo "   2. Keep client-key.pem secure (never commit to version control)"
echo "   3. Update MTLS_CERT_DIR environment variable to point to this directory"
echo "   4. Regenerate certificates before expiration (check 'Not After' date above)"
echo "   5. In Docker, mount these certificates as volumes:"
echo "      - volumes:"
echo "          - ./certs:/etc/ssl/certs/drm-kms:ro"
echo ""
echo "========================================================================="
