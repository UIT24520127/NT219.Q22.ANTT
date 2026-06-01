import axios from 'axios';
import { randomBytes } from 'crypto';

const BAO_ADDR  = process.env.BAO_ADDR  || 'http://localhost:8200';
const BAO_TOKEN = process.env.BAO_DEV_ROOT_TOKEN_ID || 'root-token';
const KEY_NAME  = process.env.KMS_TRANSIT_KEY_NAME  || 'music-app-key';

// Cảnh báo nếu ai đó vô tình set HTTPS mà không có cert
if (BAO_ADDR.startsWith('https://')) {
  console.warn('⚠️  [KMS] BAO_ADDR dùng HTTPS nhưng mTLS không được cấu hình trong code.');
  console.warn('   Nếu muốn HTTP thuần (recommended cho private-subnet), đổi lại http://');
}

const axiosConfig = {
  headers: { 'X-Vault-Token': BAO_TOKEN },
  timeout: 10_000,
};

/** Tạo Key ID 128-bit (Widevine standard) dạng hex 32 ký tự */
export const generateKID = (): string => randomBytes(16).toString('hex');

/** Tạo Content Encryption Key AES-128 dạng hex 32 ký tự */
export const generateCEK = (): string => randomBytes(16).toString('hex');

export const kmsService = {
  encryptKey: async (plaintextCek: string): Promise<string> => {
    try {
      console.log('🔐 [KMS] Encrypting via OpenBao...');
      const res = await axios.post(
        `${BAO_ADDR}/v1/transit/encrypt/${KEY_NAME}`,
        { plaintext: Buffer.from(plaintextCek).toString('base64') },
        axiosConfig,
      );
      return res.data.data.ciphertext;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('❌ [KMS] encryptKey failed:', msg);
      throw new Error(`KMS Encryption Failed: ${msg}`);
    }
  },

  decryptKey: async (ciphertextCek: string): Promise<string> => {
    try {
      console.log('🔓 [KMS] Decrypting via OpenBao...');
      const res = await axios.post(
        `${BAO_ADDR}/v1/transit/decrypt/${KEY_NAME}`,
        { ciphertext: ciphertextCek },
        axiosConfig,
      );
      return Buffer.from(res.data.data.plaintext, 'base64').toString('utf-8');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('❌ [KMS] decryptKey failed:', msg);
      throw new Error(`KMS Decryption Failed: ${msg}`);
    }
  },
};