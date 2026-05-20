/**
 * Database Model Types
 * Provides TypeScript interfaces for database queries and responses
 */

export interface Track {
  id: string;
  filename: string;
  kid: string;
  encrypted_cek: string;
  source_format: string;
  duration?: number;
  created_at: Date;
  updated_at: Date;
}

export interface DASHManifest {
  id: string;
  track_id: string;
  mpd_path: string;
  manifest_data?: string;
  is_active: number;
  created_at: Date;
  updated_at: Date;
}

export interface AuditLog {
  id: string;
  action: string;
  track_id?: string;
  kid?: string;
  user_id?: string;
  target_file?: string;
  created_at: Date;
}

export interface PackagingResult {
  success: boolean;
  trackId: string;
  kid: string;
  mpdPath: string;
  segmentDir: string;
  metadataPath: string;
  duration: number;
  bitrate: string;
  message: string;
}