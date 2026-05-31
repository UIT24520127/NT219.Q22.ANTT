// lib/dpop/verify.ts
// ─────────────────────────────────────────────────────────────────────────────
// Verify DPoP proof theo RFC 9449.
// Tích hợp JTI blacklist (Redis) để chặn replay attack.
// ─────────────────────────────────────────────────────────────────────────────

import * as jose from 'jose';
import crypto from 'crypto';
import { checkAndMarkJTI } from './jti-store';

// jose v5+: KeyLike bị xóa, dùng CryptoKey | Uint8Array
type JoseKey = CryptoKey | Uint8Array;

export interface DPoPVerifyOptions {
  proof: string;
  htm: string;         // HTTP method, e.g. "POST"
  htu: string;         // HTTP URI (endpoint URL)
  accessToken: string; // Raw Bearer token để verify ath claim
  maxAgeSeconds?: number; // Default: 120s
}

export interface DPoPVerifyResult {
  valid: boolean;
  error?: string;
  payload?: jose.JWTPayload;
}

const MAX_CLOCK_SKEW_SECONDS = 30;

export async function verifyDPoPProof(opts: DPoPVerifyOptions): Promise<DPoPVerifyResult> {
  const { proof, htm, htu, accessToken, maxAgeSeconds = 120 } = opts;

  try {
    // ── 1. Decode header (unverified) để lấy JWK public key ────────────────
    const protectedHeader = jose.decodeProtectedHeader(proof);

    if (protectedHeader.typ !== 'dpop+jwt') {
      return { valid: false, error: 'DPoP proof phải có typ=dpop+jwt' };
    }
    if (protectedHeader.alg !== 'ES256') {
      return { valid: false, error: 'Chỉ hỗ trợ alg=ES256' };
    }
    if (!protectedHeader.jwk) {
      return { valid: false, error: 'Header thiếu jwk' };
    }

    // ── 2. Import public key từ header JWK ──────────────────────────────────
    let publicKey: JoseKey;
    try {
      publicKey = await jose.importJWK(protectedHeader.jwk as jose.JWK, 'ES256') as JoseKey;
    } catch {
      return { valid: false, error: 'JWK trong header không hợp lệ' };
    }

    // ── 3. Verify signature + decode payload ────────────────────────────────
    let payload: jose.JWTPayload;
    try {
      const result = await jose.jwtVerify(proof, publicKey, {
        typ: 'dpop+jwt',
        algorithms: ['ES256'],
      });
      payload = result.payload;
    } catch (err: any) {
      return { valid: false, error: `Signature không hợp lệ: ${err.message}` };
    }

    // ── 4. Kiểm tra htm (HTTP method) ───────────────────────────────────────
    if ((payload.htm as string)?.toUpperCase() !== htm.toUpperCase()) {
      return {
        valid: false,
        error: `htm mismatch: expected ${htm.toUpperCase()}, got ${payload.htm}`,
      };
    }

    // ── 5. Kiểm tra htu (HTTP URI) ──────────────────────────────────────────
    // So sánh không phân biệt trailing slash
    const normalizeUrl = (u: string) => u.replace(/\/$/, '').toLowerCase();
    if (normalizeUrl(payload.htu as string) !== normalizeUrl(htu)) {
      return {
        valid: false,
        error: `htu mismatch: expected ${htu}, got ${payload.htu}`,
      };
    }

    // ── 6. Kiểm tra iat (issued at) — chặn proof quá cũ hoặc từ tương lai ──
    const now = Math.floor(Date.now() / 1000);
    const iat = payload.iat as number;
    if (!iat) {
      return { valid: false, error: 'Proof thiếu claim iat' };
    }
    if (iat > now + MAX_CLOCK_SKEW_SECONDS) {
      return { valid: false, error: 'Proof có iat từ tương lai (clock skew > 30s)' };
    }
    if (now - iat > maxAgeSeconds + MAX_CLOCK_SKEW_SECONDS) {
      return { valid: false, error: `Proof đã hết hạn (age > ${maxAgeSeconds}s)` };
    }

    // ── 7. Kiểm tra jti tồn tại ─────────────────────────────────────────────
    const jti = payload.jti as string;
    if (!jti) {
      return { valid: false, error: 'Proof thiếu claim jti' };
    }

    // ── 8. Kiểm tra ath (access token hash) ─────────────────────────────────
    const ath = payload.ath as string;
    if (!ath) {
      return { valid: false, error: 'Proof thiếu claim ath' };
    }
    const expectedAth = crypto
      .createHash('sha256')
      .update(accessToken)
      .digest('base64url');
    if (ath !== expectedAth) {
      return { valid: false, error: 'ath không khớp với access token' };
    }

    // ── 9. JTI blacklist check (Redis) — PHẢI sau tất cả verify khác ────────
    // Chỉ đánh dấu jti đã dùng khi proof hợp lệ về mọi mặt khác,
    // tránh spam Redis với proof rác.
    const jtiOk = await checkAndMarkJTI(jti);
    if (!jtiOk) {
      return { valid: false, error: `DPoP replay detected: jti=${jti} đã được dùng` };
    }

    return { valid: true, payload };

  } catch (err: any) {
    return { valid: false, error: `Lỗi không xác định: ${err.message}` };
  }
}