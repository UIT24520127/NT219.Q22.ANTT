/**
 * Keycloak Admin API Client
 *
 * This module provides utilities for interacting with Keycloak's Admin REST API.
 * It handles:
 * - Getting admin tokens via service-to-service authentication
 * - Creating, updating, deleting users
 * - Managing user roles
 * - Other admin operations
 *
 * Environment variables required:
 *   KEYCLOAK_ISSUER        - Keycloak realm URL (e.g., http://keycloak:8080/realms/drm-realm)
 *   KEYCLOAK_CLIENT_ID     - Service account client ID (e.g., backend-api)
 *   KEYCLOAK_SECRET        - Service account secret (from Keycloak admin console)
 */

import * as jose from 'jose';
import crypto from 'crypto';

// ── Configuration ──────────────────────────────────────────────────────────

const KEYCLOAK_ISSUER = process.env.KEYCLOAK_ISSUER || 'http://keycloak:8080/realms/drm-realm';
const KEYCLOAK_CLIENT_ID = process.env.KEYCLOAK_CLIENT_ID || 'backend-api';
const KEYCLOAK_SECRET = process.env.KEYCLOAK_SECRET;

// Extract base URL and realm from issuer
const [BASE_URL, REALM_NAME] = KEYCLOAK_ISSUER.split('/realms/');

// ── Types ──────────────────────────────────────────────────────────────────

export interface KeycloakUser {
  id?: string;
  username: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  enabled: boolean;
  emailVerified?: boolean;
  credentials?: Array<{
    type: string;
    value: string;
    temporary?: boolean;
  }>;
}

export interface KeycloakRole {
  id?: string;
  name: string;
  description?: string;
  composite?: boolean;
  clientRole?: boolean;
}

export interface AdminApiError {
  status: number;
  message: string;
  body?: string;
}

// ── Admin Token Cache ──────────────────────────────────────────────────────

let cachedToken: string | null = null;
let cachedTokenExpiry: number | null = null;

/**
 * Get admin access token for service-to-service authentication
 * Uses client credentials grant with DPoP (if available) or standard bearer
 */
