import { execFile } from 'child_process';
import { promisify } from 'util';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { kmsService } from '../kms/bao';
import { r2Service } from '../storage/r2';
import type { PackagingResult } from '../types';

const execFileAsync = promisify(execFile);

const AUDIO_SEGMENTS_DIR = process.env.AUDIO_SEGMENTS_DIR || 'public/audio/segments';
const AUDIO_METADATA_DIR = process.env.AUDIO_METADATA_DIR || 'tmp/audio/metadata';

const ensureDirectories = (dirs: string[]) => {
  dirs.forEach(dir => {
    if (!existsSync(dir)) { mkdirSync(dir, { recursive: true }); console.log(`📁 [Packager] Created: ${dir}`); }
  });
};

const decryptCEKForPackaging = async (encryptedCek: string): Promise<string> => {
  const plaintext = (await kmsService.decryptKey(encryptedCek)).trim();
  if (plaintext.length === 32 && /^[0-9a-f]+$/i.test(plaintext)) return plaintext;
  throw new Error('CEK not valid 32-char hex');
};

const getFFprobePath = (): string => {
  try { const f = require('ffprobe-static'); if (f.path && existsSync(f.path)) return f.path; } catch {}
  return 'ffprobe';
};

const extractMediaMetadata = async (inputPath: string) => {
  const { stdout } = await execFileAsync(getFFprobePath(), [
    '-v', 'error', '-show_format', '-show_streams', '-print_format', 'json', inputPath,
  ]);
  return JSON.parse(stdout);
};

export const encryptAndPackageMedia = async (
  inputPath: string,
  trackId: string,
  kid: string,
  encryptedCek: string
): Promise<PackagingResult> => {
  const outputDir = path.join(AUDIO_SEGMENTS_DIR, trackId);
  const metadataPath = path.join(AUDIO_METADATA_DIR, `${trackId}.json`);
  ensureDirectories([outputDir, AUDIO_METADATA_DIR]);

  console.log(`📦 [Packager] trackId=${trackId} KID=${kid}`);
  const mediaInfo = await extractMediaMetadata(inputPath);
  const duration = Math.ceil(parseFloat(mediaInfo.format?.duration || '0'));
  const bitrate = mediaInfo.format?.bit_rate || '128000';

  const plaintextCek = await decryptCEKForPackaging(encryptedCek);

  const initSegmentPath = path.join(outputDir, 'init.mp4');
  const segmentTemplate = path.join(outputDir, 'segment_$Number$.m4s');

  // MPD nằm TRONG outputDir — player load /audio/segments/{trackId}/manifest.mpd
  const mpdPath = path.join(outputDir, 'manifest.mpd');

  const packagerArgs = [
    `input=${inputPath},stream=audio,init_segment=${initSegmentPath},segment_template=${segmentTemplate},drm_label=audio`,
    '--enable_raw_key_encryption',
    '--keys', `label=audio:key_id=${kid}:key=${plaintextCek}`,
    '--protection_systems', 'Common',  // Common = ClearKey compatible, không cần Widevine CDM
    '--clear_lead', '0',
    '--segment_duration', '10',
    `--mpd_output=${mpdPath}`,
    '--generate_static_live_mpd',
  ];

  console.log('🚀 [Packager] Running Shaka Packager...');
  try {
    const { stderr } = await execFileAsync('packager', packagerArgs);
    if (stderr) console.log('⚠️  [Packager]', stderr);
  } catch (error: any) {
    if (error.stderr?.toUpperCase().includes('ERROR')) throw error;
    await new Promise(r => setTimeout(r, 1000));
  }

  if (!existsSync(mpdPath)) throw new Error(`MPD not created at ${mpdPath}`);

  writeFileSync(metadataPath, JSON.stringify({ trackId, kid, duration, bitrate, mpdPath, outputDir, createdAt: new Date().toISOString() }, null, 2));

  console.log('📤 [Packager] Uploading to R2...');
  try {
    const r2Prefix = `audio/${trackId}/`;
    await r2Service.uploadFile(mpdPath, `${r2Prefix}manifest.mpd`, 'application/dash+xml');
    await r2Service.uploadDirectory(outputDir, r2Prefix, ['.mp4', '.m4s']);
    console.log('✅ [Packager] R2 done');
  } catch (e: any) { throw new Error(`R2 Upload Failed: ${e.message}`); }

  return { success: true, trackId, kid, mpdPath, segmentDir: outputDir, metadataPath, duration, bitrate, message: 'Done' };
};