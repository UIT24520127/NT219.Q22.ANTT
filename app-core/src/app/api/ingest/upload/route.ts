export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { writeFileSync, mkdirSync, existsSync, unlinkSync } from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import {
  createTrack,
  getTrackById,
  getAllTracks,
  getActiveManifest,
  updateTrackDuration,
  saveDASHManifest,
  deactivateOldManifests,
  logAuditEvent,
} from '@/lib/track-db';
import { encryptAndPackageMedia, extractMediaMetadata } from '@/lib/packager/packager';
import { verifyAdminAccess, forbiddenResponse, getAdminTokenFromRequest } from '@/lib/auth/admin';
import { verifyDPoPProof } from '@/lib/dpop/verify';

const TEMP_UPLOAD_DIR = process.env.TEMP_UPLOAD_DIR || '/tmp/audio-uploads';

const ensureUploadDir = () => {
  if (!existsSync(TEMP_UPLOAD_DIR)) mkdirSync(TEMP_UPLOAD_DIR, { recursive: true });
};

const validateAudioFile = (filename: string, buffer: Buffer): boolean => {
  const ext = path.extname(filename).toLowerCase();
  if (!['.m4a', '.aac', '.mp4'].includes(ext)) {
    console.warn(`⚠️  [Ingest] Invalid extension: ${ext}`);
    return false;
  }
  const magicBytes = buffer.slice(0, 12).toString('hex');
  const hasM4ASignature = magicBytes.includes('66747970');
  const hasAACSignature = (buffer[0] & 0xFF) === 0xFF && ((buffer[1] & 0xE0) === 0xE0);
  if (!hasM4ASignature && !hasAACSignature) {
    console.warn('⚠️  [Ingest] File does not appear to be valid AAC/M4A');
    return false;
  }
  console.log(`✅ [Ingest] File validated: ${filename}`);
  return true;
};

