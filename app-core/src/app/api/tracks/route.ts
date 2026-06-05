// app/api/tracks/route.ts
// Trả danh sách tracks — yêu cầu đăng nhập (cả 2 role đều xem được).
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import * as jose from 'jose';
import {
  getTrackById,
  getAllTracks,
  getActiveManifest,
} from '@/lib/track-db';

let _jwks: ReturnType<typeof jose.createRemoteJWKSet> | null = null;
function getJWKS() {
  if (!_jwks) {
    const issuer = process.env.KEYCLOAK_ISSUER || 'http://keycloak:8080/realms/drm-realm';
    _jwks = jose.createRemoteJWKSet(new URL(`${issuer}/protocol/openid-connect/certs`));
  }
  return _jwks;
}

// ── GET /api/tracks ───────────────────────────────────────────────────────────
export async function GET(request: NextRequest) {
  // ── Auth ────────────────────────────────────────────────────────────────────
  const token = request.cookies.get('access_token')?.value;
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const issuer = process.env.KEYCLOAK_ISSUER || 'http://keycloak:8080/realms/drm-realm';
    await jose.jwtVerify(token, getJWKS(), { issuer });
  } catch {
    return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
  }

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