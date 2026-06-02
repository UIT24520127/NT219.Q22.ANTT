import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth/middleware';
import { listUsers, getUserRoles } from '@/lib/keycloak-admin';

/**
 * GET /api/admin/users
 * 
 * List all users with their roles
 * 
 * Required role: admin
 * 
 * Query parameters:
 *   first - offset (default: 0)
 *   max - max results (default: 100)
 * 
 * Response:
 *   [
 *     {
 *       id: "user-id",
 *       username: "user1",
 *       email: "user1@example.com",
 *       firstName: "User",
 *       lastName: "One",
 *       enabled: true,
 *       roles: ["uploader", "admin"]
 *     },
 *     ...
 *   ]
 */
export async function GET(req: NextRequest) {
  try {
    // Check authorization
    const { error } = await requireRole(req, ['admin']);
    if (error) return error;

    // Parse query parameters
    const searchParams = req.nextUrl.searchParams;
    const first = parseInt(searchParams.get('first') || '0');
    const max = parseInt(searchParams.get('max') || '100');

    // Fetch users
    const users = await listUsers(first, max);

    // Fetch roles for each user
    const usersWithRoles = await Promise.all(
      users.map(async (user) => ({
        id: user.id,
        username: user.username,
        email: user.email || null,
        firstName: user.firstName || null,
        lastName: user.lastName || null,
        enabled: user.enabled,
        roles: user.id ? (await getUserRoles(user.id)).map(r => r.name) : [],
      }))
    );

    return NextResponse.json(usersWithRoles);
  } catch (error: any) {
    console.error('Error listing users:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to list users' },
      { status: 500 }
    );
  }
}
