// app/api/media/signed-url/route.ts
import { NextResponse } from 'next/server';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const r2Client = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT!,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});

// Chỉ cho phép path trong bucket encrypted-audio
const ALLOWED_PATH_REGEX = /^[a-zA-Z0-9_\-\/\.]+\.(?:mpd|m4s|mp4|mp4a|init|m4a)$/;
const PRESIGNED_URL_TTL = 300; // 5 phút

export async function GET(request: Request) {
  // ── Auth check ────────────────────────────────────────────────────────────
  const authHeader = request.headers.get('authorization') || '';
  if (!authHeader.toLowerCase().startsWith('bearer ')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Verify JWT còn hạn (basic check — full verify nên dùng Keycloak introspect)
  try {
    const token = authHeader.slice(7);
    const payload = JSON.parse(
      Buffer.from(token.split('.')[1], 'base64url').toString()
    );
    if (payload.exp && payload.exp * 1000 < Date.now()) {
      return NextResponse.json({ error: 'Token expired' }, { status: 401 });
    }
  } catch {
    return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
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

  // Chặn path traversal + chỉ cho phép file media hợp lệ
  const normalizedKey = key.replace(/^\/+/, ''); // strip leading slash
  if (
    normalizedKey.includes('..') ||
    normalizedKey.includes('//') ||
    !ALLOWED_PATH_REGEX.test(normalizedKey)
  ) {
    return NextResponse.json(
      { error: 'Invalid key path' },
      { status: 400 }
    );
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
      {
        headers: {
          // Không cache presigned URL trên client
          'Cache-Control': 'no-store',
        },
      }
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