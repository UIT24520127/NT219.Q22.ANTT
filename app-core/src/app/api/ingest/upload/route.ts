// app/api/ingest/upload/route.ts
// Chỉ xử lý POST upload + mã hóa
// Xác thực: HttpOnly cookie → verify JWT → kiểm tra role music_uploader → verify DPoP

export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { writeFileSync, mkdirSync, existsSync, unlinkSync } from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import * as jose from 'jose';
import {
  createTrack,
  updateTrackDuration,
  saveDASHManifest,
  deactivateOldManifests,
  logAuditEvent,
} from '@/lib/track-db';
import { verifyDPoPProof } from '@/lib/dpop/verify';
import { encryptAndPackageMedia } from '@/lib/packager/packager';

const TEMP_UPLOAD_DIR = process.env.TEMP_UPLOAD_DIR || '/tmp/audio-uploads';

// ── JWKS cache ────────────────────────────────────────────────────────────────
let _jwks: ReturnType<typeof jose.createRemoteJWKSet> | null = null;
function getJWKS() {
  if (!_jwks) {
    const issuer = process.env.KEYCLOAK_ISSUER || 'http://keycloak:8080/auth/realms/drm-realm';
    _jwks = jose.createRemoteJWKSet(
      new URL(`${issuer}/protocol/openid-connect/certs`)
    );
  }
  return _jwks;
}

// ── Xác thực token từ HttpOnly cookie ────────────────────────────────────────
async function verifyTokenFromCookie(req: NextRequest): Promise<{
  valid: boolean;
  payload?: jose.JWTPayload;
  error?: string;
  rawToken?: string;
}> {
  const token = req.cookies.get('access_token')?.value;
  if (!token) return { valid: false, error: 'Không có access_token cookie' };

  try {
    const issuer = process.env.KEYCLOAK_ISSUER || 'http://keycloak:8080/auth/realms/drm-realm';
    const { payload } = await jose.jwtVerify(token, getJWKS(), { issuer });
    return { valid: true, payload, rawToken: token };
  } catch (err: any) {
    return { valid: false, error: err.message };
  }
}

// ── Kiểm tra role ─────────────────────────────────────────────────────────────
function hasRole(payload: jose.JWTPayload, role: string): boolean {
  const roles: string[] = (payload as any)?.realm_access?.roles ?? [];
  return roles.includes(role);
}

// ── Validate file ─────────────────────────────────────────────────────────────
const ensureUploadDir = () => {
  if (!existsSync(TEMP_UPLOAD_DIR)) mkdirSync(TEMP_UPLOAD_DIR, { recursive: true });
};

const validateAudioFile = (filename: string, buffer: Buffer): boolean => {
  const ext = path.extname(filename).toLowerCase();
  if (!['.m4a', '.aac', '.mp4'].includes(ext)) {
    console.warn(`⚠️  [Upload] Invalid extension: ${ext}`);
    return false;
  }
  const magicBytes = buffer.slice(0, 12).toString('hex');
  const hasM4ASignature = magicBytes.includes('66747970');
  const hasAACSignature = (buffer[0] & 0xFF) === 0xFF && ((buffer[1] & 0xE0) === 0xE0);
  if (!hasM4ASignature && !hasAACSignature) {
    console.warn('⚠️  [Upload] File does not appear to be valid AAC/M4A');
    return false;
  }
  return true;
};

const extractAudioFile = async (request: NextRequest): Promise<{ filename: string; buffer: Buffer } | null> => {
  try {
    const contentType = request.headers.get('content-type');
    if (contentType?.includes('multipart/form-data')) {
      const formData = await request.formData();
      // Hỗ trợ cả 'audio' và 'file' field name
      const file = (formData.get('audio') || formData.get('file')) as File | null;
      if (!file) { console.error('❌ [Upload] No audio file in form data'); return null; }
      return { filename: file.name, buffer: Buffer.from(await file.arrayBuffer()) };
    } else if (contentType?.includes('application/octet-stream')) {
      const buffer = Buffer.from(await request.arrayBuffer());
      const filename = request.headers.get('x-filename') || `audio-${uuidv4()}.m4a`;
      return { filename, buffer };
    }
    console.error('❌ [Upload] Unsupported content type:', contentType);
    return null;
  } catch (error: unknown) {
    console.error('❌ [Upload] Error parsing request:', error instanceof Error ? error.message : error);
    return null;
  }
};

