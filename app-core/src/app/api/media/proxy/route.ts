// app/api/media/proxy/route.ts
// Proxy R2 media với Range header support (cần cho DASH segments)
import { NextRequest, NextResponse } from 'next/server';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import * as jose from 'jose';

const r2Client = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT!,
  credentials: {
    accessKeyId:     process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});

const ALLOWED_EXT = /\.(mpd|m4s|mp4|m4a|webm|cmfa|cmfv|cmft|cmfl|cmfm)$/i;

function getMime(key: string): string {
  if (key.endsWith('.mpd'))  return 'application/dash+xml';
  if (key.endsWith('.m4s'))  return 'video/iso.segment';
  if (key.endsWith('.mp4'))  return 'video/mp4';
  if (key.endsWith('.m4a'))  return 'audio/mp4';
  if (key.endsWith('.webm')) return 'video/webm';
  // Common DASH init/segment extensions
  if (key.match(/\.(cmfa|cmfv|cmft|cmfl|cmfm)$/)) return 'video/iso.segment';
  return 'application/octet-stream';
}

// ── JWKS cache ────────────────────────────────────────────────────────────────
let _jwks: ReturnType<typeof jose.createRemoteJWKSet> | null = null;
function getJWKS() {
  if (!_jwks) {
    const issuer = process.env.KEYCLOAK_ISSUER || 'http://keycloak:8080/realms/drm-realm';
    _jwks = jose.createRemoteJWKSet(new URL(`${issuer}/protocol/openid-connect/certs`));
  }
  return _jwks;
}

async function verifyAndCheckRole(request: NextRequest): Promise<
  | { ok: true }
  | { ok: false; status: 401 | 403; error: string }
> {
  const token = request.cookies.get('access_token')?.value;
  if (!token) {
    return { ok: false, status: 401, error: 'Unauthorized' };
  }
  const issuer = process.env.KEYCLOAK_ISSUER || 'http://keycloak:8080/realms/drm-realm';
  let payload: jose.JWTPayload;
  try {
    ({ payload } = await jose.jwtVerify(token, getJWKS(), { issuer }));
  } catch {
    return { ok: false, status: 401, error: 'Invalid or expired token' };
  }
  const roles: string[] = (payload as any)?.realm_access?.roles ?? [];
  if (!roles.includes('music_listener')) {
    return { ok: false, status: 403, error: 'Forbidden: role music_listener required' };
  }
  return { ok: true };
}

// ── GET /api/media/proxy?key=<r2-key> ────────────────────────────────────────
export async function GET(request: NextRequest) {
  // ── Auth + Role ───────────────────────────────────────────────────────────
  const authResult = await verifyAndCheckRole(request);
  if (!authResult.ok) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status });
  }

  // ── Key validation ────────────────────────────────────────────────────────
  const key = new URL(request.url).searchParams.get('key');
  if (!key) return NextResponse.json({ error: 'Missing ?key=' }, { status: 400 });

  const clean = key.replace(/^\/+/, '');
  if (clean.includes('..') || clean.includes('//') || !ALLOWED_EXT.test(clean)) {
    return NextResponse.json({ error: 'Invalid key' }, { status: 400 });
  }

  // ── R2 key prefix ─────────────────────────────────────────────────────────
  const r2Key = clean.startsWith('audio/') ? clean : `audio/${clean}`;

  // ── Passthrough Range header (critical for DASH segments) ─────────────────
  const rangeHeader = request.headers.get('range');

  try {
    const cmd = new GetObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME!,
      Key:    r2Key,
      // Nếu có Range, truyền xuống R2 để fetch đúng byte range
      ...(rangeHeader ? { Range: rangeHeader } : {}),
    });

    const signedUrl = await getSignedUrl(r2Client, cmd, { expiresIn: 60 });

    const fetchHeaders: HeadersInit = {};
    if (rangeHeader) fetchHeaders['Range'] = rangeHeader;

    const r2Res = await fetch(signedUrl, { headers: fetchHeaders });

    if (!r2Res.ok && r2Res.status !== 206) {
      console.error(`[Proxy] R2 ${r2Res.status} key=${r2Key}`);
      return NextResponse.json({ error: 'Media not found' }, { status: r2Res.status });
    }

    const resHeaders = new Headers({
      'Content-Type':                  getMime(r2Key),
      'Cache-Control':                 'private, max-age=60',
      'Access-Control-Allow-Origin':   '*',
      'Access-Control-Allow-Methods':  'GET, OPTIONS',
      'Access-Control-Allow-Headers':  'Authorization, Range',
      // Cho phép client đọc Range response
      'Access-Control-Expose-Headers': 'Content-Range, Content-Length, Accept-Ranges',
      'Accept-Ranges':                 'bytes',
    });

    // Passthrough content headers từ R2
    const passthrough = ['content-length', 'content-range', 'last-modified', 'etag'];
    for (const h of passthrough) {
      const v = r2Res.headers.get(h);
      if (v) resHeaders.set(h, v);
    }

    // 206 Partial Content nếu là range request
    const status = r2Res.status === 206 ? 206 : 200;
    return new NextResponse(r2Res.body, { status, headers: resHeaders });

  } catch (err: any) {
    console.error('[Proxy] Error:', err.message);
    return NextResponse.json({ error: 'Proxy failed' }, { status: 500 });
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    headers: {
      'Access-Control-Allow-Origin':  '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type, Range',
    },
  });
}