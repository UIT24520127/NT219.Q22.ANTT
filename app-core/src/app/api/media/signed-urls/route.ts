// app/api/media/signed-url/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import * as jose from 'jose';

const r2Client = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT!,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});

const ALLOWED_PATH_REGEX =
  /^[a-zA-Z0-9_\-\/\.]+\.(?:mpd|m4s|mp4|mp4a|init|m4a)$/;
const PRESIGNED_URL_TTL = 300; // 5 phút

// ─────────────────────────────────────────────────────────────────────────────
// Auth helpers
// ─────────────────────────────────────────────────────────────────────────────

let _jwks: ReturnType<typeof jose.createRemoteJWKSet> | null = null;
function getJWKS() {
  if (!_jwks) {
    const issuer =
      process.env.KEYCLOAK_ISSUER || 'http://keycloak:8080/realms/drm-realm';
    _jwks = jose.createRemoteJWKSet(
      new URL(`${issuer}/protocol/openid-connect/certs`)
    );
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

  const issuer =
    process.env.KEYCLOAK_ISSUER || 'http://keycloak:8080/realms/drm-realm';

  let payload: jose.JWTPayload;
  try {
    const result = await jose.jwtVerify(token, getJWKS(), { issuer });
    payload = result.payload;
  } catch {
    return { ok: false, status: 401, error: 'Invalid or expired token' };
  }

  const roles: string[] = (payload as any)?.realm_access?.roles ?? [];
  if (!roles.includes('music_listener')) {
    return {
      ok: false,
      status: 403,
      error: 'Forbidden: role music_listener required',
    };
  }

  return { ok: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/media/signed-url?key=<path>
// ─────────────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  // ── Auth + Role ───────────────────────────────────────────────────────────
  const authResult = await verifyAndCheckRole(request);
  if (!authResult.ok) {
    return NextResponse.json(
      { error: authResult.error },
      { status: authResult.status }
    );
  }

  // ── Validate key param ────────────────────────────────────────────────────
  const { searchParams } = new URL(request.url);
  const key = searchParams.get('key');

  if (!key) {
    return NextResponse.json(
      { error: 'Missing ?key= parameter' },
      { status: 400 }
    );
  }

  const normalizedKey = key.replace(/^\/+/, '');
  if (
    normalizedKey.includes('..') ||
    normalizedKey.includes('//') ||
    !ALLOWED_PATH_REGEX.test(normalizedKey)
  ) {
    return NextResponse.json({ error: 'Invalid key path' }, { status: 400 });
  }

  // ── Tạo presigned URL ─────────────────────────────────────────────────────
  try {
    const command = new GetObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME!,
      Key: normalizedKey,
    });

    const signedUrl = await getSignedUrl(r2Client, command, {
      expiresIn: PRESIGNED_URL_TTL,
    });

    console.log(`✅ [SignedURL] Issued for key: ${normalizedKey}`);

    return NextResponse.json(
      { url: signedUrl, expiresIn: PRESIGNED_URL_TTL },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (err: unknown) {
    console.error('❌ [SignedURL] R2 error:', err);
    return NextResponse.json(
      { error: 'Failed to generate signed URL' },
      { status: 500 }
    );
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    },
  });
}