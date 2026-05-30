import { NextResponse } from 'next/server';
import * as jose from 'jose';
import crypto from 'crypto';

/**
 * POST /api/auth/login
 *
 * frontend-client bật dpop.bound.access.tokens=true → Keycloak BẮT BUỘC DPoP proof
 * ngay khi xin token (grant_type=password), không phải chỉ khi dùng token.
 *
 * Server tạo proof thay browser vì:
 *   - grant_type=password là server-side flow (browser gửi lên Next.js, Next.js gọi Keycloak)
 *   - DPoP keypair ở đây chỉ để "unlock" token endpoint, không dùng để verify license
 *   - License DPoP (player/page.tsx) dùng keypair riêng của browser — độc lập hoàn toàn
 *
 * Dùng chung KEYCLOAK_DPOP_PRIVATE_JWK với register/route.ts cho tiện.
 */

function loadDPoPKeys(): { privateJwk: jose.JWK; publicJwk: jose.JWK } {
  const raw = process.env.KEYCLOAK_DPOP_PRIVATE_JWK;
  if (!raw) throw new Error('Thiếu KEYCLOAK_DPOP_PRIVATE_JWK trong .env');

  let privateJwk: jose.JWK;
  try {
    privateJwk = JSON.parse(raw);
  } catch {
    throw new Error('KEYCLOAK_DPOP_PRIVATE_JWK không phải JSON hợp lệ');
  }

  const { d, ...rest } = privateJwk as any;
  const publicJwk: jose.JWK = { ...rest, alg: 'ES256', use: 'sig' };
  return { privateJwk, publicJwk };
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { username, password } = body;

    if (!username || !password) {
      return NextResponse.json({ error: 'Thiếu username hoặc password' }, { status: 400 });
    }

    const issuerUrl = process.env.KEYCLOAK_ISSUER || 'http://keycloak:8080/realms/drm-realm';
    const tokenEndpoint = `${issuerUrl}/protocol/openid-connect/token`;

    // ── Tạo DPoP proof cho token endpoint ────────────────────────────────
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

    // ── Gọi Keycloak với DPoP proof ───────────────────────────────────────
    const params = new URLSearchParams();
    params.append('grant_type', 'password');
    params.append('client_id', process.env.KEYCLOAK_FRONTEND_CLIENT_ID || 'frontend-client');
    params.append('username', username);
    params.append('password', password);

    const frontendSecret = process.env.KEYCLOAK_FRONTEND_SECRET;
    if (frontendSecret) params.append('client_secret', frontendSecret);

    const response = await fetch(tokenEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'DPoP': dpopProof,
      },
      body: params,
    });

    const data = await response.json();

    if (response.ok) {
      console.log('✅ [Login] Token issued for:', username);
      return NextResponse.json(data, { status: 200 });
    }

    console.error('❌ [Login] Keycloak:', data);
    return NextResponse.json(
      { error: data.error_description || data.error || 'Đăng nhập thất bại' },
      { status: response.status }
    );

  } catch (error: any) {
    console.error('❌ [Login] Server error:', error.message);
    return NextResponse.json({ error: `Lỗi server: ${error.message}` }, { status: 500 });
  }
}