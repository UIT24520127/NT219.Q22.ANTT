import axios from 'axios';

const BAO_ADDR = process.env.OPENBAO_ADDR || 'http://localhost:8200';
const BAO_TOKEN = process.env.OPENBAO_TOKEN;
const KEY_NAME = process.env.TRANSIT_KEY_NAME || 'music-app-key';

export const kmsService = {
  // Hàm mã hóa CEK (Dùng khi Người B upload nhạc mới)
  encryptKey: async (plaintextCek: string) => {
    const response = await axios.post(
      `${BAO_ADDR}/v1/transit/encrypt/${KEY_NAME}`,
      { plaintext: Buffer.from(plaintextCek).toString('base64') },
      { headers: { 'X-Bao-Token': BAO_TOKEN } }
    );
    return response.data.data.ciphertext;
  },

  // Hàm giải mã CEK (Dùng khi Người C yêu cầu License để nghe nhạc)
  decryptKey: async (ciphertextCek: string) => {
    const response = await axios.post(
      `${BAO_ADDR}/v1/transit/decrypt/${KEY_NAME}`,
      { ciphertext: ciphertextCek },
      { headers: { 'X-Bao-Token': BAO_TOKEN } }
    );
    return Buffer.from(response.data.data.plaintext, 'base64').toString('utf-8');
  }
};