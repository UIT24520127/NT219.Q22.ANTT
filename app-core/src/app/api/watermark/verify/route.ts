// GET /api/watermark/verify?payload=<32-hex>
// Nhận payload từ "audiowmark get <file>", trả về thông tin bài hát từ DB.

import { NextRequest, NextResponse } from 'next/server';
import { getTrackByWatermarkPayload, logAuditEvent } from '@/lib/track-db';

export async function GET(req: NextRequest) {
  const payload = req.nextUrl.searchParams.get('payload')?.toLowerCase().trim();

  if (!payload || !/^[0-9a-f]{32}$/.test(payload)) {
    return NextResponse.json(
      { verified: false, error: 'payload phải là 32-char hex (output từ: audiowmark get <file>)' },
      { status: 400 },
    );
  }

  const track = await getTrackByWatermarkPayload(payload);

  if (!track) {
    return NextResponse.json(
      { verified: false, error: 'Không tìm thấy bài hát với watermark này' },
      { status: 404 },
    );
  }

  try {
    await logAuditEvent('WATERMARK_VERIFIED', track.id, track.kid, 'PUBLIC', payload);
  } catch { /* non-critical */ }

  return NextResponse.json({
    verified:  true,
    platform:  'UITify — Nền tảng nghe nhạc',
    trackId:   track.id,
    title:     track.title ?? track.filename.replace(/\.[^.]+$/, ''),
    filename:  track.filename,
    uploadedBy: track.uploader_id ?? 'unknown',
    uploadedAt: track.created_at instanceof Date
                  ? track.created_at.toISOString()
                  : String(track.created_at),
    kid:       track.kid,
    watermarkPayload: payload,
  }, { headers: { 'Cache-Control': 'no-store' } });
}
