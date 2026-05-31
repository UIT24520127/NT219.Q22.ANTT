import { NextResponse } from 'next/server';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const r2Client = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT!,
  credentials: {
    accessKeyId:     process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});

const ALLOWED_EXT = /\.(mpd|m4s|mp4|m4a|webm)$/i;

function getMime(key: string): string {
  if (key.endsWith('.mpd'))  return 'application/dash+xml';
  if (key.endsWith('.m4s'))  return 'video/iso.segment';
  if (key.endsWith('.mp4'))  return 'video/mp4';
  if (key.endsWith('.m4a'))  return 'audio/mp4';
  if (key.endsWith('.webm')) return 'video/webm';
  return 'application/octet-stream';
}

export async function GET(request: Request) {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const auth = request.headers.get('authorization') || '';
  if (!auth.toLowerCase().startsWith('bearer ')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const payload = JSON.parse(
      Buffer.from(auth.slice(7).split('.')[1], 'base64url').toString()
    );
    if (payload.exp && payload.exp * 1000 < Date.now()) {
      return NextResponse.json({ error: 'Token expired' }, { status: 401 });
    }
  } catch {
    return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
  }

  // ── Key validation ────────────────────────────────────────────────────────
  const key = new URL(request.url).searchParams.get('key');
  if (!key) return NextResponse.json({ error: 'Missing ?key=' }, { status: 400 });

  const clean = key.replace(/^\/+/, '');
  if (clean.includes('..') || clean.includes('//') || !ALLOWED_EXT.test(clean)) {
    return NextResponse.json({ error: 'Invalid key' }, { status: 400 });
  }

  // ── R2 key: thêm prefix "audio/" nếu chưa có ─────────────────────────────
  // Player gửi:  63721051-a5ad.../manifest.mpd  (chỉ trackId/file)
  // R2 lưu tại:  audio/63721051-a5ad.../manifest.mpd
  const r2Key = clean.startsWith('audio/') ? clean : `audio/${clean}`;

  try {
    const cmd = new GetObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME!,
      Key: r2Key,
    });
    const signedUrl = await getSignedUrl(r2Client, cmd, { expiresIn: 60 });
    const r2Res = await fetch(signedUrl);

    if (!r2Res.ok) {
      console.error(`[Proxy] R2 ${r2Res.status} key=${r2Key}`);
      return NextResponse.json({ error: 'Media not found' }, { status: r2Res.status });
    }

    const headers = new Headers({
      'Content-Type':                  getMime(r2Key),
      'Cache-Control':                 'private, max-age=60',
      'Access-Control-Allow-Origin':   '*',
      'Access-Control-Allow-Methods':  'GET, OPTIONS',
    });
    const cl = r2Res.headers.get('content-length');
    if (cl) headers.set('Content-Length', cl);

    return new NextResponse(r2Res.body, { status: 200, headers });

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
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    },
  });
}