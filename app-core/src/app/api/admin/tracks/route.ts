import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth/middleware';
import { getAllTracks } from '@/lib/track-db';

/**
 * GET /api/admin/tracks
 * 
 * List all tracks (admin only)
 * 
 * Required role: admin
 * 
 * Response:
 *   [
 *     {
 *       id: "track-uuid",
 *       filename: "song.m4a",
 *       duration: 180,
 *       kid: "key-id-hex",
 *       source_format: "M4A",
 *       created_at: "2026-06-02T10:00:00Z",
 *       updated_at: "2026-06-02T10:00:00Z"
 *     },
 *     ...
 *   ]
 */
export async function GET(req: NextRequest) {
  try {
    // Check authorization
    const { error } = await requireRole(req, ['admin']);
    if (error) return error;

    // Fetch all tracks
    const tracks = await getAllTracks();

    return NextResponse.json({
      success: true,
      data: tracks,
      count: tracks.length,
    });
  } catch (error: any) {
    console.error('Error listing tracks:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to list tracks' },
      { status: 500 }
    );
  }
}
