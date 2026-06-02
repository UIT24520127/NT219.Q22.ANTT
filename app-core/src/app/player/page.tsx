"use client";
import React, { useEffect, useRef, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

/**
 * Secure Audio Player — NT219 Cryptography Project, UIT
 *
 * Luồng bảo mật:
 *  1. Auth guard   — JWT token từ localStorage, kiểm tra exp trước khi render
 *  2. DPoP proof   — ECDSA P-256, ràng buộc token với keypair của tab hiện tại
 *  3. ECDH X25519  — Client tạo ephemeral keypair, gửi public key lên server
 *  4. License API  — Server trả về CEK đã wrap bằng ECDH shared secret + HKDF + AES-GCM
 *  5. CEK unwrap   — Client decrypt CEK từ wrappedCek (AES-256-GCM)
 *  6. Shaka EME    — ClearKey DRM, inject key qua clearKeys config + response filter
 *  7. Media proxy  — Mọi request DASH (MPD + segment) đi qua /api/media/proxy
 *                    Server-side fetch R2 với signed URL → browser không bao giờ thấy R2 domain
 *
 * Tại sao dùng cả clearKeys config + response filter (bước 6)?
 *  - clearKeys config: Shaka v4+ cần biết key trước khi tạo EME session
 *  - response filter: override license JSON Shaka tự build từ pssh trong MPD
 *  - KID được cung cấp ở 3 format (hex, UUID, base64url) vì Shaka các version
 *    handle format khác nhau; Shaka v5.x dùng base64url theo W3C ClearKey spec
 *
 * R2 bucket structure:
 *  audio/{trackId}/manifest.mpd
 *  audio/{trackId}/init.mp4
 *  audio/{trackId}/segment_N.m4s
 */

// ── Global keypairs (tồn tại suốt lifecycle tab) ──────────────────────────────
let globalECDHKeyPair: CryptoKeyPair | null = null;
let globalECDHPublicKeyHex = "";
let globalDPoPKeyPair: CryptoKeyPair | null = null;
let globalDPoPPublicJWK: JsonWebKey | null = null;

// ── Helpers ───────────────────────────────────────────────────────────────────
function base64urlEncode(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let binary = '';
  bytes.forEach(b => (binary += String.fromCharCode(b)));
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function hexToBase64url(hex: string): string {
  const bytes = hex.match(/.{1,2}/g)!.map(b => parseInt(b, 16));
  const binary = String.fromCharCode(...bytes);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function cekHexToBase64url(hex: string): string {
  const bytes = hex.match(/.{1,2}/g)!.map(b => parseInt(b, 16));
  const binary = String.fromCharCode(...bytes);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

// Fix: trả về ArrayBuffer trực tiếp để tương thích với Web Crypto API
function hexToBuffer(hex: string): ArrayBuffer {
  const bytes = new Uint8Array(hex.match(/.{1,2}/g)!.map(b => parseInt(b, 16)));
  return bytes.buffer.slice(0) as ArrayBuffer;
}

async function createDPoPProof(htm: string, htu: string, accessToken: string): Promise<string> {
  if (!globalDPoPKeyPair || !globalDPoPPublicJWK) throw new Error('DPoP keypair chưa khởi tạo');
  const ath = base64urlEncode(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(accessToken))
  );
  const header = { alg: 'ES256', typ: 'dpop+jwt', jwk: globalDPoPPublicJWK };
  const payload = {
    jti: crypto.randomUUID(),
    htm: htm.toUpperCase(),
    htu: htu.replace(/\/$/, ''),
    iat: Math.floor(Date.now() / 1000),
    ath,
  };
  const sigInput =
    `${base64urlEncode(new TextEncoder().encode(JSON.stringify(header)))}` +
    `.${base64urlEncode(new TextEncoder().encode(JSON.stringify(payload)))}`;
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: { name: 'SHA-256' } },
    globalDPoPKeyPair.privateKey,
    new TextEncoder().encode(sigInput)
  );
  return `${sigInput}.${base64urlEncode(sig)}`;
}

// ── R2 Proxy URL helper ───────────────────────────────────────────────────────
// Mọi request media đều đi qua /api/media/proxy (server-side fetch R2)
// R2 structure: encrypted-audio/audio/{trackId}/manifest.mpd
//                                audio/{trackId}/segment_N.m4s
function getProxyUrl(r2Key: string): string {
  return `/api/media/proxy?key=${encodeURIComponent(r2Key)}`;
}

// Chuyển URL Shaka request → R2 key (có prefix "audio/")
// Input examples:
//   /r2/encrypted-audio/63721051.../manifest.mpd
//   /api/media/proxy?key=63721051.../segment_1.m4s  (Shaka resolve relative từ MPD)
//   https://localhost/api/media/proxy?key=63721051.../init.mp4
function urlToR2Key(url: string, trackId: string): string {
  try {
    const parsed = new URL(url, window.location.origin);
    const keyParam = parsed.searchParams.get('key');
    if (keyParam) {
      return keyParam.startsWith('audio/') ? keyParam : `audio/${keyParam}`;
    }
    const filename = parsed.pathname.split('/').pop()?.split('?')[0];
    if (filename && /\.(m4s|mp4|m4a|mpd)$/.test(filename)) {
      return `audio/${trackId}/${filename}`;
    }
  } catch {
    const filename = url.split('/').pop()?.split('?')[0] || 'manifest.mpd';
    return `audio/${trackId}/${filename}`;
  }
  return `audio/${trackId}/manifest.mpd`;
}

// ─────────────────────────────────────────────────────────────────────────────

function PlayerInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [isPlaying, setIsPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusLog, setStatusLog] = useState('Hệ thống sẵn sàng...');
  const [currentTime, setCurrentTime] = useState('0:00');
  const [duration, setDuration] = useState('0:00');
  const [volume, setVolume] = useState(1.0);
  const [isLoadingStream, setIsLoadingStream] = useState(false);
  const [songTitle, setSongTitle] = useState('Đang tải dữ liệu...');
  const [trackId, setTrackId] = useState('');
  const [targetKID, setTargetKID] = useState('');

  const videoRef = useRef<HTMLVideoElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const shakaPlayerRef = useRef<any>(null);

  const formatTime = (secs: number) => {
    if (isNaN(secs) || secs === Infinity) return '0:00';
    return `${Math.floor(secs / 60)}:${String(Math.floor(secs % 60)).padStart(2, '0')}`;
  };

  // ── Auth guard ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const returnUrl = window.location.pathname + window.location.search;
 
    (async () => {
      // Import từ token.ts — tự refresh nếu gần hết hạn
      const { getValidToken, clearTokens } = await import('@/lib/auth/token');
      const token = await getValidToken();
 
      if (!token) {
        clearTokens();
        router.replace(`/login?returnTo=${encodeURIComponent(returnUrl)}`);
      }
    })();
  }, [router]);

  // ── Load metadata ───────────────────────────────────────────────────────────
  useEffect(() => {
    const id = searchParams.get('trackId') || '';
    if (!id) return;
    setTrackId(id);
    (async () => {
      try {
        setStatusLog('🔍 Đang truy vấn metadata...');
        const { getValidToken } = await import('@/lib/auth/token');
        const metaToken = await getValidToken();
        const res = await fetch(`/api/ingest/upload?trackId=${id}`, {
          headers: { 'Authorization': `Bearer ${metaToken || ''}` }
        });
        if (!res.ok) throw new Error('Không tìm thấy bài hát');
        const json = await res.json();
        setSongTitle(json.data.track.filename);
        setTargetKID(json.data.track.kid);
        setStatusLog('✅ Metadata nạp xong.');
      } catch (e: any) {
        setError('Lỗi metadata: ' + e.message);
      }
    })();
  }, [searchParams]);

  // ── Init crypto keypairs ────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        if (!globalECDHKeyPair) {
          setStatusLog('🔑 Khởi tạo X25519 keypair...');
          globalECDHKeyPair = await crypto.subtle.generateKey(
            { name: 'X25519' }, true, ['deriveKey', 'deriveBits']
          ) as CryptoKeyPair;
          const raw = await crypto.subtle.exportKey('raw', globalECDHKeyPair.publicKey);
          globalECDHPublicKeyHex = Array.from(new Uint8Array(raw))
            .map(b => b.toString(16).padStart(2, '0')).join('');
        }
        if (!globalDPoPKeyPair) {
          setStatusLog('🛡️ Khởi tạo DPoP keypair...');
          globalDPoPKeyPair = await crypto.subtle.generateKey(
            { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']
          );
          globalDPoPPublicJWK = await crypto.subtle.exportKey('jwk', globalDPoPKeyPair.publicKey);
          if (globalDPoPPublicJWK && 'd' in globalDPoPPublicJWK)
            delete (globalDPoPPublicJWK as any).d;
        }
        setStatusLog('✅ Crypto sẵn sàng (ECDH + DPoP).');
      } catch (e: any) {
        setError('Lỗi khởi tạo crypto: ' + e.message);
      }
    })();
  }, []);

  // ── Time tracking ───────────────────────────────────────────────────────────
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onTime = () => setCurrentTime(formatTime(v.currentTime));
    const onMeta = () => {
      if (v.duration && v.duration !== Infinity) setDuration(formatTime(v.duration));
    };
    v.addEventListener('timeupdate', onTime);
    v.addEventListener('loadedmetadata', onMeta);
    return () => {
      v.removeEventListener('timeupdate', onTime);
      v.removeEventListener('loadedmetadata', onMeta);
    };
  }, []);

  // ── playSong ────────────────────────────────────────────────────────────────
  const playSong = async () => {
    if (!trackId || !targetKID) { setError('Chưa nạp dữ liệu bài hát!'); return; }
    if (!globalECDHKeyPair || !globalDPoPKeyPair) { setError('Crypto chưa sẵn sàng!'); return; }

    setError(null);
    setIsLoadingStream(true);

    try {
      const rawToken = localStorage.getItem('token') || '';
      const licenseUrl = `${window.location.origin}/api/license`;

      // ── 1. DPoP proof + /api/license ─────────────────────────────────────
      setStatusLog('🛡️ Đang tạo DPoP proof...');
      const dpopProof = await createDPoPProof('POST', licenseUrl, rawToken);

      setStatusLog('📡 Đang thực hiện ECDH key exchange...');
      const licenseRes = await fetch(licenseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${rawToken}`,
          'DPoP': dpopProof,
          'x-kid': targetKID,
          'x-client-public-key': globalECDHPublicKeyHex,
        },
        body: JSON.stringify({}),
      });

      if (!licenseRes.ok) {
        const errText = await licenseRes.text().catch(() => '');
        throw new Error(`License API lỗi ${licenseRes.status}: ${errText}`);
      }

      const responseBuf = new Uint8Array(await licenseRes.arrayBuffer());
      const payloadLen = new DataView(responseBuf.buffer).getUint32(0, false);
      const licenseData = JSON.parse(
        new TextDecoder().decode(responseBuf.slice(4, 4 + payloadLen))
      );

      // ── 2. X25519 unwrap CEK ──────────────────────────────────────────────
      setStatusLog('🔓 Đang giải mã CEK qua X25519...');

      const serverPubKey = await crypto.subtle.importKey(
        'raw', hexToBuffer(licenseData.serverPublicKey),
        { name: 'X25519' }, false, []
      );

      const sharedBits = await crypto.subtle.deriveBits(
        { name: 'X25519', public: serverPubKey },
        globalECDHKeyPair.privateKey, 256
      );

      const hkdfKey = await crypto.subtle.importKey(
        'raw', sharedBits, { name: 'HKDF' }, false, ['deriveBits']
      );
      const aesKeyBuf = await crypto.subtle.deriveBits(
        {
          name: 'HKDF',
          hash: 'SHA-256',
          salt: new Uint8Array(0),
          info: new TextEncoder().encode('cek-wrapping-v1'),
        },
        hkdfKey, 256
      );
      const aesKey = await crypto.subtle.importKey(
        'raw', aesKeyBuf, { name: 'AES-GCM' }, false, ['decrypt']
      );

      const cekBuf = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: hexToBuffer(licenseData.iv), tagLength: 128 },
        aesKey,
        hexToBuffer(licenseData.wrappedCek)
      );

      const cekHex = Array.from(new Uint8Array(cekBuf))
        .map(b => b.toString(16).padStart(2, '0')).join('');

      // ── 3. Khởi tạo Shaka Player ──────────────────────────────────────────
      setStatusLog('🎬 Đang khởi tạo Shaka Player...');
      const shaka = await import('shaka-player');
      shaka.default.polyfill.installAll();

      if (!shaka.default.Player.isBrowserSupported()) {
        throw new Error('Browser không hỗ trợ Shaka Player');
      }

      if (shakaPlayerRef.current) {
        await shakaPlayerRef.current.destroy();
        shakaPlayerRef.current = null;
      }

      const player = new shaka.default.Player();
      await player.attach(videoRef.current!);
      shakaPlayerRef.current = player;

      // ── 3b. ClearKey config + response filter ────────────────────────────
      const kidHex = licenseData.kid.replace(/-/g, '').toLowerCase();
      const kidUuid = licenseData.kid.toLowerCase();
      const kidB64 = hexToBase64url(kidHex);
      const cekB64 = cekHexToBase64url(cekHex);

      // Thử tất cả format KID vì các Shaka version khác nhau expect khác nhau
      player.configure({
        drm: {
          clearKeys: {
            [kidHex]: cekHex,    // hex thuần (Shaka >= 4.3)
            [kidUuid]: cekHex,   // UUID với dashes
            [kidB64]: cekB64,    // base64url (W3C ClearKey spec)
          },
        },
      });

      // Response filter: override license JSON Shaka tự build từ MPD
      const licenseJson = JSON.stringify({
        keys: [{ kty: 'oct', kid: kidB64, k: cekB64 }],
        type: 'temporary',
      });
      player.getNetworkingEngine()?.registerResponseFilter(
        (type: number, response: any) => {
          if (type !== 5) return;
          response.data = new TextEncoder().encode(licenseJson).buffer;
        }
      );

      // ── 4. Network filter: MANIFEST + SEGMENT → proxy /api/media/proxy ───
      player.getNetworkingEngine()?.registerRequestFilter(
        async (type: number, request: any) => {
          // type 5 = LICENSE → Shaka fetch data: URI, không cần proxy
          if (type === 5) return;
          if (request.uris[0]?.startsWith('data:')) return;
 
          // Luôn lấy token mới nhất — tự refresh nếu gần hết hạn
          const { getValidToken, clearTokens } = await import('@/lib/auth/token');
          const freshToken = await getValidToken();
          if (!freshToken) {
            clearTokens();
            router.replace('/login');
            return;
          }
          request.headers['Authorization'] = `Bearer ${freshToken}`;
 
          const originalUrl: string = request.uris[0];
          if (originalUrl.includes('/api/media/proxy?key=')) return;
 
          const r2Key = urlToR2Key(originalUrl, trackId);
          request.uris = [getProxyUrl(r2Key)];
        }
      );

      player.addEventListener('error', (event: any) => {
        setError(`Shaka error: ${event.detail?.message || 'Unknown'}`);
      });

      // ── 5. Load MPD từ R2 (qua signed URL filter) ─────────────────────────
      setStatusLog('📥 Đang load stream...');
      const mpdUrl = `${window.location.origin}/api/media/proxy?key=${encodeURIComponent(`audio/${trackId}/manifest.mpd`)}`;
      await player.load(mpdUrl);

      videoRef.current!.volume = volume;
      await videoRef.current!.play();
      setIsPlaying(true);
      setIsLoadingStream(false);
      setStatusLog('🎵 Đang phát từ R2 — Shaka ClearKey EME');

    } catch (err: any) {
      setError(err.message);
      setIsLoadingStream(false);
    }
  };

  const stopPlay = async () => {
    if (shakaPlayerRef.current) {
      await shakaPlayerRef.current.destroy();
      shakaPlayerRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.src = '';
    }
    // Xóa signed URL cache khi dừng
    setIsPlaying(false);
    setIsLoadingStream(false);
    setStatusLog('⏹ Đã dừng.');
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = parseFloat(e.target.value);
    setVolume(v);
    if (videoRef.current) videoRef.current.volume = v;
  };

  return (
    <div className="min-h-screen bg-gray-950 p-6 flex flex-col items-center justify-center relative select-none">
      <button
        onClick={() => router.push('/')}
        className="absolute top-6 left-6 bg-gray-900 border border-gray-800 text-gray-300 px-4 py-2 rounded-full font-semibold hover:bg-gray-800 transition-all shadow-md"
      >
        ✕ Quay lại
      </button>

      <h1 className="text-3xl font-bold text-white mb-2">Secure Audio Player</h1>
      <p className="text-gray-400 mb-10 text-sm">Mật Mã học NT219 - UIT · Shaka ClearKey EME · R2 Signed URLs</p>

      <div className="w-full max-w-md bg-gray-900 rounded-2xl border border-gray-800 p-6 flex flex-col gap-5">
        <div className="flex items-center gap-4">
          <div className={`w-16 h-16 ${isPlaying ? 'bg-emerald-600 animate-pulse border-emerald-500' : 'bg-gray-800'} rounded-xl flex items-center justify-center border-2 shadow-lg`}>
            <span className="text-white text-3xl">🎵</span>
          </div>
          <div>
            <p className="text-white font-bold text-base truncate max-w-[240px]">{songTitle}</p>
            <p className="text-emerald-400 text-[11px] font-mono">● CENC + ECDH + DPoP + Shaka EME + R2</p>
          </div>
        </div>

        <video
          ref={videoRef}
          className="hidden"
          playsInline
          onEnded={() => setIsPlaying(false)}
        />

        <div className="flex items-center justify-between px-3 py-2 bg-gray-950/60 border border-gray-800 rounded-xl font-mono text-xs text-gray-400">
          <span>Thời gian:</span>
          <span className="text-emerald-400 font-semibold">{currentTime} / {duration}</span>
        </div>

        <div className="flex items-center gap-3 px-3 py-2.5 bg-gray-950/60 border border-gray-800 rounded-xl">
          <span className="text-gray-500 text-xs">🔊</span>
          <input
            type="range" min="0" max="1" step="0.05" value={volume}
            onChange={handleVolumeChange}
            className="flex-1 accent-emerald-500 h-1.5 bg-gray-800 rounded-lg cursor-pointer"
          />
        </div>

        <div className="flex gap-3 mt-1">
          <button
            onClick={playSong}
            disabled={isPlaying || isLoadingStream}
            className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white py-3 rounded-xl font-semibold text-sm disabled:opacity-40 transition-all shadow-md"
          >
            {isLoadingStream ? '⏳ Đang kết nối...' : '▶ Phát'}
          </button>
          <button
            onClick={stopPlay}
            disabled={!isPlaying && !isLoadingStream}
            className="bg-gray-800 text-gray-300 px-5 py-3 rounded-xl font-semibold text-sm disabled:opacity-40 transition-all border border-gray-700 shadow-md"
          >
            ⏹ Dừng
          </button>
        </div>
      </div>

      <div className="mt-5 w-full max-w-md p-3 bg-gray-900/60 border border-gray-800 rounded-xl flex items-center justify-between">
        <span className="text-[11px] text-gray-400">Pipeline:</span>
        <span className="text-[11px] font-mono font-semibold text-emerald-400 truncate max-w-[250px]">{statusLog}</span>
      </div>

      {error && (
        <div className="mt-4 w-full max-w-md p-4 bg-red-950/40 border border-red-900/50 text-red-300 rounded-xl font-mono text-xs">
          Lỗi: {error}
        </div>
      )}
    </div>
  );
}

export default function PlayerPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-emerald-400 font-mono text-sm">Đang khởi tạo Player...</p>
        </div>
      </div>
    }>
      <PlayerInner />
    </Suspense>
  );
}