import db from './db';
import { kmsService, generateKID, generateCEK } from './kms/bao';
import { v4 as uuidv4 } from 'uuid';
import type { Track, DASHManifest, AuditLog } from './types';

/**
 * Create a new track record with encrypted CEK
 * @param filename Name of the source audio file
 * @param sourceFormat Format of the source (AAC, M4A, etc.)
 * @returns Track object with trackId, kid, encrypted_cek
 */
export const createTrack = async (
  filename: string,
  sourceFormat: string = 'AAC'
): Promise<{
  trackId: string;
  kid: string;
  encrypted_cek: string;
}> => {
  try {
    const trackId = uuidv4();

    // Generate random KID and CEK
    const kid = generateKID();
    const cek = generateCEK();

    // Encrypt CEK via OpenBao KMS
    console.log(`🔐 [DB] Encrypting CEK for track ${trackId}...`);
    const encrypted_cek = await kmsService.encryptKey(cek);

    // Insert into tracks table with retry logic for KID collisions
    const query = `
      INSERT INTO tracks (id, filename, kid, encrypted_cek, source_format)
      VALUES (?, ?, ?, ?, ?)
    `;

    try {
      await db.query(query, [trackId, filename, kid, encrypted_cek, sourceFormat]);
      console.log(`✅ [DB] Track created: ${trackId} with KID: ${kid}`);

      return {
        trackId,
        kid,
        encrypted_cek
      };
    } catch (dbError: any) {
      // Check for KID uniqueness constraint violation
      if (dbError.code === 'ER_DUP_ENTRY' && dbError.message?.includes('kid')) {
        console.error('❌ [DB] KID collision detected, retrying with new KID');
        // Recursively retry with a new KID
        return createTrack(filename, sourceFormat);
      }
      throw dbError;
    }
  } catch (error: any) {
    console.error('❌ [DB] Error creating track:', error.message);
    throw error;
  }
};

/**
 * Get encrypted CEK by KID (for license proxy)
 * @param kid Key ID (hex string)
 * @returns Encrypted CEK from database
 */
export const getEncryptedCEKByKID = async (kid: string): Promise<string | null> => {
  try {
    const query = 'SELECT encrypted_cek FROM tracks WHERE kid = ?';
    const [rows]: any = await db.query(query, [kid]);

    if (rows.length === 0) {
      console.warn(`⚠️  [DB] KID not found: ${kid}`);
      return null;
    }

    console.log(`✅ [DB] Found encrypted CEK for KID: ${kid}`);
    return rows[0].encrypted_cek;
  } catch (error: any) {
    console.error('❌ [DB] Error retrieving CEK by KID:', error.message);
    throw error;
  }
};

/**
 * Get track info by ID
 * @param trackId UUID of the track
 */
export const getTrackById = async (trackId: string): Promise<Track | null> => {
  try {
    const query = 'SELECT * FROM tracks WHERE id = ?';
    const [rows]: any = await db.query(query, [trackId]);

    if (rows.length === 0) {
      console.warn(`⚠️  [DB] Track not found: ${trackId}`);
      return null;
    }

    return rows[0] as Track;
  } catch (error: any) {
    console.error('❌ [DB] Error retrieving track:', error.message);
    throw error;
  }
};

/**
 * Update track duration after packaging
 * @param trackId UUID of the track
 * @param duration Duration in seconds
 */
export const updateTrackDuration = async (trackId: string, duration: number): Promise<void> => {
  try {
    const query = 'UPDATE tracks SET duration = ? WHERE id = ?';
    await db.query(query, [duration, trackId]);
    console.log(`✅ [DB] Updated track ${trackId} duration: ${duration}s`);
  } catch (error: any) {
    console.error('❌ [DB] Error updating track duration:', error.message);
    throw error;
  }
};

/**
 * Save DASH manifest metadata
 * @param trackId UUID of the track
 * @param mpdPath Path to the generated MPD file
 * @param manifestData MPD content (optional, for caching)
 */
export const saveDASHManifest = async (
  trackId: string,
  mpdPath: string,
  manifestData?: string
): Promise<void> => {
  try {
    const query = `
      INSERT INTO dash_manifests (track_id, mpd_path, manifest_data, is_active)
      VALUES (?, ?, ?, 1)
    `;
    await db.query(query, [trackId, mpdPath, manifestData || null]);
    console.log(`✅ [DB] Saved DASH manifest for track ${trackId}`);
  } catch (error: any) {
    console.error('❌ [DB] Error saving DASH manifest:', error.message);
    throw error;
  }
};

/**
 * Get active DASH manifest for a track
 * @param trackId UUID of the track
 */
export const getActiveManifest = async (trackId: string): Promise<DASHManifest | null> => {
  try {
    const query = `
      SELECT * FROM dash_manifests 
      WHERE track_id = ? AND is_active = 1
      ORDER BY created_at DESC
      LIMIT 1
    `;
    const [rows]: any = await db.query(query, [trackId]);

    if (rows.length === 0) {
      console.warn(`⚠️  [DB] No active manifest for track: ${trackId}`);
      return null;
    }

    return rows[0] as DASHManifest;
  } catch (error: any) {
    console.error('❌ [DB] Error retrieving manifest:', error.message);
    throw error;
  }
};

/**
 * Log audit event
 * @param action Type of action (ENCRYPT, DECRYPT, PACKAGE_CREATED, LICENSE_ISSUED)
 * @param trackId Track ID (if applicable)
 * @param kid Key ID (if applicable)
 * @param userId User ID (optional)
 * @param targetFile File name (optional)
 */
export const logAuditEvent = async (
  action: string,
  trackId?: string,
  kid?: string,
  userId?: string,
  targetFile?: string
): Promise<void> => {
  try {
    const query = `
      INSERT INTO audit_logs (action, track_id, kid, user_id, target_file)
      VALUES (?, ?, ?, ?, ?)
    `;
    const truncatedFile = targetFile ? targetFile.slice(0, 255) : null;
    await db.query(query, [action, trackId || null, kid || null, userId || 'SYSTEM', truncatedFile]);
    console.log(`📝 [DB] Audit logged: ${action} for track ${trackId || 'N/A'}`);
  } catch (error: any) {
    console.error('❌ [DB] Error logging audit event:', error.message);
    throw error;
  }
};

/**
 * Deactivate old manifests when creating a new one
 * @param trackId UUID of the track
 */
export const deactivateOldManifests = async (trackId: string): Promise<void> => {
  try {
    const query = 'UPDATE dash_manifests SET is_active = 0 WHERE track_id = ? AND is_active = 1';
    await db.query(query, [trackId]);
    console.log(`📝 [DB] Deactivated old manifests for track ${trackId}`);
  } catch (error: any) {
    console.error('❌ [DB] Error deactivating manifests:', error.message);
    // Non-critical, don't throw
  }
};
