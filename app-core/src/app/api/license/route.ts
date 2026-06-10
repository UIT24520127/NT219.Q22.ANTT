// app/api/license/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { kmsService } from '@/lib/kms/bao';
import { getEncryptedCEKByKID, logAuditEvent } from '@/lib/track-db';
import { wrapCekWithECDH } from '@/lib/crypto/ecdh';
import { verifyDPoPProof } from '@/lib/dpop/verify';
import crypto from 'crypto';
import * as jose from 'jose';

// ── Ed25519 signing key (load once, fail fast if missing) ─────────────────────
let _signingKey: CryptoKey | null = null;
let _signingKeyPub: CryptoKey | null = null;

async function getSigningKeys(): Promise<{ priv: CryptoKey; pub: CryptoKey }> {
  if (_signingKey && _signingKeyPub) return { priv: _signingKey, pub: _signingKeyPub };

  const privJwk = process.env.LICENSE_SIGNING_PRIVATE_JWK;
  const pubJwk  = process.env.LICENSE_SIGNING_PUBLIC_JWK;
  if (!privJwk || !pubJwk) {
    throw new Error('LICENSE_SIGNING_PRIVATE_JWK / PUBLIC_JWK not set in env');
  }

  _signingKey    = await jose.importJWK(JSON.parse(privJwk), 'EdDSA') as CryptoKey;
  _signingKeyPub = await jose.importJWK(JSON.parse(pubJwk),  'EdDSA') as CryptoKey;
  return { priv: _signingKey, pub: _signingKeyPub };
}
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const ratelimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(10, '1 m'), // 10 license/phút/user
  prefix: 'license_rl',
});

/** Lấy JWKS từ Keycloak (cached module-level) */
let _jwks: ReturnType<typeof jose.createRemoteJWKSet> | null = null;
function getJWKS() {
  if (!_jwks) {
    const issuer =
      process.env.KEYCLOAK_ISSUER || 'http://keycloak:8080/realms/drm-realm';
    _jwks = jose.createRemoteJWKSet(
      new URL(`${issuer}/protocol/openid-connect/certs`)
    );
  }
  return _jwks;
}

/**
 * Full JWT verify qua Keycloak JWKS + trả về payload.
 * Throws nếu token không hợp lệ / hết hạn.
 */
async function verifyAccessToken(token: string): Promise<jose.JWTPayload> {
  const issuer =
    process.env.KEYCLOAK_ISSUER || 'http://keycloak:8080/realms/drm-realm';
  const { payload } = await jose.jwtVerify(token, getJWKS(), { issuer });
  return payload;
}

/**
 * Kiểm tra payload có role music_listener không.
 * Keycloak đặt roles trong realm_access.roles.
 */
function hasListenerRole(payload: jose.JWTPayload): boolean {
  const roles: string[] =
    (payload as any)?.realm_access?.roles ?? [];
  return roles.includes('music_listener');
}

