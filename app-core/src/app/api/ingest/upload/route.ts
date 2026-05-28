import { NextRequest, NextResponse } from 'next/server';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { createTrack, getTrackById, getActiveManifest, updateTrackDuration, saveDASHManifest, deactivateOldManifests, logAuditEvent } from '@/lib/track-db';
import { unlinkSync } from 'fs';
import { encryptAndPackageMedia } from '@/lib/packager/packager';

// Temporary upload directory (cleaned after packaging)
const TEMP_UPLOAD_DIR = process.env.TEMP_UPLOAD_DIR || '/tmp/audio-uploads';

/**
 * Ensure upload directory exists
 */
const ensureUploadDir = () => {
  if (!existsSync(TEMP_UPLOAD_DIR)) {
    mkdirSync(TEMP_UPLOAD_DIR, { recursive: true });
  }
};

/**
 * Validate audio file format
 * @param filename Name of the file
 * @param buffer File content buffer
 */
const validateAudioFile = (filename: string, buffer: Buffer): boolean => {
  const ext = path.extname(filename).toLowerCase();
  
  // Check extension
  if (!['.m4a', '.aac', '.mp4'].includes(ext)) {
    console.warn(`⚠️  [Ingest] Invalid extension: ${ext}`);
    return false;
  }

  // Check magic bytes for AAC/M4A
  // M4A/MP4 has 'ftyp' at bytes 4-7
  // AAC starts with 0xFFE or 0xFFF (syncword)
  const magicBytes = buffer.slice(0, 12).toString('hex');
  const hasM4ASignature = magicBytes.includes('66747970'); // 'ftyp' in hex ('66747970')
  const hasAACSignature = (buffer[0] & 0xFF) === 0xFF && ((buffer[1] & 0xE0) === 0xE0);

  if (!hasM4ASignature && !hasAACSignature) {
    console.warn('⚠️  [Ingest] File does not appear to be valid AAC/M4A');
    return false;
  }

  console.log(`✅ [Ingest] File validated: ${filename}`);
  return true;
};

/**
 * Parse FormData to extract file
 * @param request Next.js request object
 */
const extractAudioFile = async (request: NextRequest): Promise<{ filename: string; buffer: Buffer } | null> => {
  try {
    const contentType = request.headers.get('content-type');
    
    if (contentType?.includes('multipart/form-data')) {
      const formData = await request.formData();
      const file = formData.get('audio') as File;
      
      if (!file) {
        console.error('❌ [Ingest] No audio file provided in form data');
        return null;
      }

      const buffer = Buffer.from(await file.arrayBuffer());
      return {
        filename: file.name,
        buffer
      };
    } else if (contentType?.includes('application/octet-stream')) {
      // Raw file upload
      const buffer = Buffer.from(await request.arrayBuffer());
      const filename = request.headers.get('x-filename') || `audio-${uuidv4()}.m4a`;
      return {
        filename,
        buffer
      };
    }

    console.error('❌ [Ingest] Unsupported content type');
    return null;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';

    console.error('❌ [Ingest] Error parsing request:', message);
    return null;
  }
};