// ── POST: Upload + Mã hóa ─────────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  let tempFilePath: string | null = null;
  let trackId: string | null = null;

  try {
    console.log('📥 [Upload] Processing audio upload...');
    ensureUploadDir();

    // ── BƯỚC 1: Xác thực JWT từ HttpOnly cookie ───────────────────────────
    const authResult = await verifyTokenFromCookie(request);
    if (!authResult.valid || !authResult.payload) {
      console.warn('❌ [Upload] Auth failed:', authResult.error);
      return NextResponse.json(
        { error: 'Unauthorized', detail: authResult.error },
        { status: 401 }
      );
    }

    // ── BƯỚC 2: Kiểm tra role music_uploader ─────────────────────────────
    if (!hasRole(authResult.payload, 'music_uploader')) {
      const userRoles = (authResult.payload as any)?.realm_access?.roles ?? [];
      console.warn(`❌ [Upload] Forbidden - user roles: ${userRoles.join(', ')}`);
      return NextResponse.json(
        { error: 'Forbidden: Chỉ music_uploader mới được upload nhạc' },
        { status: 403 }
      );
    }

    // ── BƯỚC 3: Verify DPoP proof ─────────────────────────────────────────
    const dpopHeader = request.headers.get('dpop');
    if (!dpopHeader) {
      console.warn('❌ [Upload] Missing DPoP header');
      return NextResponse.json(
        { error: 'DPoP proof required', hint: 'Add DPoP header' },
        { status: 401, headers: { 'WWW-Authenticate': 'DPoP algs="ES256"' } }
      );
    }

    const getUploadEndpointUrl = (req: NextRequest): string => {
      if (process.env.APP_URL) return `${process.env.APP_URL.replace(/\/$/, '')}/api/ingest/upload`;
      const host  = req.headers.get('host') || 'localhost';
      const proto = req.headers.get('x-forwarded-proto') || (host.startsWith('localhost') ? 'http' : 'https');
      return `${proto}://${host}/api/ingest/upload`;
    };

    const uploadUrl  = getUploadEndpointUrl(request);
    const dpopResult = await verifyDPoPProof({
      proof:       dpopHeader,
      htm:         'POST',
      htu:         uploadUrl,
      accessToken: authResult.rawToken!,
    });

    if (!dpopResult.valid) {
      console.warn('❌ [Upload] DPoP verify failed:', dpopResult.error);
      return NextResponse.json(
        { error: 'DPoP verification failed', detail: dpopResult.error },
        { status: 401, headers: { 'WWW-Authenticate': 'DPoP algs="ES256" error="invalid_dpop_proof"' } }
      );
    }

    const userId   = authResult.payload.sub;
    const username = (authResult.payload as any).preferred_username || userId;
    console.log(`✅ [Upload] Auth OK - user: ${username}, role: music_uploader`);

    // ── BƯỚC 4: Xử lý file ────────────────────────────────────────────────
    const audioFile = await extractAudioFile(request);
    if (!audioFile) {
      return NextResponse.json({ error: 'No valid audio file provided' }, { status: 400 });
    }

    if (!validateAudioFile(audioFile.filename, audioFile.buffer)) {
      return NextResponse.json(
        { error: 'Invalid audio format. Chỉ chấp nhận AAC hoặc M4A.' },
        { status: 400 }
      );
    }

    // ── BƯỚC 5: Mã hóa và đóng gói ───────────────────────────────────────
    tempFilePath = path.join(TEMP_UPLOAD_DIR, `${uuidv4()}${path.extname(audioFile.filename)}`);
    writeFileSync(tempFilePath, audioFile.buffer);

    const sourceFormat = path.extname(audioFile.filename).slice(1).toUpperCase();
    const trackData    = await createTrack(audioFile.filename, sourceFormat);
    trackId            = trackData.trackId;
    const { kid, encrypted_cek } = trackData;

    let packagingResult;
    try {
      packagingResult = await encryptAndPackageMedia(tempFilePath, trackId, kid, encrypted_cek);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      await logAuditEvent('PACKAGE_FAILED', trackId, kid, userId!, audioFile.filename);
      throw new Error(`Packaging failed: ${message}`);
    }

    if (!packagingResult?.mpdPath || !packagingResult?.segmentDir) {
      throw new Error('Invalid packaging result');
    }

    if (packagingResult.duration) await updateTrackDuration(trackId, packagingResult.duration);
    await deactivateOldManifests(trackId);
    await saveDASHManifest(trackId, packagingResult.mpdPath);

    try {
      await logAuditEvent('PACKAGE_CREATED', trackId, kid, userId!, audioFile.filename);
    } catch { /* non-critical */ }

    try { unlinkSync(tempFilePath); } catch { }

    console.log(`✅ [Upload] Track created: ${trackId} by ${username}`);

    return NextResponse.json({
      success: true,
      message: 'Audio processed successfully',
      data: {
        trackId,
        kid,
        filename:   audioFile.filename,
        duration:   packagingResult.duration,
        mpdPath:    packagingResult.mpdPath,
        segmentDir: packagingResult.segmentDir,
        bitrate:    packagingResult.bitrate,
        createdAt:  new Date().toISOString(),
      },
    }, { status: 201 });

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('❌ [Upload] Error during upload:', message);
    if (trackId) await logAuditEvent('INGEST_FAILED', trackId, undefined, 'SYSTEM', message);
    if (tempFilePath) try { unlinkSync(tempFilePath); } catch { }
    return NextResponse.json(
      {
        error: 'Upload processing failed',
        details: process.env.NODE_ENV === 'development' ? message : undefined,
      },
      { status: 500 }
    );
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    headers: {
      'Access-Control-Allow-Origin':  '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type, DPoP',
    },
  });
}