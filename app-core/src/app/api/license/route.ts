import { NextResponse } from 'next/server';
import { kmsService } from '@/lib/kms/bao';
import { getEncryptedCEKByKID, logAuditEvent } from '@/lib/track-db';
import { wrapCekWithECDH } from '@/lib/crypto/ecdh';
import crypto from 'crypto'
import { 
  licenseIssued, 
  licenseFailed, 
  licenseProcessingDuration 
} from '@/lib/metrics';

/**
 * Extract KID from Widevine Challenge
 * Widevine Challenge contains PSSH box with KID information
 * Parses ISOBMFF box structure more robustly
 */
const extractKIDFromChallenge = (challengeBuffer: Buffer): string | null => {
  try {
    // Search for PSSH box signature (4-byte box type 'pssh')
    const psshSignature = Buffer.from('pssh');
    let offset = 0;

    while (offset < challengeBuffer.length - 8) {
      offset = challengeBuffer.indexOf(psshSignature, offset);
      if (offset === -1) break;

      // Validate box header: size field should be at offset-4
      if (offset >= 4) {
        const boxSize = challengeBuffer.readUInt32BE(offset - 4);
        // Sanity check: box size should be reasonable
        if (boxSize > 8 && boxSize < 65536 && offset + boxSize <= challengeBuffer.length) {
          // PSSH box found with valid size
          // KID is typically at offset + 12 (after version/flags and system ID)
          if (offset + 28 <= challengeBuffer.length) {
            const kidBuffer = challengeBuffer.slice(offset + 12, offset + 28);
            const kid = kidBuffer.toString('hex');
            console.log(`🔑 [License] Extracted KID from challenge: ${kid}`);
            return kid;
          }
        }
      }
      offset++;
    }
  } catch (error) {
    console.warn('⚠️  [License] Could not extract KID from challenge, trying fallback methods');
  }
  return null;
};

