import { NextRequest, NextResponse } from 'next/server';
import { r2Service } from '@/lib/storage/r2';

export interface SignedUrlBatchRequest {
  keys: string[];
  expiresIn?: number;
}

export interface SignedUrlBatchResponse {
  success: boolean;
  urls: Array<{
    key: string;
    url: string;
    expiresAt: string;
  }>;
  expiresIn: number;
}

/**
 * POST /api/media/signed-urls
 * Generate multiple signed URLs in one request
 * Useful for DASH manifest segments that need time-limited access
 * 
 * Request Body:
 *   {
 *     "keys": ["audio/track-123/segment1.m4s", "audio/track-123/segment2.m4s"],
 *     "expiresIn": 300  // optional, default 5 minutes
 *   }
 * 
 * Response:
 *   {
 *     "success": true,
 *     "urls": [
 *       { "key": "...", "url": "https://...", "expiresAt": "2026-05-22T10:30:00Z" },
 *       ...
 *     ],
 *     "expiresIn": 300
 *   }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as SignedUrlBatchRequest;

    // Validate input
    if (!body.keys || !Array.isArray(body.keys) || body.keys.length === 0) {
      return NextResponse.json(
        { error: 'Missing or invalid "keys" array' },
        { status: 400 }
      );
    }

    // Limit batch size to prevent abuse
    if (body.keys.length > 100) {
      return NextResponse.json(
        { error: 'Maximum 100 keys per request' },
        { status: 400 }
      );
    }

    // Validate expiration time
    let expiresInSeconds = 300;
    if (body.expiresIn) {
      if (isNaN(body.expiresIn) || body.expiresIn < 60 || body.expiresIn > 3600) {
        return NextResponse.json(
          { error: 'expiresIn must be between 60 and 3600 seconds' },
          { status: 400 }
        );
      }
      expiresInSeconds = body.expiresIn;
    }

    console.log(`🔐 [API] Generating ${body.keys.length} signed URLs (expires in ${expiresInSeconds}s)`);

    // Generate signed URLs for all keys
    const urls = await Promise.all(
      body.keys.map(async (key) => {
        try {
          // Validate key format
          if (key.includes('..') || key.startsWith('/')) {
            throw new Error('Invalid key format');
          }

          const result = await r2Service.generateSignedUrl(key, expiresInSeconds);
          return {
            key,
            url: result.url,
            expiresAt: result.expiresAt.toISOString(),
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error';
          console.error(`❌ [API] Failed for key ${key}:`, message);
          throw error;
        }
      })
    );

    console.log(`✅ [API] Successfully generated ${urls.length} signed URLs`);

    return NextResponse.json({
      success: true,
      urls,
      expiresIn: expiresInSeconds,
    } as SignedUrlBatchResponse);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('❌ [API] Error generating signed URLs:', message);

    return NextResponse.json(
      { error: 'Failed to generate signed URLs', details: message },
      { status: 500 }
    );
  }
}
