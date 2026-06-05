// app/api/auth/login/route.ts
import { NextResponse } from 'next/server';
import * as jose from 'jose';
import crypto from 'crypto';

function computeAth(token: string): string {
  return crypto.createHash('sha256').update(token).digest('base64url');
}

function loadDPoPKeys(): { privateJwk: jose.JWK; publicJwk: jose.JWK } {
  const raw = process.env.KEYCLOAK_DPOP_PRIVATE_JWK;
  if (!raw) throw new Error('Thiếu KEYCLOAK_DPOP_PRIVATE_JWK trong .env');
  let privateJwk: jose.JWK;
  try { privateJwk = JSON.parse(raw); }
  catch { throw new Error('KEYCLOAK_DPOP_PRIVATE_JWK không phải JSON hợp lệ'); }
  const { d, ...rest } = privateJwk as any;
  return { privateJwk, publicJwk: { ...rest, alg: 'ES256', use: 'sig' } };
}

export async function POST(req: Request) {
  try {
    const { username, password } = await req.json();

    if (!username || !password) {
      return NextResponse.json({ error: 'Thiếu username hoặc password' }, { status: 400 });
    }

    const issuerUrl     = process.env.KEYCLOAK_ISSUER || 'http://keycloak:8080/realms/drm-realm';
    const tokenEndpoint = `${issuerUrl}/protocol/openid-connect/token`;

    // ── Tạo DPoP proof ────────────────────────────────────────────────────
    const { privateJwk, publicJwk } = loadDPoPKeys();
    const privateKey = await jose.importJWK(privateJwk, 'ES256');

    const dpopProof = await new jose.SignJWT({
      jti: crypto.randomUUID(),
      htm: 'POST',
      htu: tokenEndpoint,
    })
      .setProtectedHeader({ alg: 'ES256', typ: 'dpop+jwt', jwk: publicJwk })
      .setIssuedAt()
      .setExpirationTime('2m')
      .sign(privateKey);

    // ── Gọi Keycloak ──────────────────────────────────────────────────────
    const params = new URLSearchParams();
    params.append('grant_type', 'password');
    params.append('client_id', process.env.KEYCLOAK_FRONTEND_CLIENT_ID || 'frontend-client');
    params.append('username', username);
    params.append('password', password);

    const frontendSecret = process.env.KEYCLOAK_FRONTEND_SECRET;
    if (frontendSecret) params.append('client_secret', frontendSecret);

    const kcRes  = await fetch(tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'DPoP': dpopProof },
      body: params,
    });

    const data = await kcRes.json();

    if (!kcRes.ok) {
      console.error('❌ [Login] Keycloak:', data);
      return NextResponse.json(
        { error: data.error_description || 'Đăng nhập thất bại' },
        { status: kcRes.status }
      );
    }

    // ── Decode payload để lấy role redirect ──────────────────────────────
    const payloadB64 = data.access_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload    = JSON.parse(Buffer.from(payloadB64, 'base64').toString());
    const roles: string[] = payload?.realm_access?.roles ?? [];
    const role = roles.includes('music_uploader') ? 'music_uploader'
               : roles.includes('music_listener') ? 'music_listener'
               : null;

    // ── Trả về role để client redirect, token lưu trong HttpOnly cookie ──
    const isProd = process.env.NODE_ENV === 'production';

    const response = NextResponse.json({ ok: true, role }, { status: 200 });

    // access_token: 5 phút (khớp Keycloak accessTokenLifespan: 300)
    response.cookies.set('access_token', data.access_token, {
      httpOnly: true,
      secure:   isProd,
      sameSite: 'strict',
      maxAge:   300,
      path:     '/',
    });

    // ath = SHA256(access_token) base64url — readable by client để tạo DPoP proof
    response.cookies.set('dpop_ath', computeAth(data.access_token), {
      httpOnly: false,
      secure:   isProd,
      sameSite: 'strict',
      maxAge:   300,
      path:     '/',
    });

    // refresh_token: 30 ngày, chỉ gửi khi gọi /api/auth/refresh
    if (data.refresh_token) {
      response.cookies.set('refresh_token', data.refresh_token, {
        httpOnly: true,
        secure:   isProd,
        sameSite: 'strict',
        maxAge:   2592000,
        path:     '/api/auth/refresh',
      });
    }

    console.log(`✅ [Login] ${username} → role: ${role}`);
    return response;

  } catch (err: any) {
    console.error('❌ [Login] Server error:', err.message);
    return NextResponse.json({ error: `Lỗi server: ${err.message}` }, { status: 500 });
  }
}