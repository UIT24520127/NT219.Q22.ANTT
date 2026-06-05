import { execFile } from 'child_process';
import { promisify } from 'util';
import { existsSync, mkdirSync, writeFileSync, unlinkSync } from 'fs';
import path from 'path';
import { kmsService } from '../kms/bao';
import { r2Service } from '../storage/r2';
import { applyAudioWatermark } from '../watermark';
import type { PackagingResult } from '../types';

const execFileAsync = promisify(execFile);

// ─── Thư mục output ────────────────────────────────────────────────────────
// Production: mount volume bên ngoài container
// Dev: fallback về public/audio/segments (phục vụ static file luôn)
const AUDIO_SEGMENTS_DIR = process.env.AUDIO_SEGMENTS_DIR || 'public/audio/segments';
const AUDIO_METADATA_DIR = process.env.AUDIO_METADATA_DIR || 'tmp/audio/metadata';

const ensureDirectories = (dirs: string[]) => {
  for (const dir of dirs) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
      console.log(`📁 [Packager] Created: ${dir}`);
    }
  }
};

/**
 * Giải mã CEK từ KMS và validate format 32-char hex.
 * Ném lỗi rõ ràng thay vì để Shaka Packager crash với exit-code mơ hồ.
 */
const decryptCEKForPackaging = async (encryptedCek: string): Promise<string> => {
  const plaintext = (await kmsService.decryptKey(encryptedCek)).trim();
  if (!/^[0-9a-f]{32}$/i.test(plaintext)) {
    throw new Error(`[Packager] CEK sau giải mã không hợp lệ: độ dài ${plaintext.length}, phải là 32-char hex`);
  }
  return plaintext;
};

/** Resolve ffprobe — ưu tiên ffprobe-static nếu có, fallback PATH */
const getFFprobePath = (): string => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const f = require('ffprobe-static');
    if (f?.path && existsSync(f.path)) return f.path;
  } catch {
    // ffprobe-static không được cài — dùng system ffprobe
  }
  return 'ffprobe';
};

const extractMediaMetadata = async (inputPath: string) => {
  const { stdout } = await execFileAsync(getFFprobePath(), [
    '-v', 'error',
    '-show_format', '-show_streams',
    '-print_format', 'json',
    inputPath,
  ]);
  return JSON.parse(stdout);
};

// ─── Packager timeout: production cần thời gian dài hơn cho file lớn ────────
const PACKAGER_TIMEOUT_MS = parseInt(process.env.PACKAGER_TIMEOUT_MS || '300000', 10); // 5 phút

export const encryptAndPackageMedia = async (
  inputPath: string,
  trackId: string,
  kid: string,
  encryptedCek: string,
): Promise<PackagingResult> => {
  const outputDir    = path.join(AUDIO_SEGMENTS_DIR, trackId);
  const metadataPath = path.join(AUDIO_METADATA_DIR, `${trackId}.json`);
  ensureDirectories([outputDir, AUDIO_METADATA_DIR]);

  console.log(`📦 [Packager] START trackId=${trackId} KID=${kid}`);

  const mediaInfo = await extractMediaMetadata(inputPath);
  const duration  = Math.ceil(parseFloat(mediaInfo.format?.duration ?? '0'));
  const bitrate   = mediaInfo.format?.bit_rate ?? '128000';

  // Giải mã CEK trước khi gọi Shaka — fail sớm nếu KMS lỗi
  const plaintextCek = await decryptCEKForPackaging(encryptedCek);

  const watermarkedInputPath = path.join(
    path.dirname(inputPath),
    `${path.basename(inputPath, path.extname(inputPath))}.watermarked${path.extname(inputPath)}`,
  );
  const packagingInputPath = await applyAudioWatermark(inputPath, watermarkedInputPath, trackId);

  const initSegmentPath = path.join(outputDir, 'init.mp4');
  const segmentTemplate = path.join(outputDir, 'segment_$Number$.m4s');
  const mpdPath         = path.join(outputDir, 'manifest.mpd');

  const packagerArgs = [
    `input=${packagingInputPath},stream=audio,init_segment=${initSegmentPath},segment_template=${segmentTemplate},drm_label=audio`,
    '--enable_raw_key_encryption',
    '--keys',              `label=audio:key_id=${kid}:key=${plaintextCek}`,
    '--protection_systems', 'Common',   // ClearKey — không cần Widevine CDM
    '--clear_lead',         '0',
    '--segment_duration',   '10',
    `--mpd_output=${mpdPath}`,
    '--generate_static_live_mpd',
  ];

  console.log('🚀 [Packager] Running Shaka Packager...');

  try {
    const { stderr } = await execFileAsync('packager', packagerArgs, {
      timeout: PACKAGER_TIMEOUT_MS,
    });
    // Shaka viết progress log ra stderr — chỉ warn nếu có chữ ERROR
    if (stderr && /error/i.test(stderr)) {
      console.warn('⚠️  [Packager] stderr:', stderr);
    }
  } catch (error: any) {
    // execFileAsync ném lỗi cả khi exit code != 0 lẫn timeout
    const isRealError = error.killed /* timeout */ || error.stderr?.toUpperCase().includes('ERROR');
    if (isRealError) {
      throw new Error(`[Packager] Shaka failed: ${error.stderr ?? error.message}`);
    }
    // Exit code != 0 nhưng không có ERROR text → Shaka vẫn tạo file được (known quirk)
    console.warn('⚠️  [Packager] Non-zero exit, kiểm tra MPD...');
    await new Promise(r => setTimeout(r, 1_000));
  }

  if (!existsSync(mpdPath)) {
    throw new Error(`[Packager] MPD không được tạo tại ${mpdPath}`);
  }

  if (packagingInputPath !== inputPath && existsSync(packagingInputPath)) {
    try { unlinkSync(packagingInputPath); } catch { }
  }

  // Lưu metadata nội bộ
  writeFileSync(
    metadataPath,
    JSON.stringify({ trackId, kid, duration, bitrate, mpdPath, outputDir, createdAt: new Date().toISOString() }, null, 2),
  );

  // Upload R2
  console.log('📤 [Packager] Uploading to R2...');
  const r2Prefix = `audio/${trackId}/`;
  await r2Service.uploadFile(mpdPath, `${r2Prefix}manifest.mpd`, 'application/dash+xml');
  await r2Service.uploadDirectory(outputDir, r2Prefix, ['.mp4', '.m4s']);
  console.log('✅ [Packager] R2 upload complete');

  return {
    success: true,
    trackId,
    kid,
    mpdPath,
    segmentDir: outputDir,
    metadataPath,
    duration,
    bitrate,
    message: 'Done',
  };
};