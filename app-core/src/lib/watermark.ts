import { execFile } from 'child_process';
import { promisify } from 'util';
import { existsSync, mkdirSync, unlinkSync } from 'fs';
import path from 'path';

const execFileAsync = promisify(execFile);

const WATERMARK_ENABLED = process.env.WATERMARK_ENABLED !== 'false' && process.env.WATERMARK_ENABLED !== '0';
const WATERMARK_TIMEOUT_MS = parseInt(process.env.WATERMARK_TIMEOUT_MS || '120000', 10);

export const isWatermarkEnabled = (): boolean => WATERMARK_ENABLED;

/**
 * UUID trackId → 32-char hex (128-bit audiowmark payload).
 * audiowmark embed payload này vào audio; dùng "audiowmark get" để đọc lại.
 */
function trackIdToPayload(trackId: string): string {
  return trackId.replace(/-/g, '').toLowerCase().padEnd(32, '0').slice(0, 32);
}

function ensureDir(filePath: string) {
  const dir = path.dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function removeSilently(filePath: string) {
  try { if (existsSync(filePath)) unlinkSync(filePath); } catch { /* non-critical */ }
}

/** ffmpeg: decode bất kỳ format → PCM WAV 44100Hz stereo */
async function toWav(inputPath: string, wavPath: string): Promise<void> {
  await execFileAsync('ffmpeg', [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-i', inputPath,
    '-ar', '44100', '-ac', '2',
    wavPath,
  ], { timeout: WATERMARK_TIMEOUT_MS });
}

/** ffmpeg: WAV → AAC/M4A (giữ nguyên extension của outputPath) */
async function fromWav(wavPath: string, outputPath: string): Promise<void> {
  await execFileAsync('ffmpeg', [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-i', wavPath,
    '-c:a', 'aac', '-b:a', '192k',
    '-movflags', '+faststart',
    outputPath,
  ], { timeout: WATERMARK_TIMEOUT_MS });
}

/**
 * Nhúng watermark vào audio bằng audiowmark (spread-spectrum).
 *
 * Flow:  inputPath (.m4a)
 *          → ffmpeg decode → tmpIn.wav
 *          → audiowmark add  → tmpOut.wav   (payload = trackId 128-bit)
 *          → ffmpeg encode  → outputPath (.m4a)
 *
 * Trả về outputPath nếu thành công, inputPath nếu watermark bị tắt.
 * Các file WAV trung gian được xóa dù thành công hay lỗi.
 */
export async function applyAudioWatermark(
  inputPath:  string,
  outputPath: string,
  trackId?:   string,
): Promise<string> {
  if (!WATERMARK_ENABLED) return inputPath;
  if (!existsSync(inputPath)) {
    throw new Error(`[Watermark] Input file not found: ${inputPath}`);
  }

  ensureDir(outputPath);

  const dir    = path.dirname(inputPath);
  const stem   = path.basename(inputPath, path.extname(inputPath));
  const tmpIn  = path.join(dir, `${stem}_wm_in.wav`);
  const tmpOut = path.join(dir, `${stem}_wm_out.wav`);

  const payload = trackId ? trackIdToPayload(trackId) : '0'.repeat(32);

  try {
    // 1. Decode → WAV
    await toWav(inputPath, tmpIn);

    // 2. audiowmark spread-spectrum embed
    await execFileAsync('audiowmark', ['add', tmpIn, tmpOut, payload], {
      timeout: WATERMARK_TIMEOUT_MS,
    });

    // 3. Re-encode → AAC/M4A
    await fromWav(tmpOut, outputPath);

    console.log(`✅ [Watermark] audiowmark OK  payload=${payload}  out=${outputPath}`);
    return outputPath;

  } catch (err: any) {
    throw new Error(`[Watermark] Failed: ${err.stderr ?? err.message}`);
  } finally {
    removeSilently(tmpIn);
    removeSilently(tmpOut);
  }
}
