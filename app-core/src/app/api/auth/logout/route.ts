// app/api/auth/logout/route.ts
import { NextResponse } from 'next/server';

export async function POST() {
  const response = NextResponse.json({ ok: true }, { status: 200 });

  // Xóa cả 2 cookie
  response.cookies.set('access_token', '', {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge:   0,
    path:     '/',
  });

  response.cookies.set('refresh_token', '', {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge:   0,
    path:     '/api/auth/refresh',
  });

  return response;
}