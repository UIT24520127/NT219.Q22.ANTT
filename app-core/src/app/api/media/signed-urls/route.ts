// app/api/media/signed-url/route.ts
import { NextResponse } from 'next/server';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { verifyDPoPProof } from '@/lib/dpop/verify';

const r2Client = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT!,
  credentials: {
    accessKeyId:  process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});

const ALLOWED_PATH_REGEX = /^[a-zA-Z0-9_\-\/\.]+\.(?:mpd|m4s|mp4|mp4a|init|m4a)$/;
const PRESIGNED_URL_TTL  = 300;

// ── Keycloak introspect — lấy active + cnf.jkt ───────────────────────────────
async function introspectToken(token: string): Promise<{ active: boolean; jkt?: string }> {
  const params = new URLSearchParams({
    client_id:     'backend-client',
    client_secret: process.env.KEYCLOAK_SECRET || '',
    token,
  });

  const res = await fetch(
    `${process.env.KEYCLOAK_ISSUER}/protocol/openid-connect/token/introspect`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params,
      cache: 'no-store',
    }
  );

  if (!res.ok) {
    console.error('[SignedURL] Keycloak introspect HTTP error:', res.status);
    return { active: false };
  }

  const info = await res.json();
  return {
    active: info.active === true,
    jkt:    info.cnf?.jkt as string | undefined,
  };
}

// ── Tính JWK Thumbprint (P-256) để so với cnf.jkt ────────────────────────────
async function computeJwkThumbprint(jwkHeader: Record<string, unknown>): Promise<string> {
  const canonical = JSON.stringify({
    crv: jwkHeader.crv,
    kty: jwkHeader.kty,
    x:   jwkHeader.x,
    y:   jwkHeader.y,
  });
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  return btoa(String.fromCharCode(...new Uint8Array(hash)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

export async function GET(request: Request) {
  // ── 1. Auth header ────────────────────────────────────────────────────────
  const authHeader = request.headers.get('authorization') || '';
  const dpopHeader = request.headers.get('dpop') || '';

  if (!authHeader.toLowerCase().startsWith('bearer ')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const token = authHeader.slice(7);

  // ── 2. Introspect token qua Keycloak ─────────────────────────────────────
  let jkt: string | undefined;
  try {
    const { active, jkt: tokenJkt } = await introspectToken(token);
    if (!active) {
      return NextResponse.json({ error: 'Token inactive or expired' }, { status: 401 });
    }
    jkt = tokenJkt;
  } catch (err) {
    console.error('[SignedURL] Introspect failed:', err);
    return NextResponse.json({ error: 'Auth server error' }, { status: 500 });
  }

  // ── 3. DPoP verification — bắt buộc nếu token là DPoP-bound ─────────────
  if (jkt) {
    if (!dpopHeader) {
      return NextResponse.json({ error: 'DPoP proof required' }, { status: 401 });
    }

    const reqUrl  = new URL(request.url);
    const htuBase = `${reqUrl.origin}${reqUrl.pathname}`;

    const result = await verifyDPoPProof({
      proof:       dpopHeader,
      htm:         'GET',
      htu:         htuBase,
      accessToken: token,
    });

    if (!result.valid) {
      console.warn('[SignedURL DPoP]', result.error);
      return NextResponse.json({ error: result.error }, { status: 401 });
    }

    // ── 4. So khớp thumbprint với cnf.jkt ──────────────────────────────────
    const { decodeProtectedHeader } = await import('jose');
    const proofHeader = decodeProtectedHeader(dpopHeader);
    const thumbprint  = await computeJwkThumbprint(proofHeader.jwk as Record<string, unknown>);

    if (thumbprint !== jkt) {
      console.warn('[SignedURL DPoP] Thumbprint mismatch');
      return NextResponse.json({ error: 'DPoP key binding mismatch' }, { status: 401 });
    }
  }

  // ── 5. Validate key param ─────────────────────────────────────────────────
  const { searchParams } = new URL(request.url);
  const key = searchParams.get('key');

  if (!key) {
    return NextResponse.json({ error: 'Missing ?key= parameter' }, { status: 400 });
  }

  const normalizedKey = key.replace(/^\/+/, '');
  if (
    normalizedKey.includes('..') ||
    normalizedKey.includes('//') ||
    !ALLOWED_PATH_REGEX.test(normalizedKey)
  ) {
    return NextResponse.json({ error: 'Invalid key path' }, { status: 400 });
  }

  // ── 6. Tạo presigned URL ──────────────────────────────────────────────────
  try {
    const command = new GetObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME!,
      Key:    normalizedKey,
    });

    const signedUrl = await getSignedUrl(r2Client, command, { expiresIn: PRESIGNED_URL_TTL });
    console.log(`✅ [SignedURL] Issued for key: ${normalizedKey}`);

    return NextResponse.json(
      { url: signedUrl, expiresIn: PRESIGNED_URL_TTL },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (err) {
    console.error('❌ [SignedURL] R2 error:', err);
    return NextResponse.json({ error: 'Failed to generate signed URL' }, { status: 500 });
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    headers: {
      'Access-Control-Allow-Origin':  process.env.APP_URL || 'https://uitify.duckdns.org',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, DPoP, Content-Type',
    },
  });
}