// middleware.ts — đặt ở app-core/middleware.ts (cùng cấp với app/)
import { NextRequest, NextResponse } from 'next/server';
import * as jose from 'jose';

// ── Cấu hình route rules ──────────────────────────────────────────────────────
const ROUTE_RULES: Record<string, string[]> = {
  '/player': ['music_listener'],
  '/upload': ['music_uploader'],
};

// Cache JWKS
let _jwks: ReturnType<typeof jose.createRemoteJWKSet> | null = null;
function getJWKS(issuer: string) {
  if (!_jwks) {
    _jwks = jose.createRemoteJWKSet(
      new URL(`${issuer}/protocol/openid-connect/certs`)
    );
  }
  return _jwks;
}

async function verifyToken(token: string, issuer: string): Promise<string[]> {
  try {
    const { payload } = await jose.jwtVerify(token, getJWKS(issuer), { issuer });
    const roles = (payload as any)?.realm_access?.roles ?? [];
    return roles;
  } catch {
    return [];
  }
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Tìm rule khớp
  const matchedRoute = Object.keys(ROUTE_RULES).find(route =>
    pathname === route || pathname.startsWith(route + '/')
  );

  if (!matchedRoute) return NextResponse.next();

  const requiredRoles = ROUTE_RULES[matchedRoute];
  const token         = req.cookies.get('access_token')?.value;
  const issuer        = process.env.KEYCLOAK_ISSUER || 'http://keycloak:8080/realms/drm-realm';

  // Chưa đăng nhập
  if (!token) {
    const loginUrl = new URL('/login', req.url);
    loginUrl.searchParams.set('returnTo', pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Verify và lấy roles
  const userRoles = await verifyToken(token, issuer);

  // Token hết hạn (roles rỗng do verify thất bại)
  if (userRoles.length === 0) {
    // Thử redirect về /api/auth/refresh không được từ middleware
    // → Về login, client sẽ tự refresh
    const loginUrl = new URL('/login', req.url);
    loginUrl.searchParams.set('returnTo', pathname);
    loginUrl.searchParams.set('reason', 'expired');
    return NextResponse.redirect(loginUrl);
  }

  // Có token nhưng sai role
  const hasRole = requiredRoles.some(r => userRoles.includes(r));
  if (!hasRole) {
    return NextResponse.redirect(new URL('/403', req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/player/:path*',
    '/upload/:path*',
  ],
};