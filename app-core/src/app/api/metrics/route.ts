import { NextResponse } from 'next/server';
import { register } from 'prom-client';

/**
 * GET /api/metrics
 * Returns metrics in Prometheus format
 * This endpoint should be scraped by Prometheus
 */
export async function GET() {
  try {
    const metrics = await register.metrics();
    return new NextResponse(metrics, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
      },
    });
  } catch (error) {
    console.error('Error generating metrics:', error);
    return NextResponse.json(
      { error: 'Failed to generate metrics' },
      { status: 500 }
    );
  }
}

// Disable caching for metrics endpoint
export const revalidate = 0;
