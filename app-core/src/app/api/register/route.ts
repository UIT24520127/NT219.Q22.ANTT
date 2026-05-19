import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { username, email, password } = body;

    // Lấy cấu hình từ file .env đã nạp
    const issuerUrl = process.env.KEYCLOAK_ISSUER || "http://localhost:8080/realms/drm-realm";
    const clientId = process.env.KEYCLOAK_CLIENT_ID || "backend-api";
    const clientSecret = process.env.KEYCLOAK_SECRET;

    if (!clientSecret) {
      return NextResponse.json({ error: "Thiếu KEYCLOAK_SECRET trong file .env" }, { status: 500 });
    }

    // 1. Xin Token Admin từ Keycloak
    const tokenRes = await fetch(`${issuerUrl}/protocol/openid-connect/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });

    if (!tokenRes.ok) {
      throw new Error("Không thể lấy quyền Admin từ Keycloak. Check lại Client Secret hoặc Realm.");
    }
    const tokenData = await tokenRes.json();
    const adminToken = tokenData.access_token;

    // Tách chuỗi issuerUrl để lấy địa chỉ gốc của Keycloak nhằm gọi API Admin
    // Ví dụ: http://localhost:8080/realms/music-realm -> http://localhost:8080
    const keycloakBaseUrl = issuerUrl.split('/realms/')[0];
    const realmName = issuerUrl.split('/realms/')[1];

    // 2. Gọi API Admin để tạo User mới
    const createUserRes = await fetch(`${keycloakBaseUrl}/admin/realms/${realmName}/users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        username: username,
        email: email,
        firstName: username,
        lastName: "Member",
        enabled: true,
        emailVerified: true,
        credentials: [{ type: "password", value: password, temporary: false }]
      })
    });

    if (createUserRes.ok || createUserRes.status === 201) {
      return NextResponse.json({ message: "Đăng ký thành công rực rỡ!" }, { status: 201 });
    } else {
      const errorData = await createUserRes.json();
      return NextResponse.json({ error: errorData.errorMessage || "Tài khoản hoặc Email đã tồn tại!" }, { status: createUserRes.status });
    }
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}