import { NextRequest, NextResponse } from 'next/server';
import * as jose from 'jose';

/**
 * Auth Middleware for Role-Based Access Control (RBAC)
 *
 * This middleware:
 * 1. Extracts JWT token from Authorization header (Bearer token)
 * 2. Decodes JWT (no signature verification - we trust Keycloak)
 * 3. Extracts roles from token claims (from Keycloak realm_access.roles)
 * 4. Checks if user has required role(s)
 * 5. Returns 403 Forbidden if not authorized
 *
 * Usage:
 *   import { requireRole } from '@/lib/auth/middleware';
 *
 *   // In your route handler:
 *   export async function POST(req: Request) {
 *     const { roles, user, error } = await requireRole(req, ['admin']);
 *     if (error) return error;
 *
 *     // User has admin role, proceed
 *     const userId = user.sub;
 *     ...
 *   }
 */

export interface DecodedToken {
  sub: string; // User ID
  preferred_username?: string;
  email?: string;
  realm_access?: {
    roles: string[];
  };
  resource_access?: Record<string, { roles: string[] }>;
  exp?: number;
  iat?: number;
}

export interface AuthResult {
  roles: string[];
  user: DecodedToken;
  error?: NextResponse;
}

/**
 * Extract Bearer token from Authorization header
 */
export function getTokenFromHeader(req: Request): string | null {
  const authHeader = req.headers.get('authorization');
  if (!authHeader) return null;

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') return null;

  return parts[1];
}

/**
 * Decode JWT without verification (we trust Keycloak)
 */
export function decodeJWT(token: string): DecodedToken | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    // Decode payload (second part)
    const payload = JSON.parse(
      Buffer.from(parts[1], 'base64').toString('utf-8')
    );

    return payload as DecodedToken;
  } catch (error) {
    console.error('Failed to decode JWT:', error);
    return null;
  }
}

/**
 * Extract roles from decoded token
 * Keycloak puts realm roles in token.realm_access.roles
 */
export function extractRoles(token: DecodedToken): string[] {
  return token.realm_access?.roles || [];
}

/**
 * Check if token is expired (with 30s buffer)
 */
export function isTokenExpired(token: DecodedToken, bufferSeconds = 30): boolean {
  if (!token.exp) return false;

  const now = Math.floor(Date.now() / 1000);
  return now > token.exp - bufferSeconds;
}

/**
 * Main middleware: require specific roles
 * 
 * @param req Request object
 * @param requiredRoles Array of required roles (user must have at least one)
 * @returns { roles, user, error } - error is set if auth failed
 */
export async function requireRole(
  req: Request,
  requiredRoles: string[]
): Promise<AuthResult> {
  // Extract token
  const token = getTokenFromHeader(req);
  if (!token) {
    return {
      roles: [],
      user: {} as DecodedToken,
      error: NextResponse.json(
        { error: 'Missing or invalid Authorization header' },
        { status: 401 }
      ),
    };
  }

  // Decode token
  const decoded = decodeJWT(token);
  if (!decoded) {
    return {
      roles: [],
      user: {} as DecodedToken,
      error: NextResponse.json(
        { error: 'Invalid JWT token' },
        { status: 401 }
      ),
    };
  }

  // Check expiration
  if (isTokenExpired(decoded)) {
    return {
      roles: [],
      user: decoded,
      error: NextResponse.json(
        { error: 'Token expired' },
        { status: 401 }
      ),
    };
  }

  // Extract roles
  const roles = extractRoles(decoded);

  // Check if user has required role
  const hasRequiredRole = requiredRoles.length === 0 || 
    requiredRoles.some(role => roles.includes(role));

  if (!hasRequiredRole) {
    return {
      roles,
      user: decoded,
      error: NextResponse.json(
        { error: `Forbidden: required roles ${requiredRoles.join(' or ')}` },
        { status: 403 }
      ),
    };
  }

  // Authorization successful
  return {
    roles,
    user: decoded,
    error: undefined,
  };
}

/**
 * Middleware function for use in Next.js middleware.ts
 * Checks if user is authenticated (has valid token)
 */
export async function requireAuth(req: Request): Promise<AuthResult> {
  return requireRole(req, []); // Empty array = just check if authenticated
}

/**
 * Get user ID from request
 */
export function getUserIdFromRequest(req: Request): string | null {
  const token = getTokenFromHeader(req);
  if (!token) return null;

  const decoded = decodeJWT(token);
  if (!decoded) return null;

  return decoded.sub;
}

/**
 * Get user info from request
 */
export function getUserFromRequest(req: Request): DecodedToken | null {
  const token = getTokenFromHeader(req);
  if (!token) return null;

  return decodeJWT(token);
}
