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

// Widevine configuration
const WIDEVINE_PROVIDER_URL = process.env.WIDEVINE_PROVIDER_URL || 'https://license.widevine.com/cenc/getcontentkey/widevine_test';

/**
 * Ensure output directories exist and are writable
 */
const ensureDirectories = () => {
  const dirs = [AUDIO_SEGMENTS_DIR, AUDIO_MANIFESTS_DIR, AUDIO_METADATA_DIR];
  dirs.forEach(dir => {
    if (!existsSync(dir)) {
      try {
        mkdirSync(dir, { recursive: true });
        console.log(`📁 [Packager] Created directory: ${dir}`);
      } catch (error: any) {
        throw new Error(`Failed to create directory ${dir}: ${error.message}`);
      }
    }
    // Verify directory is writable
    try {
      // Try to create a test file
      const testFile = path.join(dir, '.writetest');
      writeFileSync(testFile, '');
      require('fs').unlinkSync(testFile);
    } catch (error: any) {
      throw new Error(`Directory ${dir} is not writable: ${error.message}`);
    }
  });
};

/**
 * Decrypt CEK in-memory for Shaka Packager invocation
 * @param encryptedCek Ciphertext from OpenBao (vault:v1:...)
 * @returns Plaintext CEK in hex format
 */
const decryptCEKForPackaging = async (encryptedCek: string): Promise<string> => {
  try {
    const plaintext = await kmsService.decryptKey(encryptedCek);
    // Ensure it's in hex format (32 characters for 128-bit AES key)
    if (plaintext.length === 32 && /^[0-9a-f]+$/.test(plaintext)) {
      return plaintext;
    }
    throw new Error('CEK not in valid hex format');
  } catch (error: any) {
    console.error('❌ [Packager] Failed to decrypt CEK:', error.message);
    throw new Error('CEK Decryption Failed');
  }
};

/**
 * Try to resolve ffprobe path inside Next.js bundled environment robustly
 */
const getFFprobePath = (): string => {
  try {
    const os = require('os');
    const platform = os.platform();
    const arch = os.arch();
    const binaryName = platform === 'win32' ? 'ffprobe.exe' : 'ffprobe';
    
    // Attempt 1: Resolve relative to process.cwd() (Next.js project root)
    const localPath = path.join(process.cwd(), 'node_modules/ffprobe-static/bin', platform, arch, binaryName);
    if (existsSync(localPath)) {
      return localPath;
    }

    // Attempt 2: Use require.resolve to find package location
    const indexPath = require.resolve('ffprobe-static');
    const packageDir = path.dirname(indexPath);
    const resolvedPath = path.join(packageDir, 'bin', platform, arch, binaryName);
    if (existsSync(resolvedPath)) {
      return resolvedPath;
    }
  } catch (e) {
    console.warn('⚠️ [Packager] Failed to resolve ffprobe-static path dynamically:', e);
  }

  // Attempt 3: Standard import fallback
  try {
    const ffprobe = require('ffprobe-static');
    if (ffprobe.path && existsSync(ffprobe.path)) {
      return ffprobe.path;
    }
  } catch (_) {}

  // Attempt 4: System-wide PATH command
  return 'ffprobe';
};

/**
 * Extract audio metadata using ffprobe
 * @param inputPath Path to input audio file
 */
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

