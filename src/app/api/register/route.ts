import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { username, email, password } = body;

    const REALM = "drm-realm";
    const CLIENT_ID = "backend-api";
    const CLIENT_SECRET = "Ug4bI09gWfGp3RQE7K2eU5Ol1za9AknT"; 

    // 1. Gọi cửa sau Keycloak để xin Token Admin (Bảo mật tuyệt đối vì nằm trên Server)
    const tokenRes = await fetch(`http://localhost:8080/realms/${REALM}/protocol/openid-connect/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
      }),
    });

    if (!tokenRes.ok) throw new Error("Cấu hình Keycloak sai, không lấy được quyền Admin.");
    const tokenData = await tokenRes.json();
    const adminToken = tokenData.access_token;

    // 2. Dùng Token Admin để tạo User mới
    const createUserRes = await fetch(`http://localhost:8080/admin/realms/${REALM}/users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        username: username,
        email: email,
        firstName: username, // Thêm dòng này: Gán luôn username làm Tên
        lastName: "Member",  // Thêm dòng này: Gán mặc định họ là Member
        enabled: true,
        emailVerified: true,
        credentials: [{
          type: "password",
          value: password,
          temporary: false
        }]
      })
    });

    if (createUserRes.ok || createUserRes.status === 201) {
      return NextResponse.json({ message: "Đăng ký thành công!" }, { status: 201 });
    } else {
      const errorData = await createUserRes.json();
      return NextResponse.json({ error: errorData.errorMessage || "Lỗi từ Keycloak" }, { status: createUserRes.status });
    }
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}