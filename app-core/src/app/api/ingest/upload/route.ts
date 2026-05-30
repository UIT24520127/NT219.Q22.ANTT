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
import { encryptAndPackageMedia } from '@/lib/packager/packager';

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
// POST: Upload và đóng gói bài hát mới (giữ nguyên)
// ─────────────────────────────────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  let tempFilePath: string | null = null;
  let trackId: string | null = null;

  try {
    console.log('📥 [Ingest] Processing audio upload...');
    ensureUploadDir();

    const audioFile = await extractAudioFile(request);
    if (!audioFile) return NextResponse.json({ error: 'No valid audio file provided' }, { status: 400 });
    if (!validateAudioFile(audioFile.filename, audioFile.buffer))
      return NextResponse.json({ error: 'Invalid audio format. Use AAC or M4A.' }, { status: 400 });

    tempFilePath = path.join(TEMP_UPLOAD_DIR, `${uuidv4()}${path.extname(audioFile.filename)}`);
    writeFileSync(tempFilePath, audioFile.buffer);

    const sourceFormat = path.extname(audioFile.filename).slice(1).toUpperCase();
    const trackData = await createTrack(audioFile.filename, sourceFormat);
    trackId = trackData.trackId;
    const { kid, encrypted_cek } = trackData;

    let packagingResult;
    try {
      packagingResult = await encryptAndPackageMedia(tempFilePath, trackId, kid, encrypted_cek);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      await logAuditEvent('PACKAGE_FAILED', trackId, kid, 'SYSTEM', audioFile.filename);
      throw new Error(`Packaging failed: ${message}`);
    }

    if (!packagingResult?.mpdPath || !packagingResult?.segmentDir)
      throw new Error('Invalid packaging result');

    if (packagingResult.duration) await updateTrackDuration(trackId, packagingResult.duration);
    await deactivateOldManifests(trackId);
    await saveDASHManifest(trackId, packagingResult.mpdPath);

    try { await logAuditEvent('PACKAGE_CREATED', trackId, kid, 'SYSTEM', audioFile.filename); }
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