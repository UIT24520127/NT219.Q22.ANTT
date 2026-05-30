/**
 * DPoP Proof Verifier — RFC 9449
 *
 * Kiểm tra DPoP proof JWT gửi kèm mỗi request xin License:
 *   1. Đúng cấu trúc header: typ=dpop+jwt, alg=ES256, jwk có public key
 *   2. Chữ ký hợp lệ (tự verify bằng public key nhúng trong header)
 *   3. htm khớp HTTP method, htu khớp URL endpoint
 *   4. iat không quá cũ / quá mới (clock skew ±60s, window 2 phút)
 *   5. jti chưa từng thấy (chống replay)
 *   6. ath = BASE64URL(SHA-256(access_token)) — token binding
 */

import * as jose from 'jose';
import crypto from 'crypto';
import { checkAndMarkJTI } from './replay-store';

export interface DPoPVerifyOptions {
  /** Raw DPoP proof JWT string từ header 'DPoP' */
  proof: string;
  /** HTTP method của request, VD: "POST" */
  htm: string;
  /** Full URL của endpoint, VD: "https://example.com/api/license" */
  htu: string;
  /** Raw Bearer access token string (không có tiền tố "Bearer ") */
  accessToken: string;
  /** Cho phép clock skew tính bằng giây (default 60) */
  clockSkewSeconds?: number;
  /** Cửa sổ thời gian proof hợp lệ tính bằng giây (default 120) */
  maxAgeSeconds?: number;
}

export interface DPoPVerifyResult {
  valid: boolean;
  error?: string;
  /** Public key JWK nhúng trong proof header (để liên kết với session nếu cần) */
  publicKeyJwk?: jose.JWK;
}

export async function verifyDPoPProof(opts: DPoPVerifyOptions): Promise<DPoPVerifyResult> {
  const {
    proof,
    htm,
    htu,
    accessToken,
    clockSkewSeconds = 60,
    maxAgeSeconds = 120,
  } = opts;

  try {
    // ── Bước 0: Decode header mà KHÔNG verify chữ ký trước (để lấy jwk)
    const protectedHeader = jose.decodeProtectedHeader(proof);

    // ── Bước 1: Validate header fields
    if (protectedHeader.typ !== 'dpop+jwt') {
      return { valid: false, error: 'DPoP header typ phải là dpop+jwt' };
    }
    if (protectedHeader.alg !== 'ES256') {
      return { valid: false, error: 'DPoP chỉ chấp nhận alg ES256' };
    }
    if (!protectedHeader.jwk) {
      return { valid: false, error: 'DPoP header thiếu jwk (public key)' };
    }

    const jwk = protectedHeader.jwk as jose.JWK;
    if (jwk.kty !== 'EC' || jwk.crv !== 'P-256') {
      return { valid: false, error: 'DPoP jwk phải là EC P-256' };
    }
    // Đảm bảo jwk KHÔNG chứa private key (d field)
    if ('d' in jwk) {
      return { valid: false, error: 'DPoP jwk không được chứa private key' };
    }

    // ── Bước 2: Verify chữ ký bằng public key nhúng trong header
    const publicKey = await jose.importJWK(jwk, 'ES256');
    let payload: jose.JWTPayload;
    try {
      const result = await jose.jwtVerify(proof, publicKey, {
        // Không check issuer/audience — DPoP proof không có
        clockTolerance: `${clockSkewSeconds}s`,
      });
      payload = result.payload;
    } catch (e: any) {
      return { valid: false, error: `Chữ ký DPoP không hợp lệ: ${e.message}` };
    }

    // ── Bước 3: Kiểm tra htm (HTTP method)
    if (typeof payload['htm'] !== 'string' || payload['htm'].toUpperCase() !== htm.toUpperCase()) {
      return { valid: false, error: `DPoP htm không khớp: expected=${htm}, got=${payload['htm']}` };
    }

    // ── Bước 4: Kiểm tra htu (HTTP URL) — so sánh không phân biệt trailing slash
    const normalizeUrl = (u: string) => u.replace(/\/$/, '').split('?')[0];
    if (typeof payload['htu'] !== 'string' || normalizeUrl(payload['htu']) !== normalizeUrl(htu)) {
      return { valid: false, error: `DPoP htu không khớp: expected=${htu}, got=${payload['htu']}` };
    }

    // ── Bước 5: Kiểm tra iat (issued at) — chống proof quá cũ
    if (typeof payload.iat !== 'number') {
      return { valid: false, error: 'DPoP thiếu iat' };
    }
    const nowSec = Math.floor(Date.now() / 1000);
    const age = nowSec - payload.iat;
    if (age > maxAgeSeconds + clockSkewSeconds) {
      return { valid: false, error: `DPoP proof quá cũ: age=${age}s, max=${maxAgeSeconds}s` };
    }
    if (age < -(clockSkewSeconds)) {
      return { valid: false, error: `DPoP proof từ tương lai: age=${age}s` };
    }

    // ── Bước 6: Kiểm tra jti (chống replay)
    if (typeof payload['jti'] !== 'string' || payload['jti'].trim() === '') {
      return { valid: false, error: 'DPoP thiếu jti' };
    }
    const isNew = checkAndMarkJTI(payload['jti'], (maxAgeSeconds + clockSkewSeconds) * 1000);
    if (!isNew) {
      return { valid: false, error: 'DPoP jti đã được dùng (replay attack)' };
    }

    // ── Bước 7: Kiểm tra ath — access token hash binding (RFC 9449 §4.3)
    if (typeof payload['ath'] !== 'string') {
      return { valid: false, error: 'DPoP thiếu ath (access token hash)' };
    }
    const expectedAth = jose.base64url.encode(
      crypto.createHash('sha256').update(accessToken).digest()
    );
    if (payload['ath'] !== expectedAth) {
      return { valid: false, error: 'DPoP ath không khớp access token' };
    }

    return { valid: true, publicKeyJwk: jwk };

  } catch (e: any) {
    return { valid: false, error: `DPoP verify lỗi nội bộ: ${e.message}` };
  }
}