async function getAdminToken(): Promise<string> {
  // Return cached token if still valid (with 1min buffer)
  if (cachedToken && cachedTokenExpiry && Date.now() < cachedTokenExpiry - 60000) {
    return cachedToken;
  }

  if (!KEYCLOAK_SECRET) {
    throw new Error('KEYCLOAK_SECRET environment variable is not set');
  }

  const tokenEndpoint = `${KEYCLOAK_ISSUER}/protocol/openid-connect/token`;

  // Try to get DPoP keys for enhanced security
  let dpopProof: string | undefined;
  const dpopPrivateJwk = process.env.KEYCLOAK_DPOP_PRIVATE_JWK;

  if (dpopPrivateJwk) {
    try {
      const privateJwk = JSON.parse(dpopPrivateJwk);
      const privateKey = await jose.importJWK(privateJwk, 'ES256');

      // Extract public key
      const { d, ...publicJwk } = privateJwk;
      const publicKeyWithAlg = { ...publicJwk, alg: 'ES256', use: 'sig' };

      // Create DPoP proof
      dpopProof = await new jose.SignJWT({
        jti: crypto.randomUUID(),
        htm: 'POST',
        htu: tokenEndpoint,
      })
        .setProtectedHeader({ alg: 'ES256', typ: 'dpop+jwt', jwk: publicKeyWithAlg })
        .setIssuedAt()
        .setExpirationTime('2m')
        .sign(privateKey);
    } catch (error) {
      console.warn('Failed to create DPoP proof, falling back to standard bearer:', error);
      dpopProof = undefined;
    }
  }

  // Request token
  const params = new URLSearchParams();
  params.append('grant_type', 'client_credentials');
  params.append('client_id', KEYCLOAK_CLIENT_ID);
  params.append('client_secret', KEYCLOAK_SECRET);

  const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded',
  };

  if (dpopProof) {
    headers['DPoP'] = dpopProof;
  }

  const response = await fetch(tokenEndpoint, {
    method: 'POST',
    headers,
    body: params,
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Failed to get admin token: ${response.status} ${body}`);
  }

  const data = await response.json();
  const token = data.access_token;
  if (!token || typeof token !== 'string') {
    throw new Error('Invalid or missing access token in Keycloak response');
  }
  cachedToken = token;
  cachedTokenExpiry = Date.now() + (data.expires_in || 0) * 1000;

  return token;
}

// ── API Helpers ────────────────────────────────────────────────────────────

/**
 * Make an authenticated request to Keycloak Admin API
 */
async function adminApiRequest<T>(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  body?: any
): Promise<T> {
  const token = await getAdminToken();
  const url = `${BASE_URL}/admin/realms/${REALM_NAME}${path}`;

  const response = await fetch(url, {
    method,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  // Handle 204 No Content
  if (response.status === 204) {
    return undefined as T;
  }

  if (!response.ok) {
    const body = await response.text();
    console.error(`Admin API error [${method} ${path}]:`, response.status, body);

    const error: AdminApiError = {
      status: response.status,
      message: `Keycloak Admin API error: ${response.status}`,
      body,
    };

    throw error;
  }

  // Handle empty response
  const text = await response.text();
  if (!text) {
    return undefined as T;
  }

  return JSON.parse(text) as T;
}

// ── User Management ────────────────────────────────────────────────────────

/**
 * Create a new user in Keycloak
 */
export async function createUser(user: KeycloakUser): Promise<{ id: string }> {
  try {
    await adminApiRequest('POST', '/users', user);

    // User created successfully, now get the ID
    const users = await adminApiRequest<KeycloakUser[]>(
      'GET',
      `/users?username=${encodeURIComponent(user.username)}&exact=true`
    );

    if (!users || users.length === 0) {
      throw new Error('User created but could not retrieve ID');
    }

    return { id: users[0].id || '' };
  } catch (error: any) {
    if (error.status === 409) {
      throw new Error(`User '${user.username}' already exists`);
    }
    throw error;
  }
}

/**
 * Get a user by username
 */
export async function getUserByUsername(username: string): Promise<KeycloakUser | null> {
  try {
    const users = await adminApiRequest<KeycloakUser[]>(
      'GET',
      `/users?username=${encodeURIComponent(username)}&exact=true`
    );

    return users && users.length > 0 ? users[0] : null;
  } catch (error) {
    console.error('Error getting user:', error);
    return null;
  }
}

/**
 * Get a user by ID
 */
export async function getUserById(userId: string): Promise<KeycloakUser | null> {
  try {
    return await adminApiRequest<KeycloakUser>('GET', `/users/${userId}`);
  } catch (error) {
    console.error('Error getting user:', error);
    return null;
  }
}

/**
 * List all users
 */
export async function listUsers(
  first?: number,
  max?: number
): Promise<KeycloakUser[]> {
  try {
    const params = new URLSearchParams();
    if (first !== undefined) params.append('first', String(first));
    if (max !== undefined) params.append('max', String(max));

    const query = params.toString() ? `?${params.toString()}` : '';
    return await adminApiRequest<KeycloakUser[]>('GET', `/users${query}`);
  } catch (error) {
    console.error('Error listing users:', error);
    return [];
  }
}

/**
 * Delete a user
 */
export async function deleteUser(userId: string): Promise<void> {
  try {
    await adminApiRequest('DELETE', `/users/${userId}`);
  } catch (error: any) {
    if (error.status === 404) {
      throw new Error(`User '${userId}' not found`);
    }
    throw error;
  }
}

/**
 * Update a user
 */
export async function updateUser(userId: string, updates: Partial<KeycloakUser>): Promise<void> {
  try {
    await adminApiRequest('PUT', `/users/${userId}`, updates);
  } catch (error: any) {
    if (error.status === 404) {
      throw new Error(`User '${userId}' not found`);
    }
    throw error;
  }
}

/**
 * Enable or disable a user
 */
export async function setUserEnabled(userId: string, enabled: boolean): Promise<void> {
  await updateUser(userId, { enabled });
}

/**
 * Get all roles assigned to a user
 */
export async function getUserRoles(userId: string): Promise<KeycloakRole[]> {
  try {
    return await adminApiRequest<KeycloakRole[]>(
      'GET',
      `/users/${userId}/role-mappings/realm`
    );
  } catch (error) {
    console.error('Error getting user roles:', error);
    return [];
  }
}

/**
 * Assign a realm role to a user
 */
export async function grantUserRole(userId: string, roleName: string): Promise<void> {
  try {
    // Get role ID first
    const role = await adminApiRequest<KeycloakRole>(
      'GET',
      `/roles/${roleName}`
    );

    if (!role || !role.id) {
      throw new Error(`Role '${roleName}' not found`);
    }

    // Assign role
    await adminApiRequest('POST', `/users/${userId}/role-mappings/realm`, [role]);
  } catch (error: any) {
    if (error.status === 404) {
      throw new Error(`User or role not found`);
    }
    throw error;
  }
}

/**
 * Revoke a realm role from a user
 */
export async function revokeUserRole(userId: string, roleName: string): Promise<void> {
  try {
    // Get role ID first
    const role = await adminApiRequest<KeycloakRole>(
      'GET',
      `/roles/${roleName}`
    );

    if (!role || !role.id) {
      throw new Error(`Role '${roleName}' not found`);
    }

    // Revoke role
    await adminApiRequest('DELETE', `/users/${userId}/role-mappings/realm`, [role]);
  } catch (error: any) {
    if (error.status === 404) {
      throw new Error(`User or role not found`);
    }
    throw error;
  }
}

/**
 * Check if user has a specific role
 */
export async function userHasRole(userId: string, roleName: string): Promise<boolean> {
  try {
    const roles = await getUserRoles(userId);
    return roles.some(r => r.name === roleName);
  } catch (error) {
    console.error('Error checking user role:', error);
    return false;
  }
}

// ── Role Management ────────────────────────────────────────────────────────

/**
 * Get or create a realm role
 */
export async function ensureRole(roleName: string, description?: string): Promise<KeycloakRole> {
  try {
    // Try to get existing role
    const role = await adminApiRequest<KeycloakRole>(
      'GET',
      `/roles/${roleName}`
    );
    return role;
  } catch (error: any) {
    if (error.status === 404) {
      // Role doesn't exist, create it
      const newRole: KeycloakRole = {
        name: roleName,
        description,
        composite: false,
      };

      await adminApiRequest('POST', '/roles', newRole);

      // Get the created role
      return await adminApiRequest<KeycloakRole>(
        'GET',
        `/roles/${roleName}`
      );
    }
    throw error;
  }
}

/**
 * List all realm roles
 */
export async function listRoles(): Promise<KeycloakRole[]> {
  try {
    return await adminApiRequest<KeycloakRole[]>('GET', '/roles');
  } catch (error) {
    console.error('Error listing roles:', error);
    return [];
  }
}

/**
 * Delete a role
 */
export async function deleteRole(roleName: string): Promise<void> {
  try {
    await adminApiRequest('DELETE', `/roles/${roleName}`);
  } catch (error: any) {
    if (error.status === 404) {
      throw new Error(`Role '${roleName}' not found`);
    }
    throw error;
  }
}
