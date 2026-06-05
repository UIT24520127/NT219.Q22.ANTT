// app/api/auth/refresh/route.ts
import { NextRequest, NextResponse } from 'next/server';
import * as jose from 'jose';
import crypto from 'crypto';

export async function POST(req: NextRequest) {
  try {
    const refreshToken = req.cookies.get('refresh_token')?.value;

    if (!refreshToken) {
      return NextResponse.json({ error: 'Không có refresh token' }, { status: 401 });
    }

    const issuerUrl     = process.env.KEYCLOAK_ISSUER || 'http://keycloak:8080/realms/drm-realm';
    const tokenEndpoint = `${issuerUrl}/protocol/openid-connect/token`;

    // ── DPoP proof ────────────────────────────────────────────────────────
    const raw        = process.env.KEYCLOAK_DPOP_PRIVATE_JWK!;
    const privateJwk = JSON.parse(raw);
    const { d, ...rest } = privateJwk;
    const publicJwk  = { ...rest, alg: 'ES256', use: 'sig' };
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

    const params = new URLSearchParams();
    params.append('grant_type', 'refresh_token');
    params.append('client_id', process.env.KEYCLOAK_FRONTEND_CLIENT_ID || 'frontend-client');
    params.append('refresh_token', refreshToken);

    const secret = process.env.KEYCLOAK_FRONTEND_SECRET;
    if (secret) params.append('client_secret', secret);

    const kcRes = await fetch(tokenEndpoint, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'DPoP': dpopProof },
      body:    params,
    });

    const data = await kcRes.json();

    if (!kcRes.ok) {
      // Refresh thất bại → xóa cả 2 cookie
      const errRes = NextResponse.json({ error: 'Refresh thất bại' }, { status: 401 });
      errRes.cookies.delete('access_token');
      errRes.cookies.delete('refresh_token');
      return errRes;
    }

    const isProd   = process.env.NODE_ENV === 'production';
    const response = NextResponse.json({ ok: true }, { status: 200,
      headers: { 'Cache-Control': 'no-store' },
    });

    response.cookies.set('access_token', data.access_token, {
      httpOnly: true,
      secure:   isProd,
      sameSite: 'strict',
      maxAge:   300,
      path:     '/',
    });

    response.cookies.set('dpop_ath', crypto.createHash('sha256').update(data.access_token).digest('base64url'), {
      httpOnly: false,
      secure:   isProd,
      sameSite: 'strict',
      maxAge:   300,
      path:     '/',
    });

    if (data.refresh_token) {
      response.cookies.set('refresh_token', data.refresh_token, {
        httpOnly: true,
        secure:   isProd,
        sameSite: 'strict',
        maxAge:   2592000,
        path:     '/api/auth/refresh',
      });
    }

    return response;

  } catch (err: any) {
    console.error('[Refresh] Lỗi server:', err.message);
    return NextResponse.json({ error: `Lỗi server: ${err.message}` }, { status: 500 });
  }
}