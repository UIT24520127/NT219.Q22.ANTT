"use client";
import React, { useEffect, useRef, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

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
  const bytes = new Uint8Array(hex.match(/.{1,2}/g)!.map(b => parseInt(b, 16)));
  return base64urlEncode(bytes);
}

// Fix: trả về ArrayBuffer trực tiếp để tương thích với Web Crypto API
function hexToBuffer(hex: string): ArrayBuffer {
  const bytes = new Uint8Array(hex.match(/.{1,2}/g)!.map(b => parseInt(b, 16)));
  return bytes.buffer.slice(0) as ArrayBuffer;
}

// Giữ lại cho các chỗ không cần ArrayBuffer
function hexToBytes(hex: string): Uint8Array {
  return new Uint8Array(hex.match(/.{1,2}/g)!.map(b => parseInt(b, 16)));
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
    const token = localStorage.getItem('token');
    if (!token) {
      const returnUrl = window.location.pathname + window.location.search;
      router.replace(`/login?returnTo=${encodeURIComponent(returnUrl)}`);
    }
  }, [router]);

  // ── Load metadata ───────────────────────────────────────────────────────────
  useEffect(() => {
    const id = searchParams.get('trackId') || '';
    if (!id) return;
    setTrackId(id);
    (async () => {
      try {
        setStatusLog('🔍 Đang truy vấn metadata...');
        const res = await fetch(`/api/ingest/upload?trackId=${id}`);
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
          setStatusLog('🔑 Khởi tạo ECDH keypair...');
          globalECDHKeyPair = await crypto.subtle.generateKey(
            { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey', 'deriveBits']
          );
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

  // ── playSong: ECDH → unwrap CEK → cấu hình Shaka ClearKey ─────────────────
  const playSong = async () => {
    if (!trackId || !targetKID) { setError('Chưa nạp dữ liệu bài hát!'); return; }
    if (!globalECDHKeyPair || !globalDPoPKeyPair) { setError('Crypto chưa sẵn sàng!'); return; }

    setError(null);
    setIsLoadingStream(true);

    try {
      const rawToken = localStorage.getItem('token') || '';
      const licenseUrl = `${window.location.origin}/api/license`;

      // ── 1. Tạo DPoP proof + gọi /api/license ─────────────────────────────
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
        throw new Error(`License server lỗi ${licenseRes.status}: ${errText}`);
      }

      // ── 2. Parse license response (binary: [4-byte len][payload][sig]) ────
      const responseBuf = new Uint8Array(await licenseRes.arrayBuffer());
      const payloadLen =
        ((responseBuf[0] << 24) | (responseBuf[1] << 16) |
         (responseBuf[2] << 8) | responseBuf[3]) >>> 0;
      const licenseData = JSON.parse(
        new TextDecoder().decode(responseBuf.slice(4, 4 + payloadLen))
      );

      // ── 3. ECDH unwrap CEK ────────────────────────────────────────────────
      setStatusLog('🔓 Đang giải mã CEK qua ECDH...');

      // Fix: dùng hexToBuffer trả về ArrayBuffer thay vì Uint8Array
      const serverPubKey = await crypto.subtle.importKey(
        'raw', hexToBuffer(licenseData.serverPublicKey),
        { name: 'ECDH', namedCurve: 'P-256' }, false, []
      );
      const sharedBits = await crypto.subtle.deriveBits(
        { name: 'ECDH', public: serverPubKey },
        globalECDHKeyPair.privateKey, 256
      );
      const aesKeyBuf = await crypto.subtle.digest('SHA-256', sharedBits);
      const aesKey = await crypto.subtle.importKey(
        'raw', aesKeyBuf, { name: 'AES-GCM' }, false, ['decrypt']
      );

      // wrappedCek = ciphertext + 16-byte GCM auth tag
      const cekBuf = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: hexToBuffer(licenseData.iv), tagLength: 128 },
        aesKey,
        hexToBuffer(licenseData.wrappedCek)
      );

      // cekBuf là raw binary (16 bytes) → chuyển sang hex string 32 ký tự
      const cekHex = Array.from(new Uint8Array(cekBuf))
        .map(b => b.toString(16).padStart(2, '0')).join('');
      console.log('✅ [Player] CEK unwrapped, length:', cekHex.length); // phải là 32

      // ── 4. Cấu hình Shaka Player với ClearKey ────────────────────────────
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

      player.configure({
        drm: {
          clearKeys: {
            [licenseData.kid]: cekHex,
          },
        },
      });

      player.addEventListener('error', (event: any) => {
        console.error('💥 [Shaka] Error:', event.detail);
        setError(`Shaka error: ${event.detail?.message || 'Unknown'}`);
      });

      // ── 5. Load MPD và phát ───────────────────────────────────────────────
      setStatusLog('📥 Đang load stream...');
      const mpdUrl = `/audio/segments/${trackId}/manifest.mpd`;
      await player.load(mpdUrl);

      videoRef.current!.volume = volume;
      await videoRef.current!.play();
      setIsPlaying(true);
      setIsLoadingStream(false);
      setStatusLog('🎵 Đang phát — Shaka ClearKey EME');

    } catch (err: any) {
      console.error('💥 [Player]', err);
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
      <p className="text-gray-400 mb-10 text-sm">Mật Mã học NT219 - UIT · Shaka ClearKey EME</p>

      <div className="w-full max-w-md bg-gray-900 rounded-2xl border border-gray-800 p-6 flex flex-col gap-5">
        <div className="flex items-center gap-4">
          <div className={`w-16 h-16 ${isPlaying ? 'bg-emerald-600 animate-pulse border-emerald-500' : 'bg-gray-800'} rounded-xl flex items-center justify-center border-2 shadow-lg`}>
            <span className="text-white text-3xl">🎵</span>
          </div>
          <div>
            <p className="text-white font-bold text-base truncate max-w-[240px]">{songTitle}</p>
            <p className="text-emerald-400 text-[11px] font-mono">● CENC + ECDH + DPoP + Shaka EME</p>
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