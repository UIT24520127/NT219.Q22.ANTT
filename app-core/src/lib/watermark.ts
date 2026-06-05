import { execFile } from 'child_process';
import { promisify } from 'util';
import { existsSync, mkdirSync } from 'fs';
import path from 'path';

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(__dirname, '../../../');
const WATERMARK_SCRIPT_PATH = path.join(repoRoot, 'security', 'watermark', 'watermark.sh');
const WATERMARK_ENABLED = process.env.WATERMARK_ENABLED !== 'false' && process.env.WATERMARK_ENABLED !== '0';
const WATERMARK_FREQUENCY = process.env.WATERMARK_FREQUENCY || '19000';
const WATERMARK_AMPLITUDE = process.env.WATERMARK_AMPLITUDE || '0.0005';
const WATERMARK_CODEC = process.env.WATERMARK_CODEC || 'aac';
const WATERMARK_BITRATE = process.env.WATERMARK_BITRATE || '192k';
const WATERMARK_TIMEOUT_MS = parseInt(process.env.WATERMARK_TIMEOUT_MS || '120000', 10);

const ensureDirectoryExists = (filePath: string) => {
  const dir = path.dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
};

export const isWatermarkEnabled = (): boolean => WATERMARK_ENABLED;

export const applyAudioWatermark = async (inputPath: string, outputPath: string): Promise<string> => {
  if (!WATERMARK_ENABLED) return inputPath;
  if (!existsSync(inputPath)) {
    throw new Error(`[Watermark] Input file does not exist: ${inputPath}`);
  }

  ensureDirectoryExists(outputPath);

  try {
    await execFileAsync('bash', [WATERMARK_SCRIPT_PATH, inputPath, outputPath, WATERMARK_FREQUENCY, WATERMARK_AMPLITUDE, WATERMARK_CODEC, WATERMARK_BITRATE], {
      timeout: WATERMARK_TIMEOUT_MS,
    });
    console.log(`✅ [Watermark] Applied watermark to ${outputPath}`);
    return outputPath;
  } catch (error: any) {
    throw new Error(`[Watermark] Failed to apply audio watermark: ${error.stderr || error.message}`);
  }
};
