// app/api/auth/refresh/route.ts
// ─────────────────────────────────────────────────────────────────────────────
// POST /api/auth/refresh
// Body: { refresh_token: string }
// Keycloak trả về access_token + refresh_token mới.
// ─────────────────────────────────────────────────────────────────────────────

import * as jose from 'jose';
import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { refresh_token } = body;

    if (!refresh_token) {
      return NextResponse.json({ error: 'Thiếu refresh_token' }, { status: 400 });
    }

    const issuerUrl = process.env.KEYCLOAK_ISSUER || 'http://keycloak:8080/realms/drm-realm';
    const tokenEndpoint = `${issuerUrl}/protocol/openid-connect/token`;

    // ── Tạo DPoP proof (giống login/route.ts) ──────────────────────────────
    const raw = process.env.KEYCLOAK_DPOP_PRIVATE_JWK!;
    const privateJwk = JSON.parse(raw);
    const { d, ...rest } = privateJwk;
    const publicJwk = { ...rest, alg: 'ES256', use: 'sig' };
    const privateKey = await jose.importJWK(privateJwk, 'ES256');

    const dpopProof = await new jose.SignJWT({
      jti: crypto.randomUUID(),
      htm: 'POST',
      htu: tokenEndpoint,
      // Refresh không có ath vì chưa có access token mới
    })
      .setProtectedHeader({ alg: 'ES256', typ: 'dpop+jwt', jwk: publicJwk })
      .setIssuedAt()
      .setExpirationTime('2m')
      .sign(privateKey);

    const params = new URLSearchParams();
    params.append('grant_type', 'refresh_token');
    params.append('client_id', process.env.KEYCLOAK_FRONTEND_CLIENT_ID || 'frontend-client');
    params.append('refresh_token', refresh_token);

    const secret = process.env.KEYCLOAK_FRONTEND_SECRET;
    if (secret) params.append('client_secret', secret);

    const res = await fetch(tokenEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'DPoP': dpopProof,           // ← thêm vào đây
      },
      body: params,
    });

    const data = await res.json();

    if (!res.ok) {
      console.warn('[Refresh] Token refresh thất bại:', data);
      return NextResponse.json(
        { error: data.error_description || 'Refresh thất bại' },
        { status: res.status }
      );
    }

    console.log('[Refresh] Token refreshed thành công');
    return NextResponse.json(data, {
      status: 200,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (err: any) {
    console.error('[Refresh] Lỗi server:', err.message);
    return NextResponse.json({ error: `Lỗi server: ${err.message}` }, { status: 500 });
  }
}