const extractAudioFile = async (request: NextRequest): Promise<{ filename: string; buffer: Buffer } | null> => {
  try {
    const contentType = request.headers.get('content-type');
    if (contentType?.includes('multipart/form-data')) {
      const formData = await request.formData();
      const file = formData.get('audio') as File;
      if (!file) { console.error('❌ [Ingest] No audio file in form data'); return null; }
      return { filename: file.name, buffer: Buffer.from(await file.arrayBuffer()) };
    } else if (contentType?.includes('application/octet-stream')) {
      const buffer = Buffer.from(await request.arrayBuffer());
      const filename = request.headers.get('x-filename') || `audio-${uuidv4()}.m4a`;
      return { filename, buffer };
    }
    console.error('❌ [Ingest] Unsupported content type');
    return null;
  } catch (error: unknown) {
    console.error('❌ [Ingest] Error parsing request:', error instanceof Error ? error.message : error);
    return null;
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST: Upload và đóng gói bài hát mới - REQUIRES ADMIN ROLE
// ─────────────────────────────────────────────────────────────────────────────
const getIngestEndpointUrl = (request: NextRequest): string => {
  if (process.env.APP_URL) {
    return `${process.env.APP_URL.replace(/\/$/, '')}/api/ingest/upload`;
  }
  const host = request.headers.get('host') || 'localhost';
  const proto = request.headers.get('x-forwarded-proto') || 
                (host.startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}/api/ingest/upload`;
};

// ─────────────────────────────────────────────────────────────────────────────
// POST: Upload và đóng gói bài hát mới - REQUIRES ADMIN ROLE & DPoP PROOF
// ─────────────────────────────────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  let tempFilePath: string | null = null;
  let trackId: string | null = null;

  try {
    // ── Verify admin access ──────────────────────────────────────────────
    const adminVerification = await verifyAdminAccess(request);
    if (!adminVerification.valid) {
      console.warn(`⚠️  [Ingest] Unauthorized upload attempt: ${adminVerification.error}`);
      return forbiddenResponse(adminVerification.error || 'Unauthorized');
    }

    const adminUsername = adminVerification.payload?.preferred_username || 'unknown';
    const rawAccessToken = getAdminTokenFromRequest(request);

    // ── Verify DPoP Proof ───────────────────────────────────────────────
    const dpopHeader = request.headers.get('dpop');
    if (!dpopHeader) {
      console.error('❌ [Ingest] Thiếu DPoP header');
      return NextResponse.json(
        { error: 'DPoP proof required', hint: 'Thêm header DPoP: <proof_jwt>' },
        {
          status: 401,
          headers: { 'WWW-Authenticate': 'DPoP algs="ES256"' },
        }
      );
    }

    const ingestUrl = getIngestEndpointUrl(request);
    const dpopResult = await verifyDPoPProof({
      proof: dpopHeader,
      htm: 'POST',
      htu: ingestUrl,
      accessToken: rawAccessToken || '',
    });

    if (!dpopResult.valid) {
      console.error(`❌ [Ingest] DPoP verify thất bại: ${dpopResult.error}`);
      await logAuditEvent('INGEST_FAILED', undefined, undefined, adminUsername, `DPoP: ${dpopResult.error}`);
      return NextResponse.json(
        { error: 'DPoP verification failed', detail: dpopResult.error },
        {
          status: 401,
          headers: { 'WWW-Authenticate': 'DPoP algs="ES256" error="invalid_dpop_proof"' },
        }
      );
    }

    console.log('✅ [Ingest] DPoP proof hợp lệ.');
    console.log(`📥 [Ingest] Processing audio upload by admin: ${adminUsername}...`);
    ensureUploadDir();

    const audioFile = await extractAudioFile(request);
    if (!audioFile) return NextResponse.json({ error: 'No valid audio file provided' }, { status: 400 });
    if (!validateAudioFile(audioFile.filename, audioFile.buffer))
      return NextResponse.json({ error: 'Invalid audio format. Use AAC or M4A.' }, { status: 400 });

    tempFilePath = path.join(TEMP_UPLOAD_DIR, `${uuidv4()}${path.extname(audioFile.filename)}`);
    writeFileSync(tempFilePath, audioFile.buffer);

    // ── Thorough MP4/AAC Container Validation using ffprobe ─────────────
    let mediaInfo;
    try {
      mediaInfo = await extractMediaMetadata(tempFilePath);
    } catch (e: any) {
      console.error('❌ [Ingest] FFprobe parse error:', e.message);
      if (tempFilePath) { try { unlinkSync(tempFilePath); } catch {} }
      return NextResponse.json({ error: 'Failed to parse media container. File might be corrupted.' }, { status: 400 });
    }

    const hasAudio = mediaInfo.streams?.some((s: any) => s.codec_type === 'audio');
    const hasVideo = mediaInfo.streams?.some(
      (s: any) => s.codec_type === 'video' && s.codec_name !== 'png' && s.codec_name !== 'jpeg' && s.codec_name !== 'mjpeg'
    );

    if (!hasAudio) {
      console.error('❌ [Ingest] No audio stream found');
      await logAuditEvent('PACKAGE_FAILED', undefined, undefined, adminUsername, `No audio stream: ${audioFile.filename}`);
      if (tempFilePath) { try { unlinkSync(tempFilePath); } catch {} }
      return NextResponse.json({ error: 'Invalid media: File must contain at least one audio stream.' }, { status: 400 });
    }

    if (hasVideo) {
      console.error('❌ [Ingest] Video stream found in audio upload');
      await logAuditEvent('PACKAGE_FAILED', undefined, undefined, adminUsername, `Video stream detected: ${audioFile.filename}`);
      if (tempFilePath) { try { unlinkSync(tempFilePath); } catch {} }
      return NextResponse.json({ error: 'Invalid media: Video streams are not allowed in audio uploads.' }, { status: 400 });
    }

    const sourceFormat = path.extname(audioFile.filename).slice(1).toUpperCase();
    const trackData = await createTrack(audioFile.filename, sourceFormat);
    trackId = trackData.trackId;
    const { kid, encrypted_cek } = trackData;

    let packagingResult;
    try {
      packagingResult = await encryptAndPackageMedia(tempFilePath, trackId, kid, encrypted_cek);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      await logAuditEvent('PACKAGE_FAILED', trackId, kid, adminUsername, audioFile.filename);
      throw new Error(`Packaging failed: ${message}`);
    }

    if (!packagingResult?.mpdPath || !packagingResult?.segmentDir)
      throw new Error('Invalid packaging result');

    if (packagingResult.duration) await updateTrackDuration(trackId, packagingResult.duration);
    await deactivateOldManifests(trackId);
    await saveDASHManifest(trackId, packagingResult.mpdPath);

    try { await logAuditEvent('PACKAGE_CREATED', trackId, kid, adminUsername, audioFile.filename); }
    catch { /* non-critical */ }

    try { unlinkSync(tempFilePath); } catch { }

    return NextResponse.json({
      success: true,
      message: 'Audio processed successfully',
      data: {
        trackId, kid,
        filename: audioFile.filename,
        duration: packagingResult.duration,
        mpdPath: packagingResult.mpdPath,
        segmentDir: packagingResult.segmentDir,
        bitrate: packagingResult.bitrate,
        createdAt: new Date().toISOString(),
      },
    }, { status: 201 });

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('❌ [Ingest] Error during upload:', message);
    if (trackId) await logAuditEvent('INGEST_FAILED', trackId, undefined, 'SYSTEM', message);
    if (tempFilePath) try { unlinkSync(tempFilePath); } catch { }
    return NextResponse.json(
      { error: 'Upload processing failed', details: process.env.NODE_ENV === 'development' ? message : undefined },
      { status: 500 }
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET: Hai chế độ
//   ?trackId=xxx  → trả về 1 track cụ thể (player/page.tsx dùng)
//   (không tham số) → trả về toàn bộ tracks (homepage dùng)
// ─────────────────────────────────────────────────────────────────────────────
export async function GET(request: NextRequest) {
  try {
    const trackId = request.nextUrl.searchParams.get('trackId');

    // ── Chế độ 1: Lấy 1 track theo ID ────────────────────────────────────
    if (trackId) {
      const track = await getTrackById(trackId);
      if (!track) return NextResponse.json({ error: 'Track not found' }, { status: 404 });

      const manifest = await getActiveManifest(trackId);
      return NextResponse.json({
        success: true,
        data: {
          track: {
            id: track.id,
            filename: track.filename,
            duration: track.duration ?? 0,
            kid: track.kid,
            sourceFormat: track.source_format,
            createdAt: track.created_at,
          },
          manifest: manifest ? { mpdPath: manifest.mpd_path, createdAt: manifest.created_at } : null,
        },
      });
    }

    // ── Chế độ 2: Lấy toàn bộ tracks (homepage) ──────────────────────────
    const tracks = await getAllTracks();
    return NextResponse.json({
      success: true,
      data: tracks.map(t => ({
        id: t.id,
        filename: t.filename,
        duration: t.duration ?? 0,
        kid: t.kid,
        sourceFormat: t.source_format,
        createdAt: t.created_at,
      })),
    });

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('❌ [Ingest] Error in GET:', message);
    return NextResponse.json({ error: 'Failed to retrieve track info' }, { status: 500 });
  }
}