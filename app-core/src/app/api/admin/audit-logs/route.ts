export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminAccess, forbiddenResponse } from '@/lib/auth/admin';
import { getAuditLogs } from '@/lib/track-db';

export async function GET(request: NextRequest) {
  try {
    const adminVerification = await verifyAdminAccess(request);
    if (!adminVerification.valid) {
      console.warn(`⚠️  [Audit Logs API] Unauthorized access attempt: ${adminVerification.error}`);
      return forbiddenResponse(adminVerification.error || 'Unauthorized');
    }

    const logs = await getAuditLogs(100);
    return NextResponse.json({
      success: true,
      data: logs,
    });
  } catch (error: any) {
    console.error('❌ [Audit Logs API] Error fetching logs:', error.message);
    return NextResponse.json(
      { error: 'Failed to retrieve audit logs', details: error.message },
      { status: 500 }
    );
  }
}
