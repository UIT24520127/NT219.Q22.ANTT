import axios from 'axios';
import { randomBytes } from 'crypto';
import https from 'https';
import { getMTLSAgent } from '../security/mtls';

// Định cấu hình tự động: Nếu chạy local dùng localhost, nếu chạy container dùng tên service 'drm_kms'
const BAO_ADDR = process.env.BAO_ADDR || 'http://localhost:8200';
const BAO_TOKEN = process.env.BAO_DEV_ROOT_TOKEN_ID || 'root-token'; // Khớp với Root Token trong docker-compose
const KEY_NAME = process.env.KMS_TRANSIT_KEY_NAME || 'music-app-key'; // Khớp với Master Key tạo từ setup-bao.sh

// Initialize mTLS agent for HTTPS connections to OpenBao
let httpsAgent: https.Agent | null = null;

// Determine if we need mTLS
const isTLSEnabled = BAO_ADDR.startsWith('https://');

if (isTLSEnabled) {
  httpsAgent = getMTLSAgent();
  if (!httpsAgent) {
    console.warn('⚠️  [KMS] mTLS not configured but HTTPS required. This will fail.');
  }
}

/**
 * Tạo Key ID (KID) ngẫu nhiên cho mỗi track
 * Widevine standard yêu cầu KID là 128-bit (16 bytes)
 * @returns KID dạng hex string (32 ký tự)
 */
export const generateKID = (): string => {
  return randomBytes(16).toString('hex');
};

/**
 * Tạo Content Encryption Key (CEK) ngẫu nhiên
 * Tiêu chuẩn Widevine AES-128 CENC: 128-bit (16 bytes) cho AES-128
 * @returns CEK dạng hex string (32 ký tự)
 */
export const generateCEK = (): string => {
  return randomBytes(16).toString('hex');
};

export const kmsService = {
  /**
   * Hàm mã hóa Content Encryption Key (CEK) nguyên bản
   * @param plaintextCek Khóa thô (Dạng chuỗi Hex hoặc Plaintext)
   * @returns Chuỗi Ciphertext dạng "vault:v1:..." lưu vào MariaDB
   */
  encryptKey: async (plaintextCek: string) => {
    try {
      const axiosConfig: any = {
        headers: { 'X-Vault-Token': BAO_TOKEN }
      };

      // Add mTLS agent if using HTTPS
      if (isTLSEnabled && httpsAgent) {
        axiosConfig.httpsAgent = httpsAgent;
      }

      console.log(`🔐 [KMS] Encrypting key via OpenBao (mTLS: ${isTLSEnabled ? 'enabled' : 'disabled'})...`);

      const response = await axios.post(
        `${BAO_ADDR}/v1/transit/encrypt/${KEY_NAME}`,
        { 
          // OpenBao yêu cầu dữ liệu thô phải được encode dạng Base64
          plaintext: Buffer.from(plaintextCek).toString('base64') 
        },
        axiosConfig
      );
      return response.data.data.ciphertext; // Trả về chuỗi mã hóa thành công
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error";
      console.error('❌ [KMS ERROR] Lỗi mã hóa khóa tại OpenBao:', message);
      throw new Error('KMS Encryption Failed');
    }
  },

  /**
   * Hàm giải mã khóa (Nhiệm vụ trọng tâm Tuần 2)
   * @param ciphertextCek Chuỗi mã hóa "vault:v1:..." lấy từ bảng encrypted_files trong DB
   * @returns Khóa thô nguyên bản (Plaintext) phục vụ đóng gói License Response
   */
  decryptKey: async (ciphertextCek: string) => {
    try {
      const axiosConfig: any = {
        headers: { 'X-Vault-Token': BAO_TOKEN }
      };

      // Add mTLS agent if using HTTPS
      if (isTLSEnabled && httpsAgent) {
        axiosConfig.httpsAgent = httpsAgent;
      }

      console.log(`🔓 [KMS] Decrypting key via OpenBao (mTLS: ${isTLSEnabled ? 'enabled' : 'disabled'})...`);

      const response = await axios.post(
        `${BAO_ADDR}/v1/transit/decrypt/${KEY_NAME}`,
        { ciphertext: ciphertextCek },
        axiosConfig
      );
      // Giải mã dữ liệu Base64 từ OpenBao trả về dạng chuỗi tường minh
      return Buffer.from(response.data.data.plaintext, 'base64').toString('utf-8');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error";
      console.error('❌ [KMS ERROR] Lỗi giải mã khóa tại OpenBao:', message);
      throw new Error('KMS Decryption Failed');
    }
  }
};
