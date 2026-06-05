// app/api/auth/register/route.ts
import { NextResponse } from 'next/server';

const ALLOWED_ROLES = ['music_listener', 'music_uploader'] as const;
type AllowedRole = typeof ALLOWED_ROLES[number];

/** Lấy admin token từ master realm — plain Bearer, không DPoP */
async function getMasterAdminToken(keycloakBase: string): Promise<string> {
  const adminUser = process.env.KC_ADMIN_USERNAME || 'admin';
  const adminPass = process.env.KC_ADMIN_PASSWORD || 'admin';

  const res = await fetch(`${keycloakBase}/realms/master/protocol/openid-connect/token`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    new URLSearchParams({
      grant_type: 'password',
      client_id:  'admin-cli',
      username:   adminUser,
      password:   adminPass,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Không lấy được master admin token: ${text}`);
  }

  const { access_token } = await res.json();
  return access_token;
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { username, email, password, role } = body as {
      username?: string;
      email?: string;
      password?: string;
      role?: string;
    };

    // ── Validate input ────────────────────────────────────────────────────
    if (!username || !email || !password || !role) {
      return NextResponse.json(
        { error: 'Thiếu username, email, password hoặc role' },
        { status: 400 }
      );
    }

    if (!ALLOWED_ROLES.includes(role as AllowedRole)) {
      return NextResponse.json(
        { error: `Role không hợp lệ. Chỉ chấp nhận: ${ALLOWED_ROLES.join(', ')}` },
        { status: 400 }
      );
    }

    // ── Load config ───────────────────────────────────────────────────────
    const issuerUrl = process.env.KEYCLOAK_ISSUER || 'http://keycloak:8080/realms/drm-realm';
    const domainGoc = issuerUrl.split('/realms/')[0];
    const realmName = issuerUrl.split('/realms/')[1];

    // ══════════════════════════════════════════════════════════════════════
    // BƯỚC 1: Lấy admin token từ master realm (plain Bearer)
    // ══════════════════════════════════════════════════════════════════════
    const adminToken = await getMasterAdminToken(domainGoc);

    const authHeader = { 'Authorization': `Bearer ${adminToken}` };

    // ══════════════════════════════════════════════════════════════════════
    // BƯỚC 2: Tạo user
    // ══════════════════════════════════════════════════════════════════════
    const createUserUrl = `${domainGoc}/admin/realms/${realmName}/users`;
    const createRes = await fetch(createUserUrl, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader },
      body: JSON.stringify({
        username,
        email,
        firstName:     username,
        lastName:      'Member',
        enabled:       true,
        emailVerified: true,
        credentials:   [{ type: 'password', value: password, temporary: false }],
      }),
    });

    if (!createRes.ok && createRes.status !== 201) {
      const text = await createRes.text();
      console.error('❌ [Register] Keycloak từ chối tạo user:', text);
      return NextResponse.json(
        { error: createRes.status === 409 ? 'Username hoặc email đã tồn tại' : `Keycloak: ${text}` },
        { status: createRes.status }
      );
    }

    // ── Lấy userId từ Location header hoặc fallback query ─────────────────
    const locationHeader = createRes.headers.get('Location');
    let userId: string;

    if (locationHeader) {
      userId = locationHeader.split('/').at(-1)!;
    } else {
      const searchUrl = `${domainGoc}/admin/realms/${realmName}/users?username=${encodeURIComponent(username)}&exact=true`;
      const searchRes = await fetch(searchUrl, { headers: authHeader });
      const users = await searchRes.json();
      if (!users?.length) {
        return NextResponse.json({ error: 'Không tìm thấy user vừa tạo' }, { status: 500 });
      }
      userId = users[0].id;
    }

    // ══════════════════════════════════════════════════════════════════════
    // BƯỚC 3: Lấy thông tin realm role
    // ══════════════════════════════════════════════════════════════════════
    const roleUrl = `${domainGoc}/admin/realms/${realmName}/roles/${encodeURIComponent(role)}`;
    const roleRes = await fetch(roleUrl, { headers: authHeader });

    if (!roleRes.ok) {
      const text = await roleRes.text();
      console.error(`❌ [Register] Không tìm thấy role "${role}":`, text);
      return NextResponse.json(
        { error: `Role "${role}" chưa được tạo trong Keycloak realm. Vui lòng tạo role trước.` },
        { status: 500 }
      );
    }

    const roleData = await roleRes.json();

    // ══════════════════════════════════════════════════════════════════════
    // BƯỚC 4: Assign role cho user
    // ══════════════════════════════════════════════════════════════════════
    const assignUrl = `${domainGoc}/admin/realms/${realmName}/users/${userId}/role-mappings/realm`;
    const assignRes = await fetch(assignUrl, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader },
      body: JSON.stringify([{ id: roleData.id, name: roleData.name }]),
    });

    if (!assignRes.ok) {
      const text = await assignRes.text();
      console.error('❌ [Register] Assign role thất bại:', text);
      return NextResponse.json(
        { error: `Tạo user thành công nhưng không assign được role: ${text}` },
        { status: 500 }
      );
    }

    console.log(`✅ [Register] ${username} (${email}) → role: ${role} | userId: ${userId}`);
    return NextResponse.json(
      { message: 'Đăng ký thành công!', userId, role },
      { status: 201 }
    );

  } catch (error: any) {
    console.error('❌ [Register] Lỗi server:', error.message);
    return NextResponse.json({ error: `Lỗi Server: ${error.message}` }, { status: 500 });
  }
}