/**
 * Main packaging function: encrypt audio with Shaka Packager and generate DASH/MPD
 * @param inputPath Full path to input AAC/M4A file
 * @param trackId Unique track identifier (UUID)
 * @param kid Key ID (16 bytes hex string)
 * @param encryptedCek Encrypted CEK from OpenBao (vault:v1:...)
 * @returns PackagingResult object with paths to generated MPD and segments
 */
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

    // Step 1: Extract media metadata
    console.log('📊 [Packager] Extracting media metadata...');
    const mediaInfo = await extractMediaMetadata(inputPath);
    const duration = Math.ceil(parseFloat(mediaInfo.format.duration || '0'));
    const bitrate = mediaInfo.format.bit_rate || '128000';

    console.log(`⏱️  [Packager] Duration: ${duration}s, Bitrate: ${bitrate}bps`);

    // Step 2: Decrypt CEK for packaging
    console.log('🔓 [Packager] Decrypting CEK...');
    const plaintextCek = await decryptCEKForPackaging(encryptedCek);

    // Step 3: Prepare output paths
    const outputDir = path.join(AUDIO_SEGMENTS_DIR, trackId);
    const mpdPath = path.join(AUDIO_MANIFESTS_DIR, `${trackId}.mpd`);
    const metadataPath = path.join(AUDIO_METADATA_DIR, `${trackId}.json`);

    if (!existsSync(outputDir)) {
      mkdirSync(outputDir, { recursive: true });
    }

    // Step 4: Build Shaka Packager command
    // Format: packager input=<file>,stream=audio,output=<output.mp4>,drm_label=<label>
    //         --enable_widevine_encryption
    //         --key_server_url=<url>
    //         --encryption_key=<kid>:<key>
    //         --mpd_output=<mpd>

    const packagerArgs = [
      `input=${inputPath},stream=audio,output=${path.join(outputDir, 'segment.mp4')},drm_label=audio`,
      '--enable_raw_key_encryption',
      '--keys', `label=audio:key_id=${kid}:key=${plaintextCek}`,
      '--protection_systems', 'Widevine',
      `--mpd_output=${mpdPath}`,
      '--generate_static_live_mpd'
    ];

    console.log('🚀 [Packager] Executing Shaka Packager...');
    console.log(`Command: packager ${packagerArgs.join(' ')}`);

    // Execute Shaka Packager using execFile to avoid shell injection
    try {
      console.log('🚀 [Packager] Running Shaka Packager commands...');
      const { stdout, stderr } = await execFileAsync('packager', packagerArgs);
      
      if (stderr) console.log('⚠️  [Packager] stderr:', stderr);
      console.log('✅ [Packager] Shaka Packager completed successfully');
    } catch (error: any) {
      // BẮT LỖI THỰC SỰ: Chỉ chặn luồng nếu trong log của Shaka Packager chứa chữ "ERROR" nặng
      if (error.stderr && error.stderr.toUpperCase().includes('ERROR')) {
        console.error('❌ [Packager] Shaka Packager encountered a fatal error:', error.stderr);
        throw error; // Ném lỗi ra ngoài để dừng API
      }
      
      // NẾU CHỈ LÀ WARNING (Thoát mã > 0 trên Windows nhưng file vẫn đang ghi ngầm):
      console.log('⚠️  [Packager] Packager returned a non-zero code (Warning), checking file generation...');
      
      // TẠO ĐỘ TRỄ MẠNG (DELAY) 1 GIÂY: Ép Windows hoàn tất việc ghi file .mpd xuống đĩa cứng trước khi check
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    // Step 5: Verify MPD file was created
    if (!existsSync(mpdPath)) {
      throw new Error(`MPD file not created at ${mpdPath}`);
    }

    // Step 6: Read and parse MPD to verify KID
    console.log('📋 [Packager] Verifying MPD structure...');
    const mpdContent = readFileSync(mpdPath, 'utf-8');
    
    if (!mpdContent.includes('ContentProtection')) {
      console.warn('⚠️  [Packager] Warning: MPD does not contain ContentProtection element');
    }

    if (!mpdContent.includes(kid)) {
      console.warn(`⚠️  [Packager] Warning: KID ${kid} not found in MPD. This may need manual PSSH adjustment.`);
    }

    // Step 7: Save metadata for future reference
    const metadata = {
      trackId,
      kid,
      filename: path.basename(inputPath),
      duration,
      bitrate,
      mpdPath,
      segmentDir: outputDir,
      createdAt: new Date().toISOString(),
      mpdPreview: mpdContent.substring(0, 500) + '...' // First 500 chars for debugging
    };

    writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
    console.log(`💾 [Packager] Metadata saved to ${metadataPath}`);

    // Step 8: Upload packaging results to Cloudflare R2 (secure storage)
    console.log('📤 [Packager] Uploading packaged files to Cloudflare R2...');
    try {
      const r2Prefix = `audio/${trackId}/`;
      
      // Upload MPD manifest
      await r2Service.uploadFile(
        mpdPath,
        `${r2Prefix}manifest.mpd`,
        'application/dash+xml'
      );

      // Upload all segment files from output directory
      await r2Service.uploadDirectory(
        outputDir,
        r2Prefix,
        ['.mp4', '.m4s', '.init'] // Include all segment file types
      );

      console.log(`✅ [Packager] All files uploaded to R2 successfully`);
    } catch (error: any) {
      console.error('❌ [Packager] R2 upload failed:', error.message);
      console.error('⚠️  [Packager] Files are still available locally but NOT uploaded to secure storage');
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
