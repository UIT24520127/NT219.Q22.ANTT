import { NextResponse } from 'next/server';
import { kmsService } from '@/lib/kms/bao';
import { getEncryptedCEKByKID, logAuditEvent } from '@/lib/track-db';
import { wrapCekWithECDH } from '@/lib/crypto/ecdh';
import { verifyDPoPProof } from '@/lib/dpop/verify';
import crypto from 'crypto';
import { 
  licenseIssued, 
  licenseFailed, 
  licenseProcessingDuration 
} from '@/lib/metrics';

/**
 * Lấy URL tuyệt đối của endpoint license để verify DPoP htu.
 * Ưu tiên biến môi trường APP_URL, fallback từ request headers.
 */
const getLicenseEndpointUrl = (request: Request): string => {
  if (process.env.APP_URL) {
    return `${process.env.APP_URL.replace(/\/$/, '')}/api/license`;
  }
  // Fallback: tái tạo từ host header (phù hợp local dev)
  const host = request.headers.get('host') || 'localhost:3000';
  const proto = host.startsWith('localhost') ? 'http' : 'https';
  return `${proto}://${host}/api/license`;
};

/**
 * Extract KID từ Widevine Challenge — giữ nguyên logic cũ
 */
const extractKIDFromChallenge = (challengeBuffer: Buffer): string | null => {
  try {
    const psshSignature = Buffer.from('pssh');
    let offset = 0;
    while (offset < challengeBuffer.length - 8) {
      offset = challengeBuffer.indexOf(psshSignature, offset);
      if (offset === -1) break;
      if (offset >= 4) {
        const boxSize = challengeBuffer.readUInt32BE(offset - 4);
        if (boxSize > 8 && boxSize < 65536 && offset + boxSize <= challengeBuffer.length) {
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
  } catch {
    console.warn('⚠️  [License] Could not extract KID from challenge');
  }
  return null;
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/license
// ─────────────────────────────────────────────────────────────────────────────
export async function POST(request: Request) {
  const startTime = Date.now();
  const timer = licenseProcessingDuration.startTimer();
  
  try {
    // ══════════════════════════════════════════════════════════════════════════
    // TUẦN 4 — BƯỚC 1: XÁC THỰC BEARER TOKEN
    // Lấy raw access token từ Authorization header để dùng cho ath binding
    // ══════════════════════════════════════════════════════════════════════════
    const authHeader = request.headers.get('authorization') || '';
    if (!authHeader.toLowerCase().startsWith('bearer ')) {
      console.error('❌ [License] Thiếu Bearer token');
      return NextResponse.json(
        { error: 'Unauthorized: Missing Bearer token' },
        { status: 401 }
      );
    }
    const rawAccessToken = authHeader.slice('bearer '.length).trim();

    // ══════════════════════════════════════════════════════════════════════════
    // TUẦN 4 — BƯỚC 2: XÁC THỰC DPOP PROOF
    // Toàn bộ logic verify nằm trong lib/dpop/verify.ts
    // ══════════════════════════════════════════════════════════════════════════
    const dpopHeader = request.headers.get('dpop');
    if (!dpopHeader) {
      console.error('❌ [License] Thiếu DPoP header');
      return NextResponse.json(
        { error: 'DPoP proof required', hint: 'Thêm header DPoP: <proof_jwt>' },
        {
          status: 401,
          headers: {
            // RFC 9449: server thông báo scheme được chấp nhận
            'WWW-Authenticate': 'DPoP algs="ES256"',
          },
        }
      );
    }

    const licenseUrl = getLicenseEndpointUrl(request);
    const dpopResult = await verifyDPoPProof({
      proof: dpopHeader,
      htm: 'POST',
      htu: licenseUrl,
      accessToken: rawAccessToken,
    });

    if (!dpopResult.valid) {
      console.error(`❌ [License] DPoP verify thất bại: ${dpopResult.error}`);
      await logAuditEvent('LICENSE_FAILED', undefined, undefined, 'SYSTEM', `DPoP: ${dpopResult.error}`);
      return NextResponse.json(
        { error: 'DPoP verification failed', detail: dpopResult.error },
        {
          status: 401,
          headers: { 'WWW-Authenticate': 'DPoP algs="ES256" error="invalid_dpop_proof"' },
        }
      );
    }

    console.log('✅ [License] DPoP proof hợp lệ.');

    // ══════════════════════════════════════════════════════════════════════════
    // PHẦN CŨ — GIỮ NGUYÊN TỪ TUẦN 3
    // ══════════════════════════════════════════════════════════════════════════

    // 1. Nhận Widevine Challenge
    const challengeArrayBuffer = await request.arrayBuffer();
    const challengeBuffer = Buffer.from(challengeArrayBuffer);

    // Challenge body có thể rỗng khi client dùng JSON stub thay vì Widevine thật
    // → vẫn cho qua nếu KID có từ header
    let kid: string | null = null;
    if (challengeBuffer.length > 0) {
      kid = extractKIDFromChallenge(challengeBuffer);
    }

    // Fallback: KID từ header
    if (!kid) {
      kid = request.headers.get('x-kid');
      if (kid) console.log(`ℹ️  [License] KID từ header: ${kid}`);
    }

    if (!kid) {
      console.error('❌ [License] Không có KID');
      return NextResponse.json(
        { error: 'No KID provided in challenge or headers' },
        { status: 400 }
      );
    }

    // 2. Lấy public key ECDH của client (tuần 3)
    const clientPublicKeyHex = request.headers.get('x-client-public-key');
    if (!clientPublicKeyHex) {
      return NextResponse.json(
        { error: 'ECDH Handshake Required: Missing client public key' },
        { status: 400 }
      );
    }

    // 3. Tra cứu CEK trong database
    console.log(`🔍 [License] Lookup CEK cho KID: ${kid}`);
    const encryptedCek = await getEncryptedCEKByKID(kid);
    if (!encryptedCek) {
      await logAuditEvent('LICENSE_FAILED', undefined, kid, 'SYSTEM', 'CEK not found');
      licenseFailed.inc({ reason: 'cek_not_found', error_type: 'database' });
      return NextResponse.json({ error: 'Content not available' }, { status: 404 });
    }

    // 4. Giải mã CEK từ OpenBao KMS
    console.log('🔓 [License] Giải mã CEK từ OpenBao...');
    const plaintextCek = (await kmsService.decryptKey(encryptedCek)).trim();

    if (plaintextCek.length !== 32 || !/^[0-9a-f]+$/i.test(plaintextCek)) {
      console.error(`❌ [License] CEK không hợp lệ sau giải mã. Length: ${plaintextCek.length}`);
      throw new Error('Invalid CEK format');
    }
    console.log(`✅ [License] Giải mã CEK thành công cho KID: ${kid}`);

    // 5. Wrap CEK bằng ECDH (tuần 3)
    const { serverPublicKeyHex, wrappedCekHex, ivHex } = wrapCekWithECDH(
      clientPublicKeyHex,
      plaintextCek
    );

    // 6. Tạo License payload
    const licensePayload = {
      kid,
      wrappedCek: wrappedCekHex,
      serverPublicKey: serverPublicKeyHex,
      iv: ivHex,
      issuedAt: Date.now(),
      ttl: 3600,
    };
    const licensePayloadBuffer = Buffer.from(JSON.stringify(licensePayload));

    // 7. Ký số ECDSA (giữ nguyên từ tuần 3)
    const { privateKey } = crypto.generateKeyPairSync('ec' as any, {
      namedCurve: 'prime256v1',
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    const signer = crypto.createSign('SHA-256');
    signer.update(licensePayloadBuffer);
    const signatureBuffer = signer.sign({ key: privateKey, dsaEncoding: 'ieee-p1363' });

    // 8. Đóng gói binary: [4-byte length][payload][signature]
    const finalLicenseBuffer = Buffer.alloc(4 + licensePayloadBuffer.length + signatureBuffer.length);
    finalLicenseBuffer.writeUInt32BE(licensePayloadBuffer.length, 0);
    licensePayloadBuffer.copy(finalLicenseBuffer, 4);
    signatureBuffer.copy(finalLicenseBuffer, 4 + licensePayloadBuffer.length);

    console.log(`📦 [License] Hoàn tất! Size: ${finalLicenseBuffer.length} bytes`);
    await logAuditEvent('LICENSE_ISSUED', undefined, kid, 'SYSTEM', 'license');

    return new NextResponse(finalLicenseBuffer, {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers':
          'Content-Type, x-kid, x-track-id, x-client-public-key, Authorization, DPoP',
      },
    });

  } catch (error: unknown) {
    console.error('💥 [License CRITICAL ERROR]');
    if (error instanceof Error) {
      console.error('Chi tiết:', error.message);
      console.error('Stack:', error.stack);
    }
    return NextResponse.json(
      {
        error: 'License generation failed',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

// CORS preflight
export async function OPTIONS() {
  return new NextResponse(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers':
        'Content-Type, x-kid, x-track-id, x-client-public-key, Authorization, DPoP',
    },
  });
}