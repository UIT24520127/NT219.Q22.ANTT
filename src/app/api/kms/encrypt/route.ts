import { NextResponse } from 'next/server';
import { kmsService } from '@/lib/kms/bao';
export async function POST(request: Request) {
  try {
    const { cek } = await request.json();

    if (!cek) {
      return NextResponse.json({ error: 'Missing CEK' }, { status: 400 });
    }

    // Gửi sang OpenBao để mã hóa (Dùng khóa music-app-key đã cấu hình) 
    const encryptedCek = await kmsService.encryptKey(cek);

    return NextResponse.json({ encryptedCek });
  } catch (error) {
    console.error('KMS Encryption Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}