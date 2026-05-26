import { NextResponse } from 'next/server';
import * as jose from 'jose';
import crypto from 'crypto';

const PRIVATE_JWK = {
  "kty": "EC",
  "crv": "P-256",
  "x": "8xJqKSuNAr21oGZl4kNTQbrYfmpjll1VfW68T5m61aY",
  "y": "ciAhf8vsOrYF9OcQlf8BgyL3z7DsMga6qQCBANrhDxk",
  "d": "ZlrJLOJlClmHHl2Slgu_DrROMAPsB9VdAFjh3Lcdcc4"
};

const PUBLIC_JWK = {
  "kty": "EC",
  "crv": "P-256",
  "x": PRIVATE_JWK.x,
  "y": PRIVATE_JWK.y,
  "alg": "ES256",
  "use": "sig"
};

export async function POST(req: Request) {
  try {
    const { username, password } = await req.json();
    const issuerUrl = process.env.KEYCLOAK_ISSUER || "http://keycloak:8080/realms/drm-realm";
    const tokenEndpointFetch = `${issuerUrl}/protocol/openid-connect/token`;

    const privateKey = await jose.importJWK(PRIVATE_JWK, 'ES256');

    // 🔐 Tạo chữ ký Proof cho Login (Trị lỗi "DPoP proof is missing")
    const loginDpopProof = await new jose.SignJWT({
      jti: crypto.randomUUID(),
      htm: 'POST',
      htu: tokenEndpointFetch,
    })
      .setProtectedHeader({ alg: 'ES256', typ: 'dpop+jwt', jwk: PUBLIC_JWK })
      .setIssuedAt()
      .setExpirationTime('2m')
      .sign(privateKey);

    const params = new URLSearchParams();
    params.append('grant_type', 'password');
    params.append('client_id', 'frontend-client'); 
    params.append('username', username);
    params.append('password', password);

    const response = await fetch(tokenEndpointFetch, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'DPoP': loginDpopProof
      },
      body: params
    });

    const data = await response.json();
    if (response.ok) {
      return NextResponse.json(data, { status: 200 });
    } else {
      return NextResponse.json({ error: data.error_description || data.error }, { status: response.status });
    }
  } catch (error: any) {
    return NextResponse.json({ error: `Lỗi Server Login: ${error.message}` }, { status: 500 });
  }
}