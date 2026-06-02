import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth/middleware';
import { revokeUserRole } from '@/lib/keycloak-admin';

/**
 * POST /api/admin/users/:userId/revoke-admin
 * 
 * Revoke admin role from a user
 * 
 * Required role: admin
 * 
 * Response:
 *   { message: "Admin role revoked successfully" }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { userId: string } }
) {
  try {
    // Check authorization
    const { error } = await requireRole(req, ['admin']);
    if (error) return error;

    const userId = params.userId;

    if (!userId) {
      return NextResponse.json(
        { error: 'User ID is required' },
        { status: 400 }
      );
    }

    // Revoke admin role
    await revokeUserRole(userId, 'admin');

    return NextResponse.json({ message: 'Admin role revoked successfully' });
  } catch (error: any) {
    console.error('Error revoking admin role:', error);

    if (error.message?.includes('not found')) {
      return NextResponse.json(
        { error: 'User or role not found' },
        { status: 404 }
      );
    }

    return NextResponse.json(
      { error: error.message || 'Failed to revoke admin role' },
      { status: 500 }
    );
  }
}
