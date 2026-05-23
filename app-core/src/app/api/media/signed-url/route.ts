import { NextRequest, NextResponse } from 'next/server';
import { r2Service } from '@/lib/storage/r2';

/**
 * GET /api/media/signed-url
 * Generates a time-limited signed URL for secure media access
 * 
 * Query Parameters:
 *   - key: Remote object key in R2 (e.g., 'audio/track-123/segment.mp4')
 *   - expires: URL expiration time in seconds (default: 300 = 5 minutes, max: 3600)
 * 
 * Response:
 *   {
 *     "success": true,
 *     "url": "https://..../audio/track-123/segment.mp4?X-Amz-Signature=...",
 *     "expiresIn": 300,
 *     "expiresAt": "2026-05-22T10:30:00.000Z"
 *   }
 */
export async function GET(request: NextRequest) {
  try {
    // Extract query parameters
    const searchParams = request.nextUrl.searchParams;
    const key = searchParams.get('key');
    const expiresParam = searchParams.get('expires');

    // Validate input
    if (!key) {
      return NextResponse.json(
        { error: 'Missing required parameter: key' },
        { status: 400 }
      );
    }

    // Validate key format (prevent directory traversal)
    if (key.includes('..') || key.startsWith('/')) {
      return NextResponse.json(
        { error: 'Invalid key format' },
        { status: 400 }
      );
    }

    // Parse expiration time (default 300 seconds = 5 minutes)
    let expiresInSeconds = 300;
    if (expiresParam) {
      const parsed = parseInt(expiresParam, 10);
      if (isNaN(parsed) || parsed < 60 || parsed > 3600) {
        return NextResponse.json(
          { error: 'Expires must be between 60 and 3600 seconds' },
          { status: 400 }
        );
      }
      expiresInSeconds = parsed;
    }

    console.log(`🔐 [API] Generating signed URL for: ${key} (expires in ${expiresInSeconds}s)`);

    // Generate signed URL
    const result = await r2Service.generateSignedUrl(key, expiresInSeconds);

    // Log audit trail
    console.log(`✅ [API] Signed URL generated successfully`);

    return NextResponse.json({
      success: true,
      url: result.url,
      expiresIn: result.expiresIn,
      expiresAt: result.expiresAt.toISOString(),
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('❌ [API] Error generating signed URL:', message);

    return NextResponse.json(
      { error: 'Failed to generate signed URL', details: message },
      { status: 500 }
    );
  }
}
