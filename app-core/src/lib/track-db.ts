import db from './db';
import { kmsService, generateKID, generateCEK } from './kms/bao';
import { v4 as uuidv4 } from 'uuid';
import type { Track, DASHManifest, AuditLog } from './types';

export const createTrack = async (
  filename: string,
  sourceFormat: string = 'AAC'
): Promise<{ trackId: string; kid: string; encrypted_cek: string }> => {
  try {
    const trackId = uuidv4();
    const kid = generateKID();
    const cek = generateCEK();
    console.log(`🔐 [DB] Encrypting CEK for track ${trackId}...`);
    const encrypted_cek = await kmsService.encryptKey(cek);
    const query = `INSERT INTO tracks (id, filename, kid, encrypted_cek, source_format) VALUES (?, ?, ?, ?, ?)`;
    try {
      await db.query(query, [trackId, filename, kid, encrypted_cek, sourceFormat]);
      console.log(`✅ [DB] Track created: ${trackId} with KID: ${kid}`);
      return { trackId, kid, encrypted_cek };
    } catch (dbError: any) {
      if (dbError.code === 'ER_DUP_ENTRY' && dbError.message?.includes('kid')) {
        console.error('❌ [DB] KID collision, retrying...');
        return createTrack(filename, sourceFormat);
      }
      throw dbError;
    }
  } catch (error: any) {
    console.error('❌ [DB] Error creating track:', error.message);
    throw error;
  }
};

export const getEncryptedCEKByKID = async (kid: string): Promise<string | null> => {
  try {
    const [rows]: any = await db.query('SELECT encrypted_cek FROM tracks WHERE kid = ?', [kid]);
    if (rows.length === 0) { console.warn(`⚠️  [DB] KID not found: ${kid}`); return null; }
    console.log(`✅ [DB] Found encrypted CEK for KID: ${kid}`);
    return rows[0].encrypted_cek;
  } catch (error: any) {
    console.error('❌ [DB] Error retrieving CEK:', error.message);
    throw error;
  }
};

export const getTrackById = async (trackId: string): Promise<Track | null> => {
  try {
    const [rows]: any = await db.query('SELECT * FROM tracks WHERE id = ?', [trackId]);
    if (rows.length === 0) { console.warn(`⚠️  [DB] Track not found: ${trackId}`); return null; }
    return rows[0] as Track;
  } catch (error: any) {
    console.error('❌ [DB] Error retrieving track:', error.message);
    throw error;
  }
};

// ══════════════════════════════════════════════════════════════════════════════
// HÀM MỚI: Lấy toàn bộ tracks cho trang chủ
// Homepage cần fetch danh sách tất cả bài hát, không phải từng cái một
// ══════════════════════════════════════════════════════════════════════════════
export const getAllTracks = async (): Promise<Track[]> => {
  try {
    const [rows]: any = await db.query(
      'SELECT id, filename, kid, source_format, duration, created_at FROM tracks ORDER BY created_at DESC'
    );
    console.log(`✅ [DB] Fetched ${rows.length} tracks`);
    return rows as Track[];
  } catch (error: any) {
    console.error('❌ [DB] Error fetching all tracks:', error.message);
    throw error;
  }
};

export const updateTrackDuration = async (trackId: string, duration: number): Promise<void> => {
  try {
    await db.query('UPDATE tracks SET duration = ? WHERE id = ?', [duration, trackId]);
    console.log(`✅ [DB] Updated track ${trackId} duration: ${duration}s`);
  } catch (error: any) {
    console.error('❌ [DB] Error updating duration:', error.message);
    throw error;
  }
};

export const saveDASHManifest = async (trackId: string, mpdPath: string, manifestData?: string): Promise<void> => {
  try {
    await db.query(
      `INSERT INTO dash_manifests (track_id, mpd_path, manifest_data, is_active) VALUES (?, ?, ?, 1)`,
      [trackId, mpdPath, manifestData || null]
    );
    console.log(`✅ [DB] Saved DASH manifest for track ${trackId}`);
  } catch (error: any) {
    console.error('❌ [DB] Error saving manifest:', error.message);
    throw error;
  }
};

export const getActiveManifest = async (trackId: string): Promise<DASHManifest | null> => {
  try {
    const [rows]: any = await db.query(
      `SELECT * FROM dash_manifests WHERE track_id = ? AND is_active = 1 ORDER BY created_at DESC LIMIT 1`,
      [trackId]
    );
    if (rows.length === 0) { console.warn(`⚠️  [DB] No active manifest: ${trackId}`); return null; }
    return rows[0] as DASHManifest;
  } catch (error: any) {
    console.error('❌ [DB] Error retrieving manifest:', error.message);
    throw error;
  }
};

export const logAuditEvent = async (
  action: string,
  trackId?: string,
  kid?: string,
  userId?: string,
  targetFile?: string
): Promise<void> => {
  try {
    const truncatedFile = targetFile ? targetFile.slice(0, 255) : null;
    await db.query(
      `INSERT INTO audit_logs (action, track_id, kid, user_id, target_file) VALUES (?, ?, ?, ?, ?)`,
      [action, trackId || null, kid || null, userId || 'SYSTEM', truncatedFile]
    );
    console.log(`📝 [DB] Audit logged: ${action} for track ${trackId || 'N/A'}`);
  } catch (error: any) {
    console.error('❌ [DB] Error logging audit:', error.message);
    throw error;
  }
};

export const deactivateOldManifests = async (trackId: string): Promise<void> => {
  try {
    await db.query('UPDATE dash_manifests SET is_active = 0 WHERE track_id = ? AND is_active = 1', [trackId]);
    console.log(`📝 [DB] Deactivated old manifests for track ${trackId}`);
  } catch (error: any) {
    console.error('❌ [DB] Error deactivating manifests:', error.message);
  }
};