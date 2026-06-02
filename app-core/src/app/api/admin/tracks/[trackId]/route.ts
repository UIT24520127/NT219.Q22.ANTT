import { NextRequest, NextResponse } from 'next/server';
import { requireRole, getUserIdFromRequest } from '@/lib/auth/middleware';
import { deleteTrack, logAuditEvent } from '@/lib/track-db';

/**
 * DELETE /api/admin/tracks/:trackId
 * 
 * Delete a track (admin only)
 * Also deletes all associated DASH manifests (cascade delete)
 * 
 * Required role: admin
 * 
 * Response:
 *   { message: "Track deleted successfully" }
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: { trackId: string } }
) {
  try {
    // Check authorization
    const { error, user } = await requireRole(req, ['admin']);
    if (error) return error;

    const trackId = params.trackId;
    const userId = user.sub;

    if (!trackId) {
      return NextResponse.json(
        { error: 'Track ID is required' },
        { status: 400 }
      );
    }

    // Delete the track (manifests cascade delete)
    await deleteTrack(trackId);

    // Log audit event
    try {
      await logAuditEvent('TRACK_DELETED', trackId, undefined, userId);
    } catch {
      // Non-critical
    }

    return NextResponse.json({ message: 'Track deleted successfully' });
  } catch (error: any) {
    console.error('Error deleting track:', error);

    if (error.message?.includes('not found') || error.message?.includes('Unknown column')) {
      return NextResponse.json(
        { error: 'Track not found' },
        { status: 404 }
      );
    }

    return NextResponse.json(
      { error: error.message || 'Failed to delete track' },
      { status: 500 }
    );
  }
}
