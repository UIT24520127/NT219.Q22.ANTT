import { execFile } from 'child_process';
import { promisify } from 'util';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { kmsService } from '../kms/bao';
import { r2Service } from '../storage/r2';
import type { PackagingResult } from '../types';

const execFileAsync = promisify(execFile);

// Cấu hình đường dẫn output
const AUDIO_SEGMENTS_DIR = process.env.AUDIO_SEGMENTS_DIR || '/audio/segments';
const AUDIO_MANIFESTS_DIR = process.env.AUDIO_MANIFESTS_DIR || '/audio/manifests';
const AUDIO_METADATA_DIR = process.env.AUDIO_METADATA_DIR || '/audio/metadata';

const ensureDirectories = () => {
  const dirs = [AUDIO_SEGMENTS_DIR, AUDIO_MANIFESTS_DIR, AUDIO_METADATA_DIR];
  dirs.forEach(dir => {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
      console.log(`📁 [Packager] Created directory: ${dir}`);
    }
  });
};

const decryptCEKForPackaging = async (encryptedCek: string): Promise<string> => {
  try {
    const plaintext = await kmsService.decryptKey(encryptedCek);
    if (plaintext.length === 32 && /^[0-9a-f]+$/.test(plaintext)) {
      return plaintext;
    }
    throw new Error('CEK not in valid hex format');
  } catch (error: any) {
    console.error('❌ [Packager] Failed to decrypt CEK:', error.message);
    throw new Error('CEK Decryption Failed');
  }
};

const getFFprobePath = (): string => {
  try {
    const os = require('os');
    const platform = os.platform();
    const arch = os.arch();
    const binaryName = platform === 'win32' ? 'ffprobe.exe' : 'ffprobe';
    
    const localPath = path.join(process.cwd(), 'node_modules/ffprobe-static/bin', platform, arch, binaryName);
    if (existsSync(localPath)) {
      return localPath;
    }

    const indexPath = require.resolve('ffprobe-static');
    const packageDir = path.dirname(indexPath);
    const resolvedPath = path.join(packageDir, 'bin', platform, arch, binaryName);
    if (existsSync(resolvedPath)) {
      return resolvedPath;
    }
  } catch (e) {
    console.warn('⚠️ [Packager] Failed to resolve ffprobe-static path:', e);
  }

  try {
    const ffprobe = require('ffprobe-static');
    if (ffprobe.path && existsSync(ffprobe.path)) {
      return ffprobe.path;
    }
  } catch (_) {}

  return 'ffprobe';
};

const extractMediaMetadata = async (inputPath: string) => {
  try {
    const ffprobePath = getFFprobePath();
    console.log(`📊 [Packager] Using ffprobe binary at: ${ffprobePath}`);
    const { stdout } = await execFileAsync(ffprobePath, [
      '-v', 'error',
      '-show_format',
      '-show_streams',
      '-print_format', 'json',
      inputPath
    ]);
    return JSON.parse(stdout);
  } catch (error: any) {
    console.error('❌ [Packager] ffprobe error:', error.message);
    throw new Error('Failed to extract media metadata');
  }
};

export const encryptAndPackageMedia = async (
  inputPath: string,
  trackId: string,
  kid: string,
  encryptedCek: string
): Promise<PackagingResult> => {
  try {
    ensureDirectories();

    console.log(`📦 [Packager] Starting packaging for track: ${trackId}`);
    console.log(`🔑 [Packager] KID: ${kid}`);

    const mediaInfo = await extractMediaMetadata(inputPath);
    const duration = Math.ceil(parseFloat(mediaInfo.format.duration || '0'));
    const bitrate = mediaInfo.format.bit_rate || '128000';

    console.log(`⏱️  [Packager] Duration: ${duration}s, Bitrate: ${bitrate}bps`);

    console.log('🔓 [Packager] Decrypting CEK...');
    const plaintextCek = await decryptCEKForPackaging(encryptedCek);

    const outputDir = path.join(AUDIO_SEGMENTS_DIR, trackId);
    const mpdPath = path.join(AUDIO_MANIFESTS_DIR, `${trackId}.mpd`);
    const metadataPath = path.join(AUDIO_METADATA_DIR, `${trackId}.json`);

    if (!existsSync(outputDir)) {
      mkdirSync(outputDir, { recursive: true });
    }

    // ============================================================
    // SỬA ĐỔI CHÍNH: TẠO NHIỀU SEGMENT THAY VÌ 1 FILE DUY NHẤT
    // ============================================================
    const initSegmentPath = path.join(outputDir, 'init.mp4');
    const segmentTemplate = path.join(outputDir, 'segment_$Number$.m4s');

    const packagerArgs = [
      `input=${inputPath},stream=audio,init_segment=${initSegmentPath},segment_template=${segmentTemplate},drm_label=audio`,
      '--enable_raw_key_encryption',
      '--keys', `label=audio:key_id=${kid}:key=${plaintextCek}`,
      '--protection_systems', 'Widevine',
      '--segment_duration', '10',
      `--mpd_output=${mpdPath}`,
      '--generate_static_live_mpd'
    ];
    // ============================================================

    console.log('🚀 [Packager] Executing Shaka Packager...');
    console.log(`Command: packager ${packagerArgs.join(' ')}`);

    try {
      const { stdout, stderr } = await execFileAsync('packager', packagerArgs);
      if (stderr) console.log('⚠️  [Packager] stderr:', stderr);
      console.log('✅ [Packager] Shaka Packager completed successfully');
    } catch (error: any) {
      if (error.stderr && error.stderr.toUpperCase().includes('ERROR')) {
        console.error('❌ [Packager] Fatal error:', error.stderr);
        throw error;
      }
      console.log('⚠️  [Packager] Packager returned non-zero code but may have succeeded');
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    if (!existsSync(mpdPath)) {
      throw new Error(`MPD file not created at ${mpdPath}`);
    }

    console.log('📋 [Packager] Verifying MPD structure...');
    const mpdContent = readFileSync(mpdPath, 'utf-8');
    
    if (!mpdContent.includes('ContentProtection')) {
      console.warn('⚠️  [Packager] Warning: MPD does not contain ContentProtection element');
    }

    const metadata = {
      trackId,
      kid,
      filename: path.basename(inputPath),
      duration,
      bitrate,
      mpdPath,
      segmentDir: outputDir,
      createdAt: new Date().toISOString(),
    };

    writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
    console.log(`💾 [Packager] Metadata saved to ${metadataPath}`);

    // Upload lên R2
    console.log('📤 [Packager] Uploading to Cloudflare R2...');
    try {
      const r2Prefix = `audio/${trackId}/`;
      
      await r2Service.uploadFile(
        mpdPath,
        `${r2Prefix}manifest.mpd`,
        'application/dash+xml'
      );

      await r2Service.uploadDirectory(
        outputDir,
        r2Prefix,
        ['.mp4', '.m4s', '.init']
      );

      console.log(`✅ [Packager] All files uploaded to R2 successfully`);
    } catch (error: any) {
      console.error('❌ [Packager] R2 upload failed:', error.message);
      throw new Error(`R2 Upload Failed: ${error.message}`);
    }

    console.log(`✨ [Packager] Packaging complete! MPD: ${mpdPath}`);

    return {
      success: true,
      trackId,
      kid,
      mpdPath,
      segmentDir: outputDir,
      metadataPath,
      duration,
      bitrate,
      message: 'Package created and uploaded to R2 successfully'
    };
  } catch (error: any) {
    console.error('❌ [Packager] Packaging failed:', error.message);
    throw error;
  }
};