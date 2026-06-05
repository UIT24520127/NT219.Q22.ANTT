// app/api/auth/token/route.ts
// Bridge endpoint: đọc HttpOnly cookie → verify → trả raw token cho DPoP client.
//
// Lớp bảo vệ:
//  1. JWKS verify     — token phải hợp lệ + chưa hết hạn
//  2. Role check      — phải có music_listener
//  3. Origin check    — chỉ chấp nhận same-origin request
//  4. Rate limiting   — 20 req/phút/IP, chặn scan/brute-force
//  5. Response headers — no-store, X-Frame-Options, nosniff
import { NextRequest, NextResponse } from 'next/server';
import * as jose from 'jose';
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

// ── JWKS cache ────────────────────────────────────────────────────────────────
let jwksCache: ReturnType<typeof jose.createRemoteJWKSet> | null = null;
function getJWKS() {
  if (!jwksCache) {
    const issuer =
      process.env.KEYCLOAK_ISSUER || 'http://keycloak:8080/realms/drm-realm';
    jwksCache = jose.createRemoteJWKSet(
      new URL(`${issuer}/protocol/openid-connect/certs`)
    );
  }
  return jwksCache;
}

// ── Rate limiter: 20 req/phút/IP ──────────────────────────────────────────────
const ratelimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(20, '1 m'),
  prefix: 'token_endpoint_rl',
});

// ── Secure response headers ───────────────────────────────────────────────────
const SECURE_HEADERS = {
  'Cache-Control':          'no-store',
  'X-Frame-Options':        'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy':        'no-referrer',
};

function errorResponse(error: string, status: number, extra?: Record<string, string>) {
  return NextResponse.json(
    { error },
    { status, headers: { ...SECURE_HEADERS, ...extra } }
  );
}

export async function GET(req: NextRequest) {
  // ── 1. Origin check — chặn cross-origin script ────────────────────────────
  // Browser luôn gửi Origin với fetch() cross-origin.
  // Same-origin fetch KHÔNG gửi Origin → chấp nhận cả hai case.
  const origin = req.headers.get('origin');
  const appUrl = process.env.APP_URL || `https://${req.headers.get('host')}`;

  if (origin) {
    // Có Origin header → phải khớp APP_URL
    let expectedOrigin: string;
    try {
      expectedOrigin = new URL(appUrl).origin;
    } catch {
      expectedOrigin = appUrl;
    }
    if (origin !== expectedOrigin) {
      console.warn(`[Token] Origin mismatch: got=${origin} expected=${expectedOrigin}`);
      return errorResponse('forbidden_origin', 403);
    }
  }
  // Không có Origin → same-origin hoặc server-side → cho qua

  // ── 2. Rate limiting (keyed theo IP) ─────────────────────────────────────
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
    req.headers.get('x-real-ip') ||
    'unknown';

  const { success, limit, remaining } = await ratelimit.limit(ip);
  if (!success) {
    console.warn(`[Token] Rate limit hit: ip=${ip}`);
    return errorResponse('too_many_requests', 429, {
      'X-RateLimit-Limit':     String(limit),
      'X-RateLimit-Remaining': String(remaining),
      'Retry-After':           '60',
    });
  }

  // ── 3. Cookie tồn tại ────────────────────────────────────────────────────
  const token = req.cookies.get('access_token')?.value;
  if (!token) {
    return errorResponse('no_token', 401);
  }

  // ── 4. JWKS verify (chữ ký + exp + issuer) ───────────────────────────────
  let payload: jose.JWTPayload;
  try {
    const issuer =
      process.env.KEYCLOAK_ISSUER || 'http://keycloak:8080/realms/drm-realm';
    const result = await jose.jwtVerify(token, getJWKS(), { issuer });
    payload = result.payload;
  } catch (err: any) {
    const isExpired = err.code === 'ERR_JWT_EXPIRED';
    console.warn(`[Token] JWT verify failed: ${err.code}`);
    return errorResponse(isExpired ? 'token_expired' : 'invalid_token', 401);
  }

  // ── 5. Role check — chỉ music_listener mới được lấy token ────────────────
  const roles: string[] = (payload as any)?.realm_access?.roles ?? [];
  if (!roles.includes('music_listener')) {
    console.warn(`[Token] Role check failed. roles=${JSON.stringify(roles)}`);
    return errorResponse('forbidden_role', 403);
  }

  // ── All checks passed ─────────────────────────────────────────────────────
  return NextResponse.json(
    { token },
    { headers: SECURE_HEADERS }
  );
}