// api/admin/setup/route.ts
import { NextRequest, NextResponse } from 'next/server';

/**
 * POST /api/admin/setup
 * 
 * Tạo/setup user admin trong Keycloak
 * Chỉ gọi được 1 lần khi khởi động hệ thống
 * 
 * Header: X-Setup-TOKEN = ${SETUP_TOKEN} (env var)
 */

export async function POST(request: NextRequest) {
  try {
    // Verify setup token
    const setupToken = request.headers.get('X-Setup-TOKEN');
    const envToken = process.env.SETUP_TOKEN || 'setup-2006';
    
    if (!setupToken || setupToken !== envToken) {
      return NextResponse.json(
        { error: 'Invalid setup token' },
        { status: 401 }
      );
    }

    const KEYCLOAK_HOST = process.env.KEYCLOAK_ISSUER || 'http://keycloak:8080/realms/drm-realm';
    const ADMIN_USERNAME = 'admin';
    const ADMIN_PASSWORD = 'admin';
    const USERNAME = 'admin';
    const PASSWORD = 'Admin@2006';
    const REALM = 'drm-realm';

    console.log('🔐 [Setup] Starting admin user setup...');

    // Get admin token
    const tokenResponse = await fetch(
      `${KEYCLOAK_HOST.replace('/realms/drm-realm', '')}/realms/master/protocol/openid-connect/token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'password',
          client_id: 'admin-cli',
          username: ADMIN_USERNAME,
          password: ADMIN_PASSWORD,
        }).toString(),
      }
    );

    const tokenData = await tokenResponse.json();

    if (!tokenData.access_token) {
      console.error('❌ [Setup] Failed to get admin token:', tokenData);
      return NextResponse.json(
        { error: 'Failed to authenticate with Keycloak', details: tokenData },
        { status: 500 }
      );
    }

    const adminToken = tokenData.access_token;
    console.log('✅ [Setup] Admin token acquired');

    // Check if user exists
    const usersResponse = await fetch(
      `${KEYCLOAK_HOST.replace('/realms/drm-realm', '')}/admin/realms/${REALM}/users?username=${USERNAME}`,
      {
        headers: { Authorization: `Bearer ${adminToken}` },
      }
    );

    const users = await usersResponse.json();
    const existingUser = users.length > 0 ? users[0] : null;

    if (existingUser) {
      console.log('✅ [Setup] User already exists, updating password...');
      
      // Reset password
      await fetch(
        `${KEYCLOAK_HOST.replace('/realms/drm-realm', '')}/admin/realms/${REALM}/users/${existingUser.id}/reset-password`,
        {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${adminToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            type: 'password',
            value: PASSWORD,
            temporary: false,
          }),
        }
      );

      return NextResponse.json({
        success: true,
        message: 'Admin password updated',
        username: USERNAME,
      });
    }

    // Create new user
    console.log('✅ [Setup] Creating new admin user...');

    const createResponse = await fetch(
      `${KEYCLOAK_HOST.replace('/realms/drm-realm', '')}/admin/realms/${REALM}/users`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          username: USERNAME,
          email: 'admin@drm-system.local',
          enabled: true,
          credentials: [
            {
              type: 'password',
              value: PASSWORD,
              temporary: false,
            },
          ],
        }),
      }
    );

    if (createResponse.status === 201) {
      console.log('✅ [Setup] Admin user created successfully');
      return NextResponse.json({
        success: true,
        message: 'Admin user created',
        username: USERNAME,
        password: PASSWORD,
      });
    }

    const errorData = await createResponse.text();
    console.error('❌ [Setup] Failed to create user:', errorData);
    return NextResponse.json(
      { error: 'Failed to create admin user', status: createResponse.status },
      { status: 500 }
    );

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('❌ [Setup] Error:', message);
    return NextResponse.json(
      { error: 'Setup failed', details: message },
      { status: 500 }
    );
  }
}
