// app/api/tracks/route.ts
// Public — trả danh sách tracks (tên, KID, duration).
// Audio thật được bảo vệ bởi /api/media/proxy (auth) + /api/license (DPoP).
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import {
  getTrackById,
  getAllTracks,
  getActiveManifest,
} from '@/lib/track-db';

// ── GET /api/tracks ───────────────────────────────────────────────────────────
export async function GET(request: NextRequest) {
  try {
    const trackId = request.nextUrl.searchParams.get('trackId');

    // ── Chế độ 1: Lấy 1 track theo ID ────────────────────────────────────
    if (trackId) {
      const track = await getTrackById(trackId);
      if (!track) return NextResponse.json({ error: 'Track not found' }, { status: 404 });

      const manifest = await getActiveManifest(trackId);
      return NextResponse.json({
        success: true,
        data: {
          track: {
            id: track.id,
            filename: track.filename,
            duration: track.duration ?? 0,
            kid: track.kid,
            sourceFormat: track.source_format,
            createdAt: track.created_at,
          },
          manifest: manifest ? { mpdPath: manifest.mpd_path, createdAt: manifest.created_at } : null,
        },
      });
    }

    // ── Chế độ 2: Lấy toàn bộ tracks (homepage) ──────────────────────────
    const tracks = await getAllTracks();
    return NextResponse.json({
      success: true,
      data: tracks.map(t => ({
        id: t.id,
        filename: t.filename,
        duration: t.duration ?? 0,
        kid: t.kid,
        sourceFormat: t.source_format,
        createdAt: t.created_at,
      })),
    });

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('❌ [Ingest] Error in GET:', message);
    return NextResponse.json({ error: 'Failed to retrieve track info' }, { status: 500 });
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    },
  });
}