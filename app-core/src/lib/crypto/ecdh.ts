import crypto from 'crypto';

interface KeyWrappingResult {
  serverPublicKeyHex: string;
  wrappedCekHex: string;
  ivHex: string;
}

/**
 * ECDH Key Wrapping (Server-side) — upgraded to X25519 + HKDF
 * @param clientPublicKeyHex Public Key hex từ client (X25519, 32 bytes = 64 hex chars)
 * @param plaintextCek CEK hex string từ OpenBao KMS
 */
export function wrapCekWithECDH(
  clientPublicKeyHex: string,
  plaintextCek: string
): KeyWrappingResult {
  // 1. Sinh X25519 keypair server (ephemeral, dùng 1 lần)
  const serverKeyPair = crypto.generateKeyPairSync('x25519', {
    publicKeyEncoding:  { type: 'spki',  format: 'der' },
    privateKeyEncoding: { type: 'pkcs8', format: 'der' },
  });

  // X25519 SPKI DER: 32 bytes cuối là raw public key
  const serverPublicKeyRaw = serverKeyPair.publicKey.slice(-32);
  const serverPublicKeyHex = serverPublicKeyRaw.toString('hex');

  // 2. Import client public key (raw 32 bytes → SPKI DER)
  // X25519 SPKI DER prefix chuẩn (12 bytes)
  const spkiPrefix = Buffer.from('302a300506032b656e032100', 'hex');
  const clientRawBuf = Buffer.from(clientPublicKeyHex, 'hex');
  const clientSpki = Buffer.concat([spkiPrefix, clientRawBuf]);

  const clientPublicKey = crypto.createPublicKey({
    key: clientSpki,
    format: 'der',
    type: 'spki',
  });

  const serverPrivateKey = crypto.createPrivateKey({
    key: serverKeyPair.privateKey,
    format: 'der',
    type: 'pkcs8',
  });

  // 3. ECDH → shared secret
  const sharedSecret = crypto.diffieHellman({
    privateKey: serverPrivateKey,
    publicKey: clientPublicKey,
  });

  // 4. HKDF thay SHA-256 đơn giản — đúng chuẩn hơn
  const aesKey = crypto.hkdfSync(
    'sha256',
    sharedSecret,
    Buffer.alloc(0),           // salt (empty OK cho ephemeral key)
    Buffer.from('cek-wrapping-v1'),  // info / context
    32                          // 256-bit AES key
  );

  // 5. AES-256-GCM wrap CEK
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(aesKey), iv);

  let wrappedCek = cipher.update(Buffer.from(plaintextCek, 'hex'));
  wrappedCek = Buffer.concat([wrappedCek, cipher.final()]);
  const authTag = cipher.getAuthTag();
  const finalWrappedCekBuffer = Buffer.concat([wrappedCek, authTag]);

  return {
    serverPublicKeyHex,
    wrappedCekHex: finalWrappedCekBuffer.toString('hex'),
    ivHex: iv.toString('hex'),
  };
}