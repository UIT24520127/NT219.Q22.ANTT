// lib/auth/token.ts
// Token được lưu trong HttpOnly Cookie — JS không đọc được trực tiếp.
// Mọi thao tác với token đều thông qua API route server-side.

export interface JWTPayload {
  sub: string;
  email?: string;
  preferred_username?: string;
  realm_access?: { roles: string[] };
  exp: number;
  iat: number;
  [key: string]: unknown;
}

// ── Decode JWT (chỉ dùng với token server trả về trực tiếp, ví dụ khi login) ──
export function decodeJWT(token: string): JWTPayload | null {
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    return JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/')));
  } catch {
    return null;
  }
}

// ── Lấy thông tin user hiện tại từ server ─────────────────────────────────────
// Server đọc HttpOnly cookie, verify với Keycloak JWKS, trả payload.
export async function getCurrentUser(): Promise<JWTPayload | null> {
  try {
    let res = await fetch('/api/auth/me', { credentials: 'include' });
    if (res.status === 401) {
      const refreshed = await refreshAccessToken();
      if (!refreshed) return null;
      res = await fetch('/api/auth/me', { credentials: 'include' });
    }
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

// ── Lấy role từ user payload ──────────────────────────────────────────────────
export function getRoleFromPayload(payload: JWTPayload | null): string | null {
  const roles = payload?.realm_access?.roles ?? [];
  if (roles.includes('music_uploader')) return 'music_uploader';
  if (roles.includes('music_listener')) return 'music_listener';
  return null;
}

// ── Redirect URL theo role ────────────────────────────────────────────────────
export function getRedirectByRole(role: string | null): string {
  if (role === 'music_uploader') return '/upload';
  if (role === 'music_listener') return '/player';
  return '/login';
}

// ── Trigger refresh — server tự đọc refresh_token cookie ─────────────────────
export async function refreshAccessToken(): Promise<boolean> {
  try {
    const res = await fetch('/api/auth/refresh', {
      method: 'POST',
      credentials: 'include',
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ── Logout — server xóa cookie ────────────────────────────────────────────────
export async function logout(): Promise<void> {
  await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
  window.location.href = '/login';
}