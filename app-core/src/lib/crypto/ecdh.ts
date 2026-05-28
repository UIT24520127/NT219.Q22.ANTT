import crypto from 'crypto';

interface KeyWrappingResult {
  serverPublicKeyHex: string; // Gửi cái này cho client phối khóa
  wrappedCekHex: string;       // Cục CEK đã được bọc bảo mật bằng AES-GCM
  ivHex: string;               // Vector khởi tạo của AES
}

/**
 * Tuần 3 - Người A: ECDH Key Wrapping (Server-side)
 * @param clientPublicKeyHex Public Key dạng Hex gửi từ phía Client
 * @param plaintextCek Chuỗi khóa CEK thô nhận từ OpenBao KMS
 */
export function wrapCekWithECDH(
  clientPublicKeyHex: string,
  plaintextCek: string
): KeyWrappingResult {
  // 1. Khởi tạo ECDH trên Server bằng curve prime256v1
  const serverEcdh = crypto.createECDH('prime256v1');
  serverEcdh.generateKeys(); // Sinh cặp khóa Server dùng một lần

  const serverPublicKeyHex = serverEcdh.getPublicKey('hex');

  // 2. Tính toán Shared Secret (Bí mật chung) bằng Private Key Server + Public Key Client
  const clientPublicKeyBuffer = Buffer.from(clientPublicKeyHex, 'hex');
  const sharedSecret = serverEcdh.computeSecret(clientPublicKeyBuffer);

  // 3. Dùng KDF (SHA-256) băm Shared Secret ra thành khóa đối xứng AES 256-bit
  const aesKey = crypto.createHash('sha256').update(sharedSecret).digest();

  // 4. Mã hóa AES-256-GCM để bọc khóa CEK
  const iv = crypto.randomBytes(12); // Chuẩn mã hóa GCM dùng IV 12 bytes
  const cipher = crypto.createCipheriv('aes-256-gcm', aesKey, iv);

  let wrappedCek = cipher.update(Buffer.from(plaintextCek, 'hex'));
  wrappedCek = Buffer.concat([wrappedCek, cipher.final()]);

  // Lấy Authentication Tag để chống giả mạo gói tin
  const authTag = cipher.getAuthTag();
  const finalWrappedCekBuffer = Buffer.concat([wrappedCek, authTag]);

  return {
    serverPublicKeyHex,
    wrappedCekHex: finalWrappedCekBuffer.toString('hex'),
    ivHex: iv.toString('hex')
  };
}