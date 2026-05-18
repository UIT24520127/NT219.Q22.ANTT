import axios from 'axios';

// Định cấu hình tự động: Nếu chạy local dùng localhost, nếu chạy container dùng tên service 'drm_kms'
const BAO_ADDR = process.env.BAO_ADDR || 'http://localhost:8200';
const BAO_TOKEN = process.env.BAO_DEV_ROOT_TOKEN_ID || 'root-token'; // Khớp với Root Token trong docker-compose
const KEY_NAME = process.env.KMS_TRANSIT_KEY_NAME || 'music-app-key'; // Khớp với Master Key tạo từ setup-bao.sh

export const kmsService = {
  /**
   * Hàm mã hóa Content Encryption Key (CEK) nguyên bản
   * @param plaintextCek Khóa thô (Dạng chuỗi Hex hoặc Plaintext)
   * @returns Chuỗi Ciphertext dạng "vault:v1:..." lưu vào MariaDB
   */
  encryptKey: async (plaintextCek: string) => {
    try {
      const response = await axios.post(
        `${BAO_ADDR}/v1/transit/encrypt/${KEY_NAME}`,
        { 
          // OpenBao yêu cầu dữ liệu thô phải được encode dạng Base64
          plaintext: Buffer.from(plaintextCek).toString('base64') 
        },
        { 
          headers: { 'X-Bao-Token': BAO_TOKEN } 
        }
      );
      return response.data.data.ciphertext; // Trả về chuỗi mã hóa thành công
    } catch (error: any) {
      console.error('❌ [KMS ERROR] Lỗi mã hóa khóa tại OpenBao:', error.response?.data || error.message);
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
      const response = await axios.post(
        `${BAO_ADDR}/v1/transit/decrypt/${KEY_NAME}`,
        { ciphertext: ciphertextCek },
        { 
          headers: { 'X-Bao-Token': BAO_TOKEN } 
        }
      );
      // Giải mã dữ liệu Base64 từ OpenBao trả về dạng chuỗi tường minh
      return Buffer.from(response.data.data.plaintext, 'base64').toString('utf-8');
    } catch (error: any) {
      console.error('❌ [KMS ERROR] Lỗi giải mã khóa tại OpenBao:', error.response?.data || error.message);
      throw new Error('KMS Decryption Failed');
    }
  }
};