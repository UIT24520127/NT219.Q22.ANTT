import { NextResponse } from 'next/server';
import * as jose from 'jose'; 
import crypto from 'crypto';

const PRIVATE_JWK = {
  "kty": "EC",
  "crv": "P-256",
  "x": "8xJqKSuNAr21oGZl4kNTQbrYfmpjll1VfW68T5m61aY",
  "y": "ciAhf8vsOrYF9OcQlf8BgyL3z7DsMga6qQCBANrhDxk",
  "d": "ZlrJLOJlClmHHl2Slgu_DrROMAPsB9VdAFjh3Lcdcc4"
};

const PUBLIC_JWK = {
  "kty": "EC",
  "crv": "P-256",
  "x": PRIVATE_JWK.x,
  "y": PRIVATE_JWK.y,
  "alg": "ES256",
  "use": "sig"
};

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { username, email, password } = body;

    // Lấy cấu hình ban đầu từ .env (http://localhost:8080/realms/drm-realm)
    const issuerUrl = process.env.KEYCLOAK_ISSUER || "http://keycloak:8080/realms/drm-realm";
    const clientId = process.env.KEYCLOAK_CLIENT_ID || "backend-api";
    const clientSecret = process.env.KEYCLOAK_SECRET;

    if (!clientSecret) {
      return NextResponse.json({ error: "Thiếu KEYCLOAK_SECRET trong file .env" }, { status: 500 });
    }

    const privateKey = await jose.importJWK(PRIVATE_JWK, 'ES256');

    // 🔀 Định tuyến mạng thống nhất qua Docker để tránh lệch htu Mismatch
    const tokenEndpointFetch = `${issuerUrl}/protocol/openid-connect/token`;
    const domainGoc = issuerUrl.split('/realms/')[0];
    const realmName = issuerUrl.split('/realms/')[1];
    const createUserEndpointFetch = `${domainGoc}/admin/realms/${realmName}/users`;
    
    // ==========================================
    // 🔥 BƯỚC 1: XIN TOKEN ADMIN (KÝ HỮU HIỆU THEO URL THỰC TẾ)
    // ==========================================
    const tokenDpopProof = await new jose.SignJWT({
      jti: crypto.randomUUID(), // Thêm jti độc nhất chuẩn RFC
      htm: 'POST',
      htu: tokenEndpointFetch,
    })
      .setProtectedHeader({
        alg: 'ES256',
        typ: 'dpop+jwt',
        jwk: PUBLIC_JWK // Khóa công khai cố định gửi kèm
      })
      .setIssuedAt() // Sửa lỗi iat thủ công theo ChatGPT nhắc nhở
      .setExpirationTime('2m')
      .sign(privateKey);

    const params = new URLSearchParams();
    params.append('grant_type', 'client_credentials');
    params.append('client_id', clientId);
    params.append('client_secret', clientSecret);

    const tokenRes = await fetch(tokenEndpointFetch, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'DPoP': tokenDpopProof
      },
      body: params
    });

    if (!tokenRes.ok) {
      const errText = await tokenRes.text();
      console.error("❌ Lỗi Bước 1 lấy token:", errText);
      return NextResponse.json({ error: "Không lấy được token admin" }, { status: tokenRes.status });
    }
    
    const tokenData = await tokenRes.json();
    const adminToken = tokenData.access_token;

    const tokenHash = crypto.createHash('sha256').update(adminToken).digest();
    const ath = jose.base64url.encode(tokenHash);

    const adminDpopProof = await new jose.SignJWT({
      jti: crypto.randomUUID(), // jti độc nhất
      htm: 'POST',
      htu: createUserEndpointFetch, // Thống nhất htu trùng khớp tuyệt đối URL Fetch
      ath: ath // Nhét chuỗi liên kết access token bảo mật vào đây
    })
      .setProtectedHeader({
        alg: 'ES256',
        typ: 'dpop+jwt',
        jwk: PUBLIC_JWK // Vẫn giữ nguyên signature của khóa cũ
      })
      .setIssuedAt() // Dùng method chuẩn của jose
      .setExpirationTime('2m')
      .sign(privateKey);

    // Tiến hành gọi API Admin thực tế tạo User
    const createUserRes = await fetch(createUserEndpointFetch, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `DPoP ${adminToken}`,
        'DPoP': adminDpopProof
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
      const rawErrorText = await createUserRes.text();
      console.error("❌ [KEYCLOAK ERROR LOG]:", rawErrorText);
      return NextResponse.json({ error: `Keycloak từ chối: ${rawErrorText}` }, { status: createUserRes.status });
    }

  } catch (error: any) {
    return NextResponse.json({ error: `Lỗi Server Nội Bộ: ${error.message}` }, { status: 500 });
  }
}