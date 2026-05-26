import { NextResponse } from 'next/server';
import { healthCheckMTLS } from '@/lib/security/mtls';

/**
 * GET /api/health
 * Health check endpoint for monitoring and load balancer verification
 */
export async function GET() {
  try {
    const mtlsStatus = healthCheckMTLS();

    return NextResponse.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      services: {
        api: 'running',
        mtls: mtlsStatus.status,
        r2: process.env.R2_BUCKET_NAME ? 'configured' : 'not-configured',
        kms: process.env.BAO_ADDR ? 'configured' : 'not-configured',
      },
      details: {
        mtlsCertificates: mtlsStatus.details,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      {
        status: 'error',
        message,
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}
