// app/api/tracks/route.ts
// Chỉ xử lý GET danh sách tracks
// Xác thực: HttpOnly cookie → verify JWT → kiểm tra đã đăng nhập
// Cả 2 role đều xem được (uploader xem list của mình, listener xem để play)

export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import * as jose from 'jose';
import {
  getTrackById,
  getAllTracks,
  getActiveManifest,
} from '@/lib/track-db';

// ── JWKS cache ────────────────────────────────────────────────────────────────
let _jwks: ReturnType<typeof jose.createRemoteJWKSet> | null = null;
function getJWKS() {
  if (!_jwks) {
    const issuer = process.env.KEYCLOAK_ISSUER || 'http://keycloak:8080/auth/realms/drm-realm';
    _jwks = jose.createRemoteJWKSet(
      new URL(`${issuer}/protocol/openid-connect/certs`)
    );
  }
  return _jwks;
}

async function verifyTokenFromCookie(req: NextRequest): Promise<{
  valid: boolean;
  payload?: jose.JWTPayload;
  error?: string;
}> {
  const token = req.cookies.get('access_token')?.value;
  if (!token) return { valid: false, error: 'Không có access_token cookie' };

  try {
    const issuer = process.env.KEYCLOAK_ISSUER || 'http://keycloak:8080/auth/realms/drm-realm';
    const { payload } = await jose.jwtVerify(token, getJWKS(), { issuer });
    return { valid: true, payload };
  } catch (err: any) {
    return { valid: false, error: err.message };
  }
}

// ── GET: Lấy danh sách tracks hoặc 1 track theo ID ───────────────────────────
export async function GET(request: NextRequest) {
  try {
    // Xác thực — phải đăng nhập, không cần role cụ thể
    const authResult = await verifyTokenFromCookie(request);
    if (!authResult.valid) {
      return NextResponse.json(
        { error: 'Unauthorized', detail: authResult.error },
        { status: 401 }
      );
    }

    const trackId = request.nextUrl.searchParams.get('trackId');

    // ── Chế độ 1: Lấy 1 track theo ID ────────────────────────────────────
    if (trackId) {
      const track = await getTrackById(trackId);
      if (!track) {
        return NextResponse.json({ error: 'Track not found' }, { status: 404 });
      }

      const manifest = await getActiveManifest(trackId);
      return NextResponse.json({
        success: true,
        data: {
          track: {
            id:           track.id,
            filename:     track.filename,
            duration:     track.duration ?? 0,
            kid:          track.kid,
            sourceFormat: track.source_format,
            createdAt:    track.created_at,
          },
          manifest: manifest
            ? { mpdPath: manifest.mpd_path, createdAt: manifest.created_at }
            : null,
        },
      });
    }

    // ── Chế độ 2: Lấy toàn bộ tracks ─────────────────────────────────────
    const tracks = await getAllTracks();
    return NextResponse.json({
      success: true,
      data: tracks.map(t => ({
        id:           t.id,
        filename:     t.filename,
        duration:     t.duration ?? 0,
        kid:          t.kid,
        sourceFormat: t.source_format,
        createdAt:    t.created_at,
      })),
    });

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('❌ [Tracks] Error in GET:', message);
    return NextResponse.json({ error: 'Failed to retrieve tracks' }, { status: 500 });
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    headers: {
      'Access-Control-Allow-Origin':  '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    },
  });
}