export async function POST(request: NextRequest) {
  let tempFilePath: string | null = null;
  let trackId: string | null = null;

  try {
    console.log('📥 [Ingest] Processing audio upload...');
    ensureUploadDir();

    // Step 1: Extract and validate audio file
    const audioFile = await extractAudioFile(request);
    if (!audioFile) {
      return NextResponse.json(
        { error: 'No valid audio file provided' },
        { status: 400 }
      );
    }

    if (!validateAudioFile(audioFile.filename, audioFile.buffer)) {
      return NextResponse.json(
        { error: 'Invalid audio file format. Please upload AAC or M4A.' },
        { status: 400 }
      );
    }

    // Step 2: Save to temporary location
    tempFilePath = path.join(TEMP_UPLOAD_DIR, `${uuidv4()}${path.extname(audioFile.filename)}`);
    writeFileSync(tempFilePath, audioFile.buffer);
    console.log(`💾 [Ingest] Temporary file saved: ${tempFilePath}`);

    // Step 3: Create track record in database with encrypted CEK
    const sourceFormat = path.extname(audioFile.filename).slice(1).toUpperCase();
    console.log(`📝 [Ingest] Creating track record for ${audioFile.filename}...`);
    
    const trackData = await createTrack(audioFile.filename, sourceFormat);
    trackId = trackData.trackId;
    const kid = trackData.kid;
    const encrypted_cek = trackData.encrypted_cek;

    console.log(`✅ [Ingest] Track created: ${trackId}`);
    console.log(`🔑 [Ingest] Generated KID: ${kid}`);

    // Step 4: Call Shaka Packager to encrypt and generate DASH package
    console.log('🚀 [Ingest] Starting DASH packaging...');
    
    let packagingResult;
    try {
      packagingResult = await encryptAndPackageMedia(
        tempFilePath,
        trackId,
        kid,
        encrypted_cek
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('❌ [Ingest] Packaging failed:', message);
      await logAuditEvent('PACKAGE_FAILED', trackId, kid, 'SYSTEM', audioFile.filename);
      throw new Error(`Packaging failed: ${message}`);
    }

    // Step 5: Validate packaging result
    if (!packagingResult || !packagingResult.mpdPath || !packagingResult.segmentDir) {
      throw new Error('Invalid packaging result: missing required properties');
    }

    // Step 6: Update track with duration from packaging result
    if (packagingResult.duration) {
      await updateTrackDuration(trackId, packagingResult.duration);
    }

    // Step 7: Deactivate old manifests and save new one
    await deactivateOldManifests(trackId);
    await saveDASHManifest(trackId, packagingResult.mpdPath);

    // Step 8: Log success (error handled gracefully)
    try {
      await logAuditEvent('PACKAGE_CREATED', trackId, kid, 'SYSTEM', audioFile.filename);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.warn('⚠️  [Ingest] Audit logging failed:', message);
      // Don't fail the upload due to logging issues
    }

    // Step 9: Cleanup temporary file
    try {
      unlinkSync(tempFilePath);
      console.log(`🧹 [Ingest] Temporary file cleaned up`);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error";
      console.warn(`⚠️  [Ingest] Could not delete temporary file: ${message}`);
    }

    // Step 10: Return success response
    console.log(`✨ [Ingest] Upload and packaging complete for track ${trackId}`);
    
    return NextResponse.json({
      success: true,
      message: 'Audio processed successfully',
      data: {
        trackId,
        kid,
        filename: audioFile.filename,
        duration: packagingResult.duration,
        mpdPath: packagingResult.mpdPath,
        segmentDir: packagingResult.segmentDir,
        bitrate: packagingResult.bitrate,
        createdAt: new Date().toISOString()
      }
    }, { status: 201 });

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error('❌ [Ingest] Error during upload:', message);

    // Log failure
    if (trackId) {
      await logAuditEvent('INGEST_FAILED', trackId, undefined, 'SYSTEM', message);
    }

    // Cleanup temporary file if it exists
    if (tempFilePath) {
      try {
        unlinkSync(tempFilePath);
      } catch (_) {}
    }

    return NextResponse.json(
      {
        error: 'Upload processing failed',
        details: message
      },
      { status: 500 }
    );
  }
}

/**
 * GET endpoint to check upload status and retrieve track info
 */
export async function GET(request: NextRequest) {
  try {
    const trackId = request.nextUrl.searchParams.get('trackId');

    if (!trackId) {
      return NextResponse.json(
        { error: 'trackId parameter required' },
        { status: 400 }
      );
    }

    const track = await getTrackById(trackId);
    if (!track) {
      return NextResponse.json(
        { error: 'Track not found' },
        { status: 404 }
      );
    }

    const manifest = await getActiveManifest(trackId);

    return NextResponse.json({
      success: true,
      data: {
        track: {
          id: track.id,
          filename: track.filename,
          duration: track.duration,
          kid: track.kid,
          sourceFormat: track.source_format,
          createdAt: track.created_at
        },
        manifest: manifest ? {
          mpdPath: manifest.mpd_path,
          createdAt: manifest.created_at
        } : null
      }
    });

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error('❌ [Ingest] Error retrieving track:', message);
    return NextResponse.json(
      { error: 'Failed to retrieve track info' },
      { status: 500 }
    );
  }
}
