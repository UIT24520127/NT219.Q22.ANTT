import { NextResponse } from 'next/server';
import * as jose from 'jose';
import crypto from 'crypto';

/**
 * ⚠️  SECURITY NOTE:
 * Private key KHÔNG được hardcode trong source code vì sẽ lộ khi push Git.
 * Load từ biến môi trường KEYCLOAK_DPOP_PRIVATE_JWK (JSON string).
 *
 * Cách tạo cặp khóa mới (chạy một lần, lưu vào .env):
 *
 *   node -e "
 *     const { generateKeyPairSync } = require('crypto');
 *     const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
 *     const jwk = privateKey.export({ format: 'jwk' });
 *     console.log(JSON.stringify(jwk));
 *   "
 *
 * Sau đó thêm vào .env:
 *   KEYCLOAK_DPOP_PRIVATE_JWK={"kty":"EC","crv":"P-256","x":"...","y":"...","d":"..."}
 */

function loadDPoPKeys(): { privateJwk: jose.JWK; publicJwk: jose.JWK } {
  const raw = process.env.KEYCLOAK_DPOP_PRIVATE_JWK;

  if (!raw) {
    throw new Error(
      'Thiếu biến môi trường KEYCLOAK_DPOP_PRIVATE_JWK. ' +
      'Xem hướng dẫn trong register/route.ts để tạo keypair.'
    );
  }

  let privateJwk: jose.JWK;
  try {
    privateJwk = JSON.parse(raw);
  } catch {
    throw new Error('KEYCLOAK_DPOP_PRIVATE_JWK không phải JSON hợp lệ');
  }

  if (!privateJwk.d) {
    throw new Error('KEYCLOAK_DPOP_PRIVATE_JWK thiếu trường "d" (private key)');
  }

  // Tách public key: loại bỏ trường d
  const { d, ...publicJwk } = privateJwk as any;
  return {
    privateJwk,
    publicJwk: { ...publicJwk, alg: 'ES256', use: 'sig' } as jose.JWK,
  };
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { username, email, password } = body;

    // Validate đầu vào cơ bản
    if (!username || !email || !password) {
      return NextResponse.json(
        { error: 'Thiếu username, email hoặc password' },
        { status: 400 }
      );
    }

    // ── Load cấu hình ──────────────────────────────────────────────────────
    const issuerUrl = process.env.KEYCLOAK_ISSUER || 'http://keycloak:8080/realms/drm-realm';
    const clientId = process.env.KEYCLOAK_CLIENT_ID || 'backend-api';
    const clientSecret = process.env.KEYCLOAK_SECRET;

    if (!clientSecret) {
      return NextResponse.json(
        { error: 'Thiếu KEYCLOAK_SECRET trong file .env' },
        { status: 500 }
      );
    }

    // ── Load keypair từ env (throw nếu thiếu) ─────────────────────────────
    const { privateJwk, publicJwk } = loadDPoPKeys();
    const privateKey = await jose.importJWK(privateJwk, 'ES256');

    // ── Build URLs ─────────────────────────────────────────────────────────
    const tokenEndpointFetch = `${issuerUrl}/protocol/openid-connect/token`;
    const domainGoc = issuerUrl.split('/realms/')[0];
    const realmName = issuerUrl.split('/realms/')[1];
    const createUserEndpointFetch = `${domainGoc}/admin/realms/${realmName}/users`;

    // ══════════════════════════════════════════════════════════════════════
    // BƯỚC 1: Xin token admin với DPoP proof (không có ath — chưa có token)
    // ══════════════════════════════════════════════════════════════════════
    const tokenDpopProof = await new jose.SignJWT({
      jti: crypto.randomUUID(),
      htm: 'POST',
      htu: tokenEndpointFetch,
    })
      .setProtectedHeader({ alg: 'ES256', typ: 'dpop+jwt', jwk: publicJwk })
      .setIssuedAt()
      .setExpirationTime('2m')
      .sign(privateKey);

    const params = new URLSearchParams();
    params.append('grant_type', 'client_credentials');
    params.append('client_id', clientId);
    params.append('client_secret', clientSecret);

    const tokenRes = await fetch(tokenEndpointFetch, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'DPoP': tokenDpopProof,
      },
      body: params,
    });

    if (!tokenRes.ok) {
      const errText = await tokenRes.text();
      console.error('❌ [Register] Lỗi lấy token admin:', errText);
      return NextResponse.json(
        { error: 'Không lấy được token admin' },
        { status: tokenRes.status }
      );
    }

    const tokenData = await tokenRes.json();
    const adminToken: string = tokenData.access_token;

    // ══════════════════════════════════════════════════════════════════════
    // BƯỚC 2: Tạo user với DPoP proof có ath (ràng buộc với adminToken)
    // ══════════════════════════════════════════════════════════════════════
    const tokenHash = crypto.createHash('sha256').update(adminToken).digest();
    const ath = jose.base64url.encode(tokenHash);

    const adminDpopProof = await new jose.SignJWT({
      jti: crypto.randomUUID(),
      htm: 'POST',
      htu: createUserEndpointFetch,
      ath,
    })
      .setProtectedHeader({ alg: 'ES256', typ: 'dpop+jwt', jwk: publicJwk })
      .setIssuedAt()
      .setExpirationTime('2m')
      .sign(privateKey);

    const createUserRes = await fetch(createUserEndpointFetch, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `DPoP ${adminToken}`,
        'DPoP': adminDpopProof,
      },
      body: JSON.stringify({
        username,
        email,
        firstName: username,
        lastName: 'Member',
        enabled: true,
        emailVerified: true,
        credentials: [{ type: 'password', value: password, temporary: false }],
      }),
    });

    if (createUserRes.ok || createUserRes.status === 201) {
      return NextResponse.json({ message: 'Đăng ký thành công!' }, { status: 201 });
    }

    const rawErrorText = await createUserRes.text();
    console.error('❌ [Register] Keycloak từ chối:', rawErrorText);
    return NextResponse.json(
      { error: `Keycloak từ chối: ${rawErrorText}` },
      { status: createUserRes.status }
    );

  } catch (error: any) {
    console.error('❌ [Register] Lỗi server:', error.message);
    return NextResponse.json(
      { error: `Lỗi Server Nội Bộ: ${error.message}` },
      { status: 500 }
    );
  }
}