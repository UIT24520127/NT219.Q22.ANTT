import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  try {
    // =====================================================================
    // 1. LẤY "VÉ VIP" (TOKEN) VÀ KHÓA ECDH TỪ FRONTEND
    // =====================================================================
    const authHeader = req.headers.get('Authorization');
    const clientPubKeyBase64 = req.headers.get('X-Client-Public-Key');

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      console.error("❌ API License: Không tìm thấy Token hợp lệ.");
      return NextResponse.json({ error: 'Unauthorized: Missing or invalid token' }, { status: 401 });
    }
    const token = authHeader.split(' ')[1];

    // =====================================================================
    // 2. KIỂM TRA TOKEN VỚI KEYCLOAK (FIX LỖI DOCKER "MÉO NHẬN")
    // =====================================================================
    // LƯU Ý CHO ĐỨC ANH: Trong Docker, không dùng localhost. 
    // Phải gọi qua Service Name (vd: http://keycloak:8080) được định nghĩa trong file .env
    const keycloakInternalUrl = process.env.KEYCLOAK_INTERNAL_URL || 'http://keycloak:8080/realms/uit-drm/protocol/openid-connect/userinfo';
    
    try {
      const verifyRes = await fetch(keycloakInternalUrl, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (!verifyRes.ok) {
        console.error("❌ API License: Token bị Keycloak từ chối hoặc đã hết hạn.");
        return NextResponse.json({ error: 'Forbidden: Invalid Token' }, { status: 403 });
      }
      console.log("✅ API License: Token hợp lệ! User đã được xác thực.");
    } catch (kcError) {
      console.error("🚨 Lỗi mạng nội bộ Docker khi gọi Keycloak:", kcError);
      return NextResponse.json({ error: 'Internal Auth Service Unavailable' }, { status: 500 });
    }

    // =====================================================================
    // 3. NHẬN BẢN TIN WIDEVINE CHALLENGE VÀ GỌI OPENBAO KMS
    // =====================================================================
    const challengeBuffer = await req.arrayBuffer();
    
    // ĐỨC ANH CHÚ Ý: Cấu hình URL OpenBao nội bộ trong .env
    const openbaoInternalUrl = process.env.OPENBAO_INTERNAL_URL || 'http://openbao:8200/v1/drm/widevine/license';
    
    let licenseBuffer: Buffer;
    
    try {
      // Gửi Challenge sang OpenBao để lấy License thật
      /* CODE GỌI OPENBAO THẬT (Bỏ comment khi Đức Anh setup xong Bao):
      const baoRes = await fetch(openbaoInternalUrl, {
        method: 'POST',
        headers: { 'X-Vault-Token': process.env.VAULT_TOKEN || '' },
        body: challengeBuffer
      });
      licenseBuffer = Buffer.from(await baoRes.arrayBuffer());
      */
      
      // TẠM THỜI MOCK LICENSE CHO FRONTEND CHẠY ĐƯỢC (Đức Anh sẽ sửa phần này sau)
      console.log("🔄 Đang giả lập cấp phép Widevine License từ KMS...");
      licenseBuffer = Buffer.from("mock-widevine-license-data-from-backend");

    } catch (baoError) {
      console.error("🚨 Lỗi khi giao tiếp với OpenBao KMS:", baoError);
      return NextResponse.json({ error: 'KMS Service Unavailable' }, { status: 500 });
    }

    // =====================================================================
    // 4. MÃ HÓA ECDH ĐƯỜNG TRUYỀN (Lớp bảo vệ cuối cùng của Tuần 3)
    // =====================================================================
    if (clientPubKeyBase64) {
      console.log("🛡️ Khách hàng có gửi Public Key. Tiến hành bọc gói License bằng thuật toán ECDH.");
      // NOTE DÀNH CHO ĐỨC ANH: 
      // Chỗ này ông sẽ dùng thư viện 'crypto' của Node.js để sinh khóa Server,
      // Tính toán Shared Secret với clientPubKeyBase64, và mã hóa licenseBuffer bằng AES-GCM.
      // Sau đó nhét thêm Server Public Key vào Header trả về.
    }

    // Trả License về cho Shaka Player
    return new NextResponse(licenseBuffer as any, {
      status: 200,
      headers: { 
        'Content-Type': 'application/octet-stream',
        // 'X-Server-Public-Key': serverPubKeyBase64 // (Thêm vào sau khi làm xong thuật toán ECDH)
      }
    });

  } catch (error) {
    console.error("💥 Lỗi Hệ thống API License:", error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}