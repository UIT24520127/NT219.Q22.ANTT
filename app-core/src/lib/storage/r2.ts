import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import fs from 'fs';
import path from 'path';

// ===== CLOUDFLARE R2 CONFIG =====
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID || '';
const R2_ENDPOINT = process.env.R2_ENDPOINT || `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME || 'encrypted-audio';
const R2_REGION = process.env.R2_REGION || 'auto';
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID || '';
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY || '';

// ===== S3 CLIENT INITIALIZATION (Compatible with Cloudflare R2) =====
const s3Client = new S3Client({
  region: R2_REGION,
  endpoint: R2_ENDPOINT,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
  },
});

export interface UploadResult {
  success: boolean;
  bucket: string;
  key: string;
  url: string;
  message: string;
}

export interface SignedUrlResult {
  url: string;
  expiresIn: number;
  expiresAt: Date;
}

/**
 * Upload a file to Cloudflare R2
 * @param filePath Local file path to upload
 * @param remoteKey Remote object key (e.g., 'audio/track-123/segment.mp4')
 * @param contentType MIME type (e.g., 'video/mp4')
 */
export const r2Service = {
  uploadFile: async (
    filePath: string,
    remoteKey: string,
    contentType: string = 'application/octet-stream'
  ): Promise<UploadResult> => {
    try {
      // Validate file exists
      if (!fs.existsSync(filePath)) {
        throw new Error(`Local file not found: ${filePath}`);
      }

      // Read file content
      const fileContent = fs.readFileSync(filePath);
      const fileSize = fs.statSync(filePath).size;

      console.log(`📤 [R2] Uploading ${remoteKey} (${fileSize} bytes) to Cloudflare R2...`);

      // Upload to R2
      const command = new PutObjectCommand({
        Bucket: R2_BUCKET_NAME,
        Key: remoteKey,
        Body: fileContent,
        ContentType: contentType,
        CacheControl: 'no-cache', // Disable caching for encrypted files
      });

      await s3Client.send(command);

      const publicUrl = `${R2_ENDPOINT}/${R2_BUCKET_NAME}/${remoteKey}`;

      console.log(`✅ [R2] File uploaded successfully: ${remoteKey}`);
      console.log(`🔗 [R2] Public URL: ${publicUrl}`);

      return {
        success: true,
        bucket: R2_BUCKET_NAME,
        key: remoteKey,
        url: publicUrl,
        message: `File uploaded to R2: ${remoteKey}`,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error(`❌ [R2] Upload failed for ${remoteKey}:`, message);
      throw new Error(`R2 Upload Failed: ${message}`);
    }
  },

  /**
   * Upload multiple files from a directory
   * @param sourceDir Local directory containing files
   * @param remotePrefix Remote prefix (e.g., 'audio/track-123/')
   * @param fileExtensions Filter by extensions (e.g., ['.mp4', '.mpd'])
   */
  uploadDirectory: async (
    sourceDir: string,
    remotePrefix: string,
    fileExtensions: string[] = ['.mp4', '.mpd']
  ): Promise<UploadResult[]> => {
    const results: UploadResult[] = [];

    try {
      if (!fs.existsSync(sourceDir)) {
        throw new Error(`Source directory not found: ${sourceDir}`);
      }

      const files = fs.readdirSync(sourceDir);

      for (const file of files) {
        // Filter by extension
        if (!fileExtensions.some(ext => file.endsWith(ext))) {
          console.log(`⏭️  [R2] Skipping file (not in filter): ${file}`);
          continue;
        }

        const localPath = path.join(sourceDir, file);
        const remoteKey = `${remotePrefix}${file}`;

        // Determine content type
        let contentType = 'application/octet-stream';
        if (file.endsWith('.mp4')) contentType = 'video/mp4';
        else if (file.endsWith('.mpd')) contentType = 'application/dash+xml';

        try {
          const result = await r2Service.uploadFile(localPath, remoteKey, contentType);
          results.push(result);
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error';
          console.error(`❌ [R2] Failed to upload ${file}: ${message}`);
          results.push({
            success: false,
            bucket: R2_BUCKET_NAME,
            key: remoteKey,
            url: '',
            message: `Failed to upload: ${message}`,
          });
        }
      }

      console.log(`✅ [R2] Directory upload complete: ${results.length} files processed`);
      return results;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error(`❌ [R2] Directory upload failed:`, message);
      throw new Error(`R2 Directory Upload Failed: ${message}`);
    }
  },

  /**
   * Generate signed URL for secure access (expires in 5 minutes by default)
   * @param remoteKey Remote object key (e.g., 'audio/track-123/segment.mp4')
   * @param expiresInSeconds URL expiration time in seconds (default: 300 = 5 minutes)
   */
  generateSignedUrl: async (
    remoteKey: string,
    expiresInSeconds: number = 300
  ): Promise<SignedUrlResult> => {
    try {
      const command = new GetObjectCommand({
        Bucket: R2_BUCKET_NAME,
        Key: remoteKey,
      });

      const url = await getSignedUrl(s3Client, command, {
        expiresIn: expiresInSeconds,
      });

      const expiresAt = new Date(Date.now() + expiresInSeconds * 1000);

      console.log(`🔐 [R2] Signed URL generated for ${remoteKey}`);
      console.log(`⏰ [R2] Expires in: ${expiresInSeconds}s (at ${expiresAt.toISOString()})`);

      return {
        url,
        expiresIn: expiresInSeconds,
        expiresAt,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error(`❌ [R2] Failed to generate signed URL for ${remoteKey}:`, message);
      throw new Error(`Signed URL Generation Failed: ${message}`);
    }
  },

  /**
   * Check if object exists in R2
   * @param remoteKey Remote object key
   */
  objectExists: async (remoteKey: string): Promise<boolean> => {
    try {
      const command = new HeadObjectCommand({
        Bucket: R2_BUCKET_NAME,
        Key: remoteKey,
      });

      await s3Client.send(command);
      console.log(`✅ [R2] Object exists: ${remoteKey}`);
      return true;
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'NotFound') {
        console.log(`❌ [R2] Object not found: ${remoteKey}`);
        return false;
      }
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error(`⚠️  [R2] Error checking object: ${message}`);
      return false;
    }
  },
};
