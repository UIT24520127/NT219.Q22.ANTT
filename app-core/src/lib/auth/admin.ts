// lib/auth/admin.ts
// ─────────────────────────────────────────────────────────────────────────────
// Verify admin access - check if user has 'admin' role in JWT
// ─────────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server';
import { decodeJWT, JWTPayload } from './token';

export interface AdminPayload extends JWTPayload {
  realm_access?: {
    roles?: string[];
  };
}

/**
 * Extract and decode admin token from Authorization header
 */
export function getAdminTokenFromRequest(request: NextRequest): string | null {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return null;
  }
  return authHeader.slice(7);
}

/**
 * Verify if user has admin role
 */
export function isUserAdmin(token: string): boolean {
  try {
    const payload = decodeJWT(token) as AdminPayload | null;
    if (!payload) return false;

    // Check if user has 'admin' role in realm_access.roles
    const roles = payload.realm_access?.roles || [];
    return roles.includes('admin');
  } catch {
    return false;
  }
}

/**
 * Middleware to verify admin access
 */
export async function verifyAdminAccess(
  request: NextRequest
): Promise<{ valid: boolean; error?: string; payload?: AdminPayload }> {
  const token = getAdminTokenFromRequest(request);

  if (!token) {
    return {
      valid: false,
      error: 'Missing authentication token',
    };
  }

  const payload = decodeJWT(token) as AdminPayload | null;

  if (!payload) {
    return {
      valid: false,
      error: 'Invalid token format',
    };
  }

  // Check if token expired
  if (payload.exp && payload.exp * 1000 < Date.now()) {
    return {
      valid: false,
      error: 'Token expired',
    };
  }

  // Check admin role
  if (!isUserAdmin(token)) {
    return {
      valid: false,
      error: 'User does not have admin role',
    };
  }

  return {
    valid: true,
    payload,
  };
}

/**
 * Helper to return 401 Unauthorized response
 */
export function unauthorizedResponse(message: string = 'Unauthorized') {
  return NextResponse.json(
    { error: message },
    { status: 401 }
  );
}

/**
 * Helper to return 403 Forbidden response
 */
export function forbiddenResponse(message: string = 'Forbidden') {
  return NextResponse.json(
    { error: message },
    { status: 403 }
  );
}