const getLicenseEndpointUrl = (request: Request): string => {
  if (process.env.APP_URL) {
    return `${process.env.APP_URL.replace(/\/$/, '')}/api/license`;
  }
  const host = request.headers.get('host') || 'localhost';
  const proto =
    request.headers.get('x-forwarded-proto') ||
    (host.startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}/api/license`;
};

const extractKIDFromChallenge = (challengeBuffer: Buffer): string | null => {
  try {
    const psshSignature = Buffer.from('pssh');
    let offset = 0;
    while (offset < challengeBuffer.length - 8) {
      offset = challengeBuffer.indexOf(psshSignature, offset);
      if (offset === -1) break;
      if (offset >= 4) {
        const boxSize = challengeBuffer.readUInt32BE(offset - 4);
        if (
          boxSize > 8 &&
          boxSize < 65536 &&
          offset + boxSize <= challengeBuffer.length
        ) {
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

export async function POST(request: NextRequest) {
  try {
    // ── Bước 1: Access token từ HttpOnly cookie ───────────────────────────
    const rawAccessToken = request.cookies.get('access_token')?.value;
    if (!rawAccessToken) {
console.error('❌ [License] Thiếu auth cookie');
      return NextResponse.json(
        { error: 'Unauthorized: Missing auth cookie' },
        { status: 401 }
      );
    }

    // ── Bước 2: Full JWT verify qua Keycloak JWKS ────────────────────────
    // (Không chỉ decode base64 — phải verify chữ ký + exp + issuer)
    let tokenPayload: jose.JWTPayload;
    let userId = 'anonymous';
    try {
      tokenPayload = await verifyAccessToken(rawAccessToken);
      userId =
        (tokenPayload.sub as string) ||
        (tokenPayload as any).email ||
        'anonymous';
    } catch (err: any) {
console.error(`❌ [License] JWT verify thất bại: ${err.message}`);
      await logAuditEvent(
        'LICENSE_FAILED',
        undefined,
        undefined,
        'SYSTEM',
        `JWT invalid: ${err.message}`
      );
      return NextResponse.json(
        { error: 'Unauthorized: Invalid or expired token' },
        { status: 401 }
      );
    }

    // ── Bước 3: Kiểm tra role music_listener ────────────────────────────
    if (!hasListenerRole(tokenPayload)) {
console.warn(
        `🚫 [License] User ${userId} không có role music_listener`
      );
      await logAuditEvent(
        'LICENSE_FAILED',
        undefined,
        undefined,
        userId,
        'forbidden: missing music_listener role'
      );
      return NextResponse.json(
        {
          error: 'Forbidden: role music_listener required',
          hint: 'Tài khoản của bạn không được phép nghe nhạc.',
        },
        { status: 403 }
      );
    }

    // ── Bước 4: Rate limiting ────────────────────────────────────────────
    const { success, limit, remaining } = await ratelimit.limit(userId);
    if (!success) {
console.warn(`⚠️  [License] Rate limit hit cho user: ${userId}`);
      await logAuditEvent(
        'LICENSE_FAILED',
        undefined,
        undefined,
        userId,
        'rate_limited'
      );
      return NextResponse.json(
        { error: 'Too many requests', hint: 'Thử lại sau 1 phút' },
        {
          status: 429,
          headers: {
            'X-RateLimit-Limit': String(limit),
            'X-RateLimit-Remaining': String(remaining),
            'Retry-After': '60',
          },
        }
      );
    }

    // ── Bước 5: DPoP proof ───────────────────────────────────────────────
    const dpopHeader = request.headers.get('dpop');
    if (!dpopHeader) {
console.error('❌ [License] Thiếu DPoP header');
      return NextResponse.json(
        { error: 'DPoP proof required', hint: 'Thêm header DPoP: <proof_jwt>' },
        {
          status: 401,
          headers: { 'WWW-Authenticate': 'DPoP algs="ES256 EdDSA"' },
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
      await logAuditEvent(
        'LICENSE_FAILED',
        undefined,
        undefined,
        userId,
        `DPoP: ${dpopResult.error}`
      );
      return NextResponse.json(
        { error: 'DPoP verification failed', detail: dpopResult.error },
        {
          status: 401,
          headers: {
            'WWW-Authenticate':
              'DPoP algs="ES256" error="invalid_dpop_proof"',
          },
        }
      );
    }

    console.log(`✅ [License] DPoP proof hợp lệ. user=${userId}`);

    // ── Bước 6: Widevine Challenge ───────────────────────────────────────
    const challengeArrayBuffer = await request.arrayBuffer();
    const challengeBuffer = Buffer.from(challengeArrayBuffer);

    let kid: string | null = null;
    if (challengeBuffer.length > 0) {
      kid = extractKIDFromChallenge(challengeBuffer);
    }
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

    // ── Bước 7: ECDH client key ──────────────────────────────────────────
    const clientPublicKeyHex = request.headers.get('x-client-public-key');
    if (!clientPublicKeyHex) {
return NextResponse.json(
        { error: 'ECDH Handshake Required: Missing client public key' },
        { status: 400 }
      );
    }

    // ── Bước 8: Tra cứu CEK ─────────────────────────────────────────────
    console.log(`🔍 [License] Lookup CEK cho KID: ${kid}`);
    const encryptedCek = await getEncryptedCEKByKID(kid);
    if (!encryptedCek) {
await logAuditEvent(
        'LICENSE_FAILED',
        undefined,
        kid,
        userId,
        'CEK not found'
      );
      return NextResponse.json(
        { error: 'Content not available' },
        { status: 404 }
      );
    }

    // ── Bước 9: Giải mã CEK từ KMS ──────────────────────────────────────
    console.log('🔓 [License] Giải mã CEK từ OpenBao...');
    const plaintextCek = (await kmsService.decryptKey(encryptedCek)).trim();

    if (
      plaintextCek.length !== 32 ||
      !/^[0-9a-f]+$/i.test(plaintextCek)
    ) {
      console.error(
        `❌ [License] CEK không hợp lệ. Length: ${plaintextCek.length}`
      );
      throw new Error('Invalid CEK format');
    }
    console.log(`✅ [License] Giải mã CEK thành công cho KID: ${kid}`);

    // ── Bước 10: Wrap CEK bằng ECDH ─────────────────────────────────────
    const { serverPublicKeyHex, wrappedCekHex, ivHex } = wrapCekWithECDH(
      clientPublicKeyHex,
      plaintextCek
    );

    // ── Bước 11: Build license payload ──────────────────────────────────
    const licensePayload = {
      kid,
      wrappedCek: wrappedCekHex,
      serverPublicKey: serverPublicKeyHex,
      iv: ivHex,
      issuedAt: Date.now(),
      ttl: 3600,
      sub: userId,
      // Public key để client verify chữ ký Ed25519
      sigAlg: 'Ed25519',
    };
    const licensePayloadBuffer = Buffer.from(JSON.stringify(licensePayload));

    // ── Bước 12: Ký số Ed25519 (key cố định từ env) ────────────────────
    // Ed25519 không cần hash riêng — sign() tự hash nội bộ (pure EdDSA)
    const { priv: signingPrivKey, pub: signingPubKey } = await getSigningKeys();

    // Ký bằng Web Crypto (jose import → CryptoKey)
    const signatureBuffer = Buffer.from(
      await crypto.subtle.sign('Ed25519', signingPrivKey, licensePayloadBuffer)
    );

    // Gắn public key vào response để client có thể verify
    const signingPubJwk = JSON.parse(process.env.LICENSE_SIGNING_PUBLIC_JWK!);

    // ── Bước 13: Đóng gói binary [4-byte len][payload][sig] ─────────────
    const finalLicenseBuffer = Buffer.alloc(
      4 + licensePayloadBuffer.length + signatureBuffer.length
    );
    finalLicenseBuffer.writeUInt32BE(licensePayloadBuffer.length, 0);
    licensePayloadBuffer.copy(finalLicenseBuffer, 4);
    signatureBuffer.copy(
      finalLicenseBuffer,
      4 + licensePayloadBuffer.length
    );

    console.log(
      `📦 [License] Hoàn tất! Size: ${finalLicenseBuffer.length} bytes`
    );
    await logAuditEvent('LICENSE_ISSUED', undefined, kid, userId, 'license');

    return new NextResponse(finalLicenseBuffer, {
      headers: {
        'Content-Type':                  'application/octet-stream',
        'Access-Control-Allow-Origin':   '*',
        'Access-Control-Allow-Methods':  'POST, OPTIONS',
        'Access-Control-Allow-Headers':
          'Content-Type, x-kid, x-track-id, x-client-public-key, Authorization, DPoP',
        // Client dùng header này để verify chữ ký Ed25519
        'X-License-Signing-Key': JSON.stringify(signingPubJwk),
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
        details:
          error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

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