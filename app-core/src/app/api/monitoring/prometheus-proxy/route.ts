// api/monitoring/prometheus-proxy/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminAccess, forbiddenResponse } from '@/lib/auth/admin';

const PROMETHEUS_URL = process.env.PROMETHEUS_URL || 'http://prometheus:9090';

export async function GET(request: NextRequest) {
  try {
    // Verify admin access
    const adminVerification = await verifyAdminAccess(request);
    if (!adminVerification.valid) {
      return forbiddenResponse(adminVerification.error || 'Unauthorized');
    }

    // Get the path and query parameters
    const path = request.nextUrl.searchParams.get('path') || '/api/v1/targets';
    const queryParams = new URLSearchParams();

    // Copy all query parameters except 'path'
    for (const [key, value] of request.nextUrl.searchParams.entries()) {
      if (key !== 'path') {
        queryParams.append(key, value);
      }
    }

    const prometheusUrl = `${PROMETHEUS_URL}${path}${queryParams.toString() ? '?' + queryParams.toString() : ''}`;

    console.log(`📈 [Monitoring] Proxying Prometheus request: ${path}`);

    const response = await fetch(prometheusUrl, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
    });

    const contentType = response.headers.get('content-type');
    const data = contentType?.includes('application/json')
      ? await response.json()
      : await response.text();

    return new NextResponse(JSON.stringify(data), {
      status: response.status,
      headers: {
        'Content-Type': 'application/json',
        'X-Proxied-By': 'DRM-Admin-Gateway',
      },
    });

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('❌ [Monitoring] Prometheus proxy error:', message);
    return NextResponse.json(
      { error: 'Prometheus proxy failed', details: message },
      { status: 500 }
    );
  }
}