export async function POST(request: Request) {
  const startTime = Date.now();
  const timer = licenseProcessingDuration.startTimer();
  
  try {
    // 1. Receive Widevine Challenge (binary data from Shaka Player)
    const challengeArrayBuffer = await request.arrayBuffer();
    const challengeBuffer = Buffer.from(challengeArrayBuffer);

    if (challengeBuffer.length === 0) {
      licenseFailed.inc({ reason: 'empty_challenge', error_type: 'validation' });
      return NextResponse.json({ error: 'Empty Widevine Challenge' }, { status: 400 });
    }

    console.log(`📡 [License] Received challenge: ${challengeBuffer.length} bytes`);

    // 2. Extract KID from challenge or use headers as fallback
    let kid: string | null = extractKIDFromChallenge(challengeBuffer);

    // Fallback: Try KID from custom header
    if (!kid) {
      kid = request.headers.get('x-kid');
      if (kid) {
        console.log(`ℹ️  [License] Using KID from header: ${kid}`);
      }
    }

    // Error if no KID found
    if (!kid) {
      console.error('❌ [License] No KID provided in challenge or headers');
      licenseFailed.inc({ reason: 'missing_kid', error_type: 'validation' });
      return NextResponse.json({ error: 'No KID provided in challenge or headers' }, { status: 400 });
    }

    // =========================================================================
    // 🔥 BƯỚC CỦA NGƯỜI A (TUẦN 3): LẤY PUBLIC KEY CỦA CLIENT QUA HEADER
    // =========================================================================
    const clientPublicKeyHex = request.headers.get('x-client-public-key');
    if (!clientPublicKeyHex) {
      console.error('❌ [License - Người A] Giao dịch thất bại: Thiếu x-client-public-key header để thiết lập ECDH');
      licenseFailed.inc({ reason: 'missing_client_key', error_type: 'ecdh_handshake' });
      return NextResponse.json({ error: 'ECDH Handshake Required: Missing client public key' }, { status: 400 });
    }

    // 3. Query database for encrypted CEK using KID
    console.log(`🔍 [License] Looking up CEK for KID: ${kid}`);
    const encryptedCek = await getEncryptedCEKByKID(kid);

    if (!encryptedCek) {
      console.error(`❌ [License] CEK not found for KID: ${kid}`);
      await logAuditEvent('LICENSE_FAILED', undefined, kid, 'SYSTEM', 'CEK not found');
      licenseFailed.inc({ reason: 'cek_not_found', error_type: 'database' });
      return NextResponse.json({ error: 'Content not available' }, { status: 404 });
    }

    // 4. Decrypt CEK from OpenBao KMS (Envelope Encryption pattern)
    console.log('🔓 [License] Decrypting CEK from OpenBao...');
    // Thêm hàm .trim() để dọn sạch hoàn toàn khoảng trắng, xuống dòng rác phát sinh
    const plaintextCek = (await kmsService.decryptKey(encryptedCek)).trim();

    // ĐÃ SỬA: Khóa AES thô của bài nhạc dài đúng 32 ký tự Hex (128-bit)
    if (plaintextCek.length !== 32 || !/^[0-9a-f]+$/i.test(plaintextCek)) {
      console.error(`❌ [License] Invalid CEK format after decryption. Got length: ${plaintextCek.length}`);
      throw new Error('Invalid CEK format');
    }

    console.log(`✅ [License] CEK decrypted successfully for KID: ${kid}`);

    // =========================================================================
    // 🔥 [MÃ NGUỒN NGƯỜI A - TUẦN 3]: GỌI TỪ FILE ECDH.TS SANG ĐỂ WRAPPING KHÓA
    // =========================================================================
    console.log('🛡️ [License - Người A] Đang gọi module mật mã từ file ecdh.ts...');

    // Gọi hàm từ module ecdh để bọc khóa CEK (Đã khớp định dạng chuỗi Hex chuẩn)
    const { serverPublicKeyHex, wrappedCekHex, ivHex } = wrapCekWithECDH(
      clientPublicKeyHex,
      plaintextCek
    );

    console.log('✅ [License - Người A] Khóa CEK đã được bọc mật mã an toàn tuyệt đối từ file ecdh.ts.');

    // =========================================================================
    // 🔥 CẤU TRÚC LẠI BẢN TIN LICENSE PAYLOAD (SỬ DỤNG KẾT QUẢ TỪ FILE ECDH.TS)
    // =========================================================================
    const licensePayload = {
      kid: kid,
      wrappedCek: wrappedCekHex,        
      serverPublicKey: serverPublicKeyHex, 
      iv: ivHex,                        
      issuedAt: Date.now(),
      ttl: 3600
    };
    const licensePayloadBuffer = Buffer.from(JSON.stringify(licensePayload));
    // =========================================================================
    // 4. KÝ SỐ ECDSA-SHA256 CHỐNG GIẢ MẠO BẢN TIN (Thay thế hoàn toàn RSA 2048)
    // =========================================================================
    // Sinh cặp khóa Elliptic Curve (ECDSA) động sử dụng curve prime256v1
    const { privateKey } = crypto.generateKeyPairSync('ec' as any, {
      namedCurve: 'prime256v1',
      privateKeyEncoding: {
        type: 'pkcs8',
        format: 'pem'
      }
    });

    // Thực hiện ký số bằng thuật toán ECDSA với hàm băm SHA-256
    const signer = crypto.createSign('SHA-256');
    signer.update(licensePayloadBuffer);
    const signatureBuffer = signer.sign({
      key: privateKey,
      dsaEncoding: 'ieee-p1363'
    });

    // 5. Đóng gói cấu trúc mảng nhị phân đồng nhất (4 bytes độ dài + Payload + Chữ ký)
    const finalLicenseBuffer = Buffer.alloc(4 + licensePayloadBuffer.length + signatureBuffer.length);
    finalLicenseBuffer.writeUInt32BE(licensePayloadBuffer.length, 0);
    licensePayloadBuffer.copy(finalLicenseBuffer, 4);
    signatureBuffer.copy(finalLicenseBuffer, 4 + licensePayloadBuffer.length);

    console.log(`📦 [LicenseProxy - Người A] Hoàn tất bọc ECDH + Ký số ECDSA Curve thành công! Size: ${finalLicenseBuffer.length} bytes`);

    // 6. Ghi nhận lịch sử hệ thống 
    await logAuditEvent('LICENSE_ISSUED', undefined, kid, 'SYSTEM', 'license');

    // 7. Track successful license issuance
    licenseIssued.inc({ kid });
    timer({ kid });

    // 8. Trả dữ liệu mã hóa nhị phân về cho Shaka Player
    return new NextResponse(finalLicenseBuffer, {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, x-kid, x-track-id, x-client-public-key', 
      },
    });

  } catch (error: unknown) {
    // BẪY LOG CHI TIẾT TẠI ĐÂY:
    console.error('💥💥💥 [License CRITICAL ERROR] Phát hiện sập luồng Backend!');
    if (error instanceof Error) {
      console.error('Chi tiết lỗi:', error.message);
      console.error('Vị trí phát sinh lỗi (Stack Trace):', error.stack);
    } else {
      console.error('Lỗi không xác định:', error);
    }

    return NextResponse.json({ 
      error: 'License generation failed',
      details: error instanceof Error ? error.message : "Unknown error"
    }, { status: 500 });
  }
}

// Handle CORS preflight
export async function OPTIONS(request: Request) {
  return new NextResponse(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, x-kid, x-track-id, x-client-public-key', // ĐÃ BỔ SUNG KHÓA CÔNG KHAI CLIENT Ở ĐÂY
    },
  });
}