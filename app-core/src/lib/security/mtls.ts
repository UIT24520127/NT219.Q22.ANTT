import fs from 'fs';
import https from 'https';
import path from 'path';

/**
 * mTLS Configuration for secure communication with OpenBao
 * This service handles mutual TLS certificates for KMS encryption/decryption
 */

// Certificate paths (typically in /etc/ssl/certs or specific security folder)
const CERT_DIR = process.env.MTLS_CERT_DIR || '/etc/ssl/certs/drm-kms';
const CLIENT_CERT_PATH = path.join(CERT_DIR, 'client-cert.pem');
const CLIENT_KEY_PATH = path.join(CERT_DIR, 'client-key.pem');
const CA_CERT_PATH = path.join(CERT_DIR, 'ca-cert.pem');

export interface MTLSConfig {
  cert: string;
  key: string;
  ca: string;
  rejectUnauthorized: boolean;
}

/**
 * Load mTLS certificates from filesystem
 * In production, these should be mounted as secrets/volumes
 * @returns HTTPS agent configured with mutual TLS
 */
export const getMTLSAgent = (): https.Agent | null => {
  try {
    // Check if all required certificate files exist
    const hasClientCert = fs.existsSync(CLIENT_CERT_PATH);
    const hasClientKey = fs.existsSync(CLIENT_KEY_PATH);
    const hasCA = fs.existsSync(CA_CERT_PATH);

    if (!hasClientCert || !hasClientKey || !hasCA) {
      console.warn('⚠️  [mTLS] Certificate files not found, proceeding without mTLS');
      console.warn(`   Client cert: ${hasClientCert ? '✓' : '✗'}`);
      console.warn(`   Client key: ${hasClientKey ? '✓' : '✗'}`);
      console.warn(`   CA cert: ${hasCA ? '✓' : '✗'}`);
      return null;
    }

    // Read certificate files
    const cert = fs.readFileSync(CLIENT_CERT_PATH, 'utf-8');
    const key = fs.readFileSync(CLIENT_KEY_PATH, 'utf-8');
    const ca = fs.readFileSync(CA_CERT_PATH, 'utf-8');

    // Create HTTPS agent with mTLS
    const agent = new https.Agent({
      cert,
      key,
      ca,
      rejectUnauthorized: process.env.NODE_ENV === 'production', // Strict verification in production
    });

    console.log('🔐 [mTLS] Mutual TLS enabled for OpenBao communication');
    return agent;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('❌ [mTLS] Failed to load certificates:', message);
    console.error('⚠️  [mTLS] Falling back to non-TLS communication (INSECURE)');
    return null;
  }
};

/**
 * Validate certificate validity
 * @param certPath Path to certificate file
 */
export const validateCertificate = (certPath: string): boolean => {
  try {
    if (!fs.existsSync(certPath)) {
      console.error(`❌ [mTLS] Certificate not found: ${certPath}`);
      return false;
    }

    const certContent = fs.readFileSync(certPath, 'utf-8');

    // Basic validation: check for PEM markers
    if (!certContent.includes('-----BEGIN')) {
      console.error(`❌ [mTLS] Invalid certificate format: ${certPath}`);
      return false;
    }

    console.log(`✅ [mTLS] Certificate valid: ${path.basename(certPath)}`);
    return true;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(`❌ [mTLS] Error validating certificate: ${message}`);
    return false;
  }
};

/**
 * Health check function for KMS certificate status
 */
export const healthCheckMTLS = (): {
  status: 'ok' | 'partial' | 'error';
  details: Record<string, string>;
} => {
  const details: Record<string, string> = {};

  // Check each certificate
  const certExists = fs.existsSync(CLIENT_CERT_PATH);
  details.clientCert = certExists ? '✓' : '✗';

  const keyExists = fs.existsSync(CLIENT_KEY_PATH);
  details.clientKey = keyExists ? '✓' : '✗';

  const caExists = fs.existsSync(CA_CERT_PATH);
  details.caCert = caExists ? '✓' : '✗';

  // Determine overall status
  let status: 'ok' | 'partial' | 'error' = 'error';
  if (certExists && keyExists && caExists) {
    status = 'ok';
  } else if (certExists || keyExists || caExists) {
    status = 'partial';
  }

  return { status, details };
};
