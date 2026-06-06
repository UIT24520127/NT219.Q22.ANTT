// app/api/auth/me/route.ts
import { NextRequest, NextResponse } from 'next/server';
import * as jose from 'jose';

// Cache JWKS để không fetch mỗi request
let jwksCache: ReturnType<typeof jose.createRemoteJWKSet> | null = null;

function getJWKS() {
  if (!jwksCache) {
    // Internal URL để fetch JWKS (docker network)
    const jwksIssuer = process.env.KEYCLOAK_ISSUER || 'http://keycloak:8080/realms/drm-realm';
    jwksCache = jose.createRemoteJWKSet(
      new URL(`${jwksIssuer}/protocol/openid-connect/certs`)
    );
  }
  return jwksCache;
}

export async function GET(req: NextRequest) {
  const token = req.cookies.get('access_token')?.value;

  if (!token) {
    return NextResponse.json(null, { status: 401 });
  }

  try {
    // KEYCLOAK_PUBLIC_ISSUER = public URL khớp với iss claim trong token
    // (KC_HOSTNAME trên VPS → iss = https://domain/realms/...)
    const jwksIssuer  = process.env.KEYCLOAK_ISSUER || 'http://keycloak:8080/realms/drm-realm';
    const claimIssuer = process.env.KEYCLOAK_PUBLIC_ISSUER || jwksIssuer;

    const { payload } = await jose.jwtVerify(token, getJWKS(), {
      issuer: claimIssuer,
      // Không check audience vì frontend-client là public client
    });

    return NextResponse.json(payload, {
      headers: { 'Cache-Control': 'no-store' },
    });

  } catch (err: any) {
    // Token hết hạn hoặc không hợp lệ
    if (err.code === 'ERR_JWT_EXPIRED') {
      return NextResponse.json({ error: 'token_expired' }, { status: 401 });
    }
    return NextResponse.json(null, { status: 401 });
  }
}