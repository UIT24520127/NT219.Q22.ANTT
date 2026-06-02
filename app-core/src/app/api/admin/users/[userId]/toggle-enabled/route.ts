import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth/middleware';
import { setUserEnabled, getUserById } from '@/lib/keycloak-admin';

/**
 * POST /api/admin/users/:userId/toggle-enabled
 * 
 * Toggle user enabled status (enable/disable)
 * 
 * Required role: admin
 * 
 * Request body (optional):
 *   { enabled: true/false }
 * 
 * If not provided, toggles the current state
 * 
 * Response:
 *   { message: "User enabled/disabled successfully", enabled: true/false }
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

    let body: any = {};
    try {
      body = await req.json();
    } catch {
      // No body provided, will toggle
    }

    let newEnabled = body.enabled;

    // If not specified, get current state and toggle
    if (newEnabled === undefined) {
      const user = await getUserById(userId);
      if (!user) {
        return NextResponse.json(
          { error: 'User not found' },
          { status: 404 }
        );
      }
      newEnabled = !user.enabled;
    }

    // Set the new state
    await setUserEnabled(userId, newEnabled);

    return NextResponse.json({
      message: `User ${newEnabled ? 'enabled' : 'disabled'} successfully`,
      enabled: newEnabled,
    });
  } catch (error: any) {
    console.error('Error toggling user enabled status:', error);

    if (error.message?.includes('not found')) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      );
    }

    return NextResponse.json(
      { error: error.message || 'Failed to update user' },
      { status: 500 }
    );
  }
}
