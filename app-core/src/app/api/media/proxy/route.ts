// app/api/media/proxy/route.ts
import { NextResponse } from 'next/server';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { verifyDPoPProof } from '@/lib/dpop/verify';

const r2Client = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT!,
  credentials: {
    accessKeyId:     process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});

const ALLOWED_EXT = /\.(mpd|m4s|mp4|m4a|webm)$/i;
const ALLOWED_ORIGIN = process.env.APP_URL || 'https://uitify.duckdns.org';

function getMime(key: string): string {
  if (key.endsWith('.mpd'))  return 'application/dash+xml';
  if (key.endsWith('.m4s'))  return 'video/iso.segment';
  if (key.endsWith('.mp4'))  return 'video/mp4';
  if (key.endsWith('.m4a'))  return 'audio/mp4';
  if (key.endsWith('.webm')) return 'video/webm';
  return 'application/octet-stream';
}

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
      // KHÔNG forward DPoP header vào introspect — không đúng spec
      body: params,
      cache: 'no-store',
    }
  );

  if (!res.ok) return { active: false };
  const info = await res.json();
  return {
    active: info.active === true,
    jkt: info.cnf?.jkt as string | undefined,
  };
}

// ── Tính JWK Thumbprint (P-256) để so với cnf.jkt ────────────────────────────
async function computeJwkThumbprint(jwkHeader: Record<string, unknown>): Promise<string> {
  // Canonical form RFC 7638: chỉ lấy crv, kty, x, y — đúng thứ tự alpha
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
  const authHeader = request.headers.get('authorization') || '';
  const dpopHeader = request.headers.get('dpop') || '';

  if (!authHeader.toLowerCase().startsWith('bearer ')) {
    return NextResponse.json({ error: 'Missing or invalid Authorization header' }, { status: 401 });
  }
  const token = authHeader.slice(7);

  try {
    // ── 1. Introspect token (Keycloak verify ES256 sig, expiry, revocation) ──
    const { active, jkt } = await introspectToken(token);
    if (!active) {
      return NextResponse.json({ error: 'Token inactive or expired' }, { status: 401 });
    }

    // ── 2. DPoP verification — bắt buộc nếu token là DPoP-bound ──────────────
    if (jkt) {
      if (!dpopHeader) {
        return NextResponse.json({ error: 'DPoP proof required' }, { status: 401 });
      }

      // htu dùng chỉ scheme+host+path, bỏ query string
      // vì ?key= thay đổi mỗi request nhưng endpoint vẫn là cùng 1 route
      const reqUrl  = new URL(request.url);
      const htuBase = `${reqUrl.origin}${reqUrl.pathname}`;

      const result = await verifyDPoPProof({
        proof:       dpopHeader,
        htm:         'GET',
        htu:         htuBase,
        accessToken: token,
      });

      if (!result.valid) {
        console.warn('[Proxy DPoP]', result.error);
        return NextResponse.json({ error: result.error }, { status: 401 });
      }

      // ── 3. So khớp thumbprint proof JWK với cnf.jkt trong token ──────────
      // verifyDPoPProof đã verify signature, nhưng cần thêm bước này để chắc
      // rằng key trong proof đúng là key mà Keycloak đã bind vào token.
      const { decodeProtectedHeader } = await import('jose');
      const proofHeader = decodeProtectedHeader(dpopHeader);
      const thumbprint  = await computeJwkThumbprint(proofHeader.jwk as Record<string, unknown>);

      if (thumbprint !== jkt) {
        console.warn('[Proxy DPoP] Thumbprint mismatch — possible key substitution attack');
        return NextResponse.json({ error: 'DPoP key binding mismatch' }, { status: 401 });
      }
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Auth error';
    console.error('[Proxy Auth Error]:', msg);
    return NextResponse.json({ error: 'Cryptographic authentication failed' }, { status: 500 });
  }

  // ── 4. Validate path media ────────────────────────────────────────────────
  const key = new URL(request.url).searchParams.get('key');
  if (!key) return NextResponse.json({ error: 'Missing ?key=' }, { status: 400 });

  const clean = key.replace(/^\/+/, '');
  if (clean.includes('..') || clean.includes('//') || !ALLOWED_EXT.test(clean)) {
    return NextResponse.json({ error: 'Invalid key format' }, { status: 400 });
  }

  const r2Key = clean.startsWith('audio/') ? clean : `audio/${clean}`;

  try {
    const cmd      = new GetObjectCommand({ Bucket: process.env.R2_BUCKET_NAME!, Key: r2Key });
    const signedUrl = await getSignedUrl(r2Client, cmd, { expiresIn: 60 });

    const r2Res = await fetch(signedUrl, { cache: 'no-store' });
    if (!r2Res.ok) {
      return NextResponse.json({ error: 'Media not found in storage' }, { status: r2Res.status });
    }

    const headers = new Headers({
      'Content-Type':                getMime(r2Key),
      'Cache-Control':               'private, max-age=60',
      'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
      'Access-Control-Allow-Methods':'GET, OPTIONS',
    });
    const cl = r2Res.headers.get('content-length');
    if (cl) headers.set('Content-Length', cl);

    return new NextResponse(r2Res.body, { status: 200, headers });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[Proxy Media Error]:', msg);
    return NextResponse.json({ error: 'Proxy delivery failed' }, { status: 500 });
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    headers: {
      'Access-Control-Allow-Origin':  ALLOWED_ORIGIN,
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, DPoP, Content-Type',
    },
  });
}