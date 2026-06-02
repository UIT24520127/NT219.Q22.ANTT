// api/monitoring/grafana-proxy/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminAccess, forbiddenResponse } from '@/lib/auth/admin';

const GRAFANA_URL = process.env.GRAFANA_URL || 'http://grafana:3000';

export async function GET(request: NextRequest) {
  try {
    // Verify admin access
    const adminVerification = await verifyAdminAccess(request);
    if (!adminVerification.valid) {
      return forbiddenResponse(adminVerification.error || 'Unauthorized');
    }

    // Get the path from query parameters
    const path = request.nextUrl.searchParams.get('path') || '';
    const queryString = request.nextUrl.search.replace('?path=', '').replace(/path=[^&]*&?/, '');

    const grafanaUrl = `${GRAFANA_URL}${path}${queryString ? '?' + queryString : ''}`;

    console.log(`📊 [Monitoring] Proxying Grafana request: ${path}`);

    const response = await fetch(grafanaUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${process.env.GRAFANA_API_TOKEN || ''}`,
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
    console.error('❌ [Monitoring] Grafana proxy error:', message);
    return NextResponse.json(
      { error: 'Grafana proxy failed', details: message },
      { status: 500 }
    );
  }
}
