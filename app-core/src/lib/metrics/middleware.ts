import { NextRequest, NextResponse } from 'next/server';
import { httpRequestDuration, httpErrors } from '../metrics';

/**
 * HTTP Metrics Middleware
 *
 * Tracks request duration and error status for all routes.
 * 
 * Usage in route handler:
 *   export async function GET(req: Request) {
 *     return withMetrics(req, async () => {
 *       // your handler logic
 *     });
 *   }
 */

export async function withMetrics(
  req: NextRequest,
  handler: () => Promise<Response>
): Promise<Response> {
  const method = req.method;
  const url = new URL(req.url);
  
  // Extract route pattern (e.g., /api/admin/users/[userId])
  // For now, we'll use a simplified path (without the full pattern)
  let route = url.pathname;
  
  // Mask dynamic segments for grouping
  // /api/admin/users/abc123 → /api/admin/users/[id]
  if (route.includes('/api/')) {
    const parts = route.split('/');
    for (let i = 0; i < parts.length; i++) {
      // Simple heuristic: if segment looks like a UUID or long ID, mask it
      if (parts[i] && parts[i].length > 20 && /^[a-f0-9\-]+$/i.test(parts[i])) {
        parts[i] = '[id]';
      }
    }
    route = parts.join('/');
  }

  const startTime = Date.now();

  try {
    const response = await handler();
    const duration = (Date.now() - startTime) / 1000;
    const status = response.status;

    // Record duration
    httpRequestDuration
      .labels(method, route, String(status))
      .observe(duration);

    // Record errors (4xx, 5xx)
    if (status >= 400) {
      httpErrors
        .labels(method, route, String(status))
        .inc();
    }

    return response;
  } catch (error) {
    const duration = (Date.now() - startTime) / 1000;
    const status = 500;

    httpRequestDuration
      .labels(method, route, String(status))
      .observe(duration);

    httpErrors
      .labels(method, route, String(status))
      .inc();

    throw error;
  }
}

/**
 * Simpler wrapper for use in Next.js route handlers
 * 
 * export async function POST(req: NextRequest) {
 *   return recordMetric(req, async () => {
 *     // your logic
 *     return NextResponse.json({ success: true });
 *   });
 * }
 */
export async function recordMetric(
  req: NextRequest,
  handler: () => Promise<Response>
): Promise<Response> {
  return withMetrics(req, handler);
}
