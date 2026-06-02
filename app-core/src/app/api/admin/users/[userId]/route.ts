import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth/middleware';
import { deleteUser } from '@/lib/keycloak-admin';

/**
 * DELETE /api/admin/users/:userId
 * 
 * Delete a user
 * 
 * Required role: admin
 * 
 * Response:
 *   { message: "User deleted successfully" }
 */
export async function DELETE(
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

    // Delete the user
    await deleteUser(userId);

    return NextResponse.json({ message: 'User deleted successfully' });
  } catch (error: any) {
    console.error('Error deleting user:', error);

    if (error.message?.includes('not found')) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      );
    }

    return NextResponse.json(
      { error: error.message || 'Failed to delete user' },
      { status: 500 }
    );
  }
}
