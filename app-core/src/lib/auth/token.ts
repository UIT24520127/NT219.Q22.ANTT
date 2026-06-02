// lib/auth/token.ts
// ─────────────────────────────────────────────────────────────────────────────
// Helper dùng chung cho login/register page và bất kỳ component nào cần token.
// ─────────────────────────────────────────────────────────────────────────────

export interface JWTPayload {
    sub: string;
    email?: string;
    preferred_username?: string;
    realm_access?: {
      roles: string[];
    };
    exp: number;
    iat: number;
    [key: string]: unknown;
  }
  
  // ── Decode JWT (không verify signature — chỉ dùng client-side) ───────────────
  export function decodeJWT(token: string): JWTPayload | null {
    try {
      const part = token.split('.')[1];
      if (!part) return null;
      const json = atob(part.replace(/-/g, '+').replace(/_/g, '/'));
      return JSON.parse(json) as JWTPayload;
    } catch {
      return null;
    }
  }
  
  // ── Kiểm tra token còn hạn không (buffer 30s) ────────────────────────────────
  export function isTokenExpired(token: string): boolean {
    const payload = decodeJWT(token);
    if (!payload) return true;
    return payload.exp * 1000 < Date.now() + 30_000;
  }
  
  // ── Lấy token từ localStorage ─────────────────────────────────────────────────
  export function getStoredToken(): string | null {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem('token');
  }
  
  export function getStoredRefreshToken(): string | null {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem('refresh_token');
  }
  
  // ── Lưu token vào localStorage ────────────────────────────────────────────────
  export function storeTokens(accessToken: string, refreshToken?: string) {
    localStorage.setItem('token', accessToken);
    if (refreshToken) localStorage.setItem('refresh_token', refreshToken);
  }
  
  // ── Xóa token (logout) ────────────────────────────────────────────────────────
  export function clearTokens() {
    localStorage.removeItem('token');
    localStorage.removeItem('refresh_token');
  }
  
  // ── Tự động refresh token khi gần hết hạn ────────────────────────────────────
  // Gọi API /api/auth/refresh, cập nhật localStorage.
  // Trả về access token mới, hoặc null nếu refresh thất bại.
  export async function refreshAccessToken(): Promise<string | null> {
    const refreshToken = getStoredRefreshToken();
    if (!refreshToken) return null;
  
    try {
      const res = await fetch('/api/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refreshToken }),
      });
  
      if (!res.ok) {
        clearTokens();
        return null;
      }
  
      const data = await res.json();
      storeTokens(data.access_token, data.refresh_token);
      return data.access_token;
    } catch {
      return null;
    }
  }
  
  // ── Lấy token hợp lệ (tự refresh nếu cần) ────────────────────────────────────
  // Dùng thay thế getStoredToken() ở mọi nơi cần gọi API.
  export async function getValidToken(): Promise<string | null> {
    const token = getStoredToken();
    if (!token) return null;
    if (!isTokenExpired(token)) return token;
    return refreshAccessToken();
  }

  // ── Lấy user info từ token ────────────────────────────────────────────────────
  export function getUserInfo(): JWTPayload | null {
    const token = getStoredToken();
    if (!token) return null;
    return decodeJWT(token);
  }

  // ── Lấy danh sách roles của user ──────────────────────────────────────────────
  export function getUserRoles(): string[] {
    const user = getUserInfo();
    return user?.realm_access?.roles || [];
  }

  // ── Kiểm tra user có role nào không ───────────────────────────────────────────
  export function hasRole(role: string): boolean {
    const roles = getUserRoles();
    return roles.includes(role);
  }

  // ── Kiểm tra user có ít nhất một trong các role ───────────────────────────────
  export function hasAnyRole(roles: string[]): boolean {
    const userRoles = getUserRoles();
    return roles.some(role => userRoles.includes(role));
  }

  // ── Kiểm tra user có đủ tất cả các role ───────────────────────────────────────
  export function hasAllRoles(roles: string[]): boolean {
    const userRoles = getUserRoles();
    return roles.every(role => userRoles.includes(role));
  }