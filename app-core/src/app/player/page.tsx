"use client";
// app/player/page.tsx
// Middleware đã chặn nếu không có role music_listener → chỉ listener vào được

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState, useRef, useCallback, Suspense } from 'react';
import {
  Play, Pause, SkipBack, SkipForward,
  Volume2, VolumeX, Music2, ShieldCheck,
  ChevronDown, ChevronUp, Lock, Key, Fingerprint, RefreshCw,
} from 'lucide-react';
import { getCurrentUser, getRoleFromPayload, logout, refreshAccessToken, type JWTPayload } from '@/lib/auth/token';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface TrackItem {
  id: string;
  filename: string;
  duration: number;
  kid: string;
  sourceFormat?: string;
  createdAt: string;
  manifestKey: string; // path để build proxy URL: /api/media/proxy?key=<manifestKey>
}

interface DPoPKeyPair {
  publicKey: CryptoKey;
  privateKey: CryptoKey;
  publicKeyJWK: JsonWebKey;
  thumbprint: string; // jkt — SHA-256 thumbprint of public key
}

interface InspectorEvent {
  ts: number;
  type: 'dpop' | 'role' | 'license' | 'stream' | 'error';
  label: string;
  detail?: string;
  ok: boolean;
}

const cardEmojis = ['🎸', '🎧', '🔥', '🎵', '🎹', '🎼', '🎺', '🥁', '🎻', '🪗'];

// ─────────────────────────────────────────────────────────────────────────────
// DPoP utilities (Web Crypto — chạy client-side, Next.js "use client")
// ─────────────────────────────────────────────────────────────────────────────

async function generateDPoPKeyPair(): Promise<DPoPKeyPair> {
  const keyPair = await crypto.subtle.generateKey(
    { name: 'Ed25519' },
    true,
    ['sign', 'verify']
  ) as CryptoKeyPair;
  const publicKeyJWK = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
  // OKP/Ed25519 canonical members (RFC 7638): {crv, kty, x} — não tem campo y
  const canonical = JSON.stringify({
    crv: publicKeyJWK.crv,
    kty: publicKeyJWK.kty,
    x: publicKeyJWK.x,
  });
  const hashBuf = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(canonical)
  );
  const thumbprint = btoa(String.fromCharCode(...new Uint8Array(hashBuf)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');

  return { publicKey: keyPair.publicKey, privateKey: keyPair.privateKey, publicKeyJWK, thumbprint };
}

/** Tạo DPoP proof JWT theo RFC 9449 (EdDSA/Ed25519) */
async function createDPoPProof(
  keyPair: DPoPKeyPair,
  method: string,
  url: string,
  ath: string   // SHA-256(access_token) base64url — đọc từ cookie dpop_ath
): Promise<string> {
  const header = {
    typ: 'dpop+jwt',
    alg: 'EdDSA',
    jwk: keyPair.publicKeyJWK,
  };

  const payload = {
    jti: crypto.randomUUID(),
    htm: method.toUpperCase(),
    htu: url,
    iat: Math.floor(Date.now() / 1000),
    ath,
  };

  const enc = (obj: object) =>
    btoa(JSON.stringify(obj))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');

  const signingInput = `${enc(header)}.${enc(payload)}`;
  const sigBuf = await crypto.subtle.sign(
    'Ed25519',
    keyPair.privateKey,
    new TextEncoder().encode(signingInput)
  );
  const sig = btoa(String.fromCharCode(...new Uint8Array(sigBuf)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');

  return `${signingInput}.${sig}`;
}

/** Đọc giá trị cookie theo tên */
function getCookieValue(name: string): string | null {
  return document.cookie
    .split('; ')
    .find(c => c.startsWith(`${name}=`))
    ?.split('=')[1] ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Sidebar
// ─────────────────────────────────────────────────────────────────────────────

function Sidebar({ role, currentPath }: { role: string | null; currentPath: string }) {
  const router = useRouter();
  const links = [
    { icon: '🏠', label: 'Trang chủ', href: '/', roles: null },
    { icon: '🎵', label: 'Player', href: '/player', roles: ['music_listener', 'music_uploader'] },
    { icon: '⬆️', label: 'Upload', href: '/upload', roles: ['music_uploader'] },
  ];
  return (
    <div className="w-64 bg-black p-6 hidden md:flex flex-col gap-8 border-r border-gray-900 shrink-0">
      <div className="text-2xl font-bold tracking-tighter flex items-center gap-2">
        <span className="text-emerald-500 text-3xl">♪</span> UITify
      </div>
      {role && (
        <div className="flex flex-col gap-1">
          <span className="text-[10px] text-gray-500 font-mono uppercase tracking-widest">Đăng nhập là</span>
          <span className="text-xs font-mono font-bold px-2.5 py-1 rounded-full w-fit bg-emerald-950/60 border border-emerald-800/40 text-emerald-400">
            {role === 'music_uploader' ? '🎙 Music Uploader' : '🎧 Music Listener'}
          </span>
        </div>
      )}
      <nav className="flex flex-col gap-2">
        {links.map((link) => {
          const canAccess = !link.roles || (role && link.roles.includes(role));
          return (
            <button
              key={link.href}
              onClick={() => canAccess ? router.push(link.href) : undefined}
              title={!canAccess ? `Chỉ dành cho ${link.roles?.join(' / ')}` : undefined}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-semibold text-left w-full transition-colors
                ${currentPath === link.href ? 'text-white bg-gray-800' : ''}
                ${canAccess
                  ? 'text-gray-400 hover:text-white hover:bg-gray-900 cursor-pointer'
                  : 'text-gray-600 cursor-not-allowed opacity-50'
                }`}
            >
              <span>{link.icon}</span>
              <span>{link.label}</span>
              {!canAccess && <span className="ml-auto text-[9px] text-gray-600 font-mono">🔒</span>}
            </button>
          );
        })}
      </nav>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Security Inspector Panel
// ─────────────────────────────────────────────────────────────────────────────

const TYPE_META: Record<InspectorEvent['type'], { icon: React.ReactNode; color: string }> = {
  dpop:    { icon: <Fingerprint size={11} />,  color: 'text-violet-400' },
  role:    { icon: <ShieldCheck size={11} />,  color: 'text-emerald-400' },
  license: { icon: <Key size={11} />,          color: 'text-amber-400' },
  stream:  { icon: <RefreshCw size={11} />,    color: 'text-sky-400' },
  error:   { icon: <Lock size={11} />,         color: 'text-red-400' },
};

function Inspector({
  events,
  dpopThumbprint,
  role,
}: {
  events: InspectorEvent[];
  dpopThumbprint: string | null;
  role: string | null;
}) {
  const [open, setOpen] = useState(true);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [events]);

  return (
    <div className="border-t border-gray-900 bg-black/80 backdrop-blur-md shrink-0">
      {/* Header bar */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-2 hover:bg-gray-900/60 transition-colors"
      >
        <div className="flex items-center gap-2 text-[11px] font-mono font-bold text-gray-400">
          <ShieldCheck size={13} className="text-emerald-500" />
          Security Inspector
          {events.length > 0 && (
            <span className="bg-gray-800 text-gray-400 px-1.5 py-0.5 rounded text-[9px]">
              {events.length}
            </span>
          )}
        </div>
        {open ? <ChevronDown size={13} className="text-gray-600" /> : <ChevronUp size={13} className="text-gray-600" />}
      </button>

      {open && (
        <div className="px-4 pb-3 flex flex-col gap-2">
          {/* Status pills */}
          <div className="flex flex-wrap gap-2 pt-0.5">
            <Pill
              label="DPoP"
              value={dpopThumbprint ? `jkt: ${dpopThumbprint.slice(0, 8)}…` : 'Đang tạo…'}
              ok={!!dpopThumbprint}
              icon={<Fingerprint size={10} />}
            />
            <Pill
              label="Role"
              value={role ?? '…'}
              ok={role === 'music_listener'}
              icon={<ShieldCheck size={10} />}
            />
            <Pill
              label="Replay Guard"
              value="Redis JTI"
              ok
              icon={<Lock size={10} />}
            />
            <Pill
              label="JWKS Verify"
              value="Keycloak"
              ok={!!role}
              icon={<Key size={10} />}
            />
          </div>

          {/* Event log */}
          <div
            ref={logRef}
            className="h-28 overflow-y-auto flex flex-col gap-0.5 font-mono text-[10px] bg-gray-950/60 rounded-md border border-gray-900 px-2 py-1.5"
          >
            {events.length === 0 ? (
              <span className="text-gray-700 italic">Chưa có sự kiện…</span>
            ) : (
              events.map((ev) => {
                const meta = TYPE_META[ev.type];
                const time = new Date(ev.ts).toLocaleTimeString('vi-VN', {
                  hour12: false,
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit',
                });
                return (
                  <div key={ev.ts + ev.label} className="flex items-start gap-1.5 leading-tight">
                    <span className="text-gray-600 shrink-0 tabular-nums">{time}</span>
                    <span className={`shrink-0 ${meta.color}`}>{meta.icon}</span>
                    <span className={ev.ok ? 'text-gray-300' : 'text-red-400'}>
                      {ev.label}
                      {ev.detail && (
                        <span className="text-gray-600 ml-1">{ev.detail}</span>
                      )}
                    </span>
                    <span className="ml-auto shrink-0">{ev.ok ? '✓' : '✗'}</span>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Pill({
  label, value, ok, icon,
}: { label: string; value: string; ok: boolean; icon: React.ReactNode }) {
  return (
    <div className={`flex items-center gap-1 px-2 py-0.5 rounded border text-[9px] font-mono
      ${ok
        ? 'bg-emerald-950/40 border-emerald-900/40 text-emerald-400'
        : 'bg-gray-900/60 border-gray-800 text-gray-500'
      }`}
    >
      {icon}
      <span className="text-gray-600">{label}:</span>
      <span>{value}</span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PlayerInner
// ─────────────────────────────────────────────────────────────────────────────

function PlayerInner() {
  const router       = useRouter();
  const searchParams = useSearchParams();
  const trackId      = searchParams.get('trackId');

  const [user, setUser]   = useState<JWTPayload | null>(null);
  const [role, setRole]   = useState<string | null>(null);
  const [tracks, setTracks]     = useState<TrackItem[]>([]);
  const [currentTrack, setCurrentTrack] = useState<TrackItem | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted]   = useState(false);
  const [progress, setProgress] = useState(0);
  const [volume, setVolume]     = useState(80);
  const [audioError, setAudioError] = useState<string | null>(null);

  // Audio refs
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const shakaRef = useRef<any>(null);

  // DPoP
  const [dpopKeyPair, setDpopKeyPair] = useState<DPoPKeyPair | null>(null);

  // Inspector
  const [inspectorEvents, setInspectorEvents] = useState<InspectorEvent[]>([]);


  const addEvent = useCallback((ev: Omit<InspectorEvent, 'ts'>) => {
    setInspectorEvents(prev => [...prev.slice(-49), { ...ev, ts: Date.now() }]);
  }, []);

  // ── 1. Auth ───────────────────────────────────────────────────────────────
  useEffect(() => {
    const init = async () => {
      const u = await getCurrentUser();
      if (!u) { router.replace('/login'); return; }
      const r = getRoleFromPayload(u);
      if (r !== 'music_listener') { router.replace('/403'); return; }
      setUser(u);
      setRole(r);
      addEvent({ type: 'role', label: `Role verified: ${r}`, ok: true });
    };
    init();
  }, [router, addEvent]);

  // ── 2. Tạo DPoP key pair (1 lần khi mount) ────────────────────────────────
  useEffect(() => {
    generateDPoPKeyPair().then((kp) => {
      setDpopKeyPair(kp);
      addEvent({
        type: 'dpop',
        label: 'DPoP keypair generated (EdDSA/Ed25519)',
        detail: `jkt: ${kp.thumbprint.slice(0, 12)}…`,
        ok: true,
      });
    });
  }, [addEvent]);

  // ── 2b. Auto-refresh token mỗi 4 phút (trước khi 5-phút cookie hết hạn) ──
  useEffect(() => {
    if (!role) return;
    const id = setInterval(async () => {
      const ok = await refreshAccessToken();
      if (!ok) router.replace('/login');
    }, 240_000);
    return () => clearInterval(id);
  }, [role, router]);

  // ── 3. Fetch track list (dùng DPoP nếu sẵn, fallback plain bearer) ────────
  useEffect(() => {
    if (!role) return;

    const fetchTracks = async () => {
      try {
        const headers: HeadersInit = {};
        const ath = getCookieValue('dpop_ath');
        if (ath && dpopKeyPair) {
          const proof = await createDPoPProof(
            dpopKeyPair,
            'GET',
            `${window.location.origin}/api/tracks`,
            ath
          );
          headers['DPoP'] = proof;
          addEvent({ type: 'dpop', label: 'DPoP proof gửi → /api/tracks', ok: true });
        }

        const res = await fetch('/api/tracks', {
          credentials: 'include',
          headers,
        });

        if (res.ok) {
          const json = await res.json();
          const list: TrackItem[] = Array.isArray(json.data) ? json.data : [];
          setTracks(list);
          const selected = trackId ? list.find(t => t.id === trackId) : list[0];
          setCurrentTrack(selected ?? list[0] ?? null);
          addEvent({ type: 'stream', label: `Tải ${list.length} track thành công`, ok: true });
        } else {
          addEvent({ type: 'error', label: `Lỗi tải track: HTTP ${res.status}`, ok: false });
        }
      } catch (err: any) {
        addEvent({ type: 'error', label: 'Không thể tải track', detail: err?.message, ok: false });
      } finally {
        setIsLoading(false);
      }
    };

    fetchTracks();
  }, [role, trackId, dpopKeyPair, addEvent]);

  // ── 4. ECDH unwrap CEK từ license response ───────────────────────────────────
  // Server dùng X25519 + HKDF + AES-256-GCM để wrap CEK
  // Client generate X25519 keypair, gửi pubkey lên, nhận wrappedCek + serverPubKey + iv
  const unwrapCEK = async (
    clientPrivKey: CryptoKey,
    serverPubHex: string,
    wrappedCekHex: string,
    ivHex: string,
  ): Promise<string> => {
    // Server dùng X25519 (ecdh.ts) — client phải dùng X25519 để match
    // Import server ephemeral public key (raw 32 bytes X25519)
    const serverPubRaw = new Uint8Array(serverPubHex.match(/.{2}/g)!.map(b => parseInt(b, 16)));
    const serverPubKey = await crypto.subtle.importKey(
      'raw', serverPubRaw, { name: 'X25519' }, false, []
    );

    // X25519 ECDH shared secret
    const sharedBits = await crypto.subtle.deriveBits(
      { name: 'X25519', public: serverPubKey },
      clientPrivKey,
      256
    );

    // HKDF → AES-256-GCM key (mirror server: info='cek-wrapping-v1', salt=empty)
    const hkdfKey = await crypto.subtle.importKey('raw', sharedBits, 'HKDF', false, ['deriveKey']);
    const aesKey  = await crypto.subtle.deriveKey(
      {
        name: 'HKDF', hash: 'SHA-256',
        salt: new Uint8Array(0),
        info: new TextEncoder().encode('cek-wrapping-v1'),
      },
      hkdfKey,
      { name: 'AES-GCM', length: 256 },
      true,
      ['decrypt']
    );

    // AES-256-GCM decrypt (last 16 bytes = auth tag)
    const wrappedBytes = new Uint8Array(wrappedCekHex.match(/.{2}/g)!.map(b => parseInt(b, 16)));
    const iv           = new Uint8Array(ivHex.match(/.{2}/g)!.map(b => parseInt(b, 16)));
    const ciphertext   = wrappedBytes.slice(0, -16);
    const authTag      = wrappedBytes.slice(-16);
    const combined     = new Uint8Array([...ciphertext, ...authTag]);

    const cekBytes = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, aesKey, combined);
    return Array.from(new Uint8Array(cekBytes)).map(b => b.toString(16).padStart(2,'0')).join('');
  };

  // ── 5. Khởi tạo Shaka Player với ClearKey ────────────────────────────────────
  const initShaka = useCallback(async (track: TrackItem, cekHex: string) => {
    setAudioError(null);

    // Teardown player cũ
    if (shakaRef.current) {
      try { await shakaRef.current.destroy(); } catch {}
      shakaRef.current = null;
    }
    if (!audioRef.current) return;

    try {
      const shakaModule = await import('shaka-player/dist/shaka-player.compiled');
      const shaka = (shakaModule as any).default ?? shakaModule;
      shaka.polyfill.installAll();

      if (!shaka.Player.isBrowserSupported()) {
        setAudioError('Trình duyệt không hỗ trợ Shaka Player');
        return;
      }

      const player = new shaka.Player(audioRef.current);
      shakaRef.current = player;

      // Shaka ClearKey format (RFC 8188 / W3C ClearKey):
      //   kid = 16 bytes = 32 hex chars
      //   key = 16 bytes = 32 hex chars (AES-128-CTR)
      //
      // CEK từ server: 32 hex chars (16 bytes) — đúng AES-128, không cần slice.
      // kid từ DB có thể có dashes hoặc độ dài lẻ → normalize.
      const kidHex = track.kid.replace(/-/g, '').slice(0, 32).padStart(32, '0');
      const keyHex = cekHex; // CEK đã là 32 hex chars (16 bytes) từ KMS

      console.log('[Shaka] kidHex:', kidHex, '— len:', kidHex.length, '(expect 32)');
      console.log('[Shaka] keyHex:', keyHex, '— len:', keyHex.length, '(expect 32)');

      if (kidHex.length !== 32 || keyHex.length !== 32) {
        throw new Error(`ClearKey format error: kid=${kidHex.length} key=${keyHex.length} (both must be 32)`);
      }

      player.configure({
        drm: {
          clearKeys: {
            [kidHex]: keyHex,
          },
        },
      });

      // Gắn Bearer token vào mọi request qua proxy
      // Shaka fetch manifest + segments — intercept và route qua /api/media/proxy
      // để gắn Bearer token (R2 không nhận token trực tiếp)
      // Pre-compute manifest key + R2 directory prefix dùng cho relative URL resolution
      const manifestKey = track.manifestKey || `${track.id}/manifest.mpd`;
      const r2Dir = manifestKey.substring(0, manifestKey.lastIndexOf('/') + 1);
      const proxyBase = `${window.location.origin}/api/media/proxy?key=`;

      // Route tất cả media request qua proxy — xử lý 2 trường hợp:
      // 1. R2 direct URL (cross-origin) → extract audio path, rewrite sang proxy
      // 2. Same-origin nhưng sai endpoint — Shaka resolve relative URL từ MPD
      //    e.g., /api/media/init.mp4 thay vì /api/media/proxy?key=audio/trackId/init.mp4
      player.getNetworkingEngine()!.registerRequestFilter((_type: any, request: any) => {
        const url: string = request.uris[0];
        if (!url || url.startsWith(proxyBase)) return;

        if (!url.startsWith(window.location.origin) && !url.startsWith('/')) {
          // Case 1: R2 direct URL
          try {
            const parsed = new URL(url);
            const parts = parsed.pathname.split('/');
            const audioIdx = parts.findIndex((p: string) => p === 'audio');
            if (audioIdx !== -1) {
              request.uris[0] = `${proxyBase}${encodeURIComponent(parts.slice(audioIdx).join('/'))}`;
            }
          } catch { /* keep original */ }
          return;
        }

        // Case 2: Same-origin nhưng không phải proxy URL
        const fileName = url.split('/').pop()?.split('?')[0] ?? '';
        if (fileName.match(/\.(m4s|mp4|m4a|mpd|cmfa|cmfv)$/i)) {
          request.uris[0] = `${proxyBase}${encodeURIComponent(r2Dir + fileName)}`;
        }
      });

      player.addEventListener('error', (e: any) => {
        const msg = e?.detail?.message ?? 'Shaka error';
        setAudioError(`Lỗi phát: ${msg}`);
        setIsPlaying(false);
        addEvent({ type: 'error', label: `Shaka error: ${msg}`, ok: false });
      });

      audioRef.current.addEventListener('timeupdate', () => {
        const el = audioRef.current!;
        if (!el.duration) return;
        setProgress((el.currentTime / el.duration) * 100);
      });
      audioRef.current.addEventListener('ended', () => {
        setIsPlaying(false);
        setProgress(100);
      });

      const manifestUrl = `/api/media/proxy?key=${encodeURIComponent(manifestKey)}`;
      console.log('[Shaka] Loading manifest:', manifestUrl);
      await player.load(manifestUrl);
      audioRef.current.play();

      addEvent({ type: 'stream', label: `Shaka ClearKey stream: ${track.filename}`, ok: true });
    } catch (err: any) {
      console.error('[initShaka] Error:', err);
      const msg = err?.message ?? String(err) ?? 'unknown';
      setAudioError(`Lỗi khởi tạo player: ${msg}`);
      setIsPlaying(false);
      addEvent({ type: 'error', label: 'Shaka init failed', detail: msg, ok: false });
    }
  }, [addEvent]);

  // Sync play/pause
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    if (isPlaying) { el.play().catch(() => {}); }
    else           { el.pause(); }
  }, [isPlaying]);

  // Sync volume/mute
  useEffect(() => {
    if (!audioRef.current) return;
    audioRef.current.volume = isMuted ? 0 : volume / 100;
  }, [volume, isMuted]);

  // Cleanup khi unmount
  useEffect(() => {
    return () => {
      if (shakaRef.current) { try { shakaRef.current.destroy(); } catch {} }
    };
  }, []);

  // ── 5. Fetch license với DPoP khi chuyển track ───────────────────────────
  const fetchLicenseAndPlay = useCallback(async (track: TrackItem) => {
    if (!dpopKeyPair) return;
    const ath = getCookieValue('dpop_ath');
    if (!ath) {
      setAudioError('Phiên đăng nhập hết hạn. Vui lòng đăng nhập lại.');
      setIsPlaying(false);
      addEvent({ type: 'error', label: 'Cookie dpop_ath hết hạn', ok: false });
      return;
    }

    const licenseUrl = `${window.location.origin}/api/license`;
    try {
      // ── 1. DPoP proof ──────────────────────────────────────────────────
      const proof = await createDPoPProof(dpopKeyPair, 'POST', licenseUrl, ath);
      addEvent({ type: 'dpop', label: `DPoP proof → /api/license (kid: ${track.kid.slice(0, 8)}…)`, ok: true });

      // ── 2. X25519 keypair phía client (mirror server ecdh.ts dùng x25519) ─
      const ecdhKeyPair = await crypto.subtle.generateKey(
        { name: 'X25519' },
        true,
        ['deriveBits']
      ) as CryptoKeyPair;
      // Export raw public key (32 bytes X25519)
      const clientPubRaw = await crypto.subtle.exportKey('raw', ecdhKeyPair.publicKey);
      const clientPubHex = Array.from(new Uint8Array(clientPubRaw))
        .map(b => b.toString(16).padStart(2, '0')).join('');

      // ── 3. Gọi /api/license ────────────────────────────────────────────
      const res = await fetch(licenseUrl, {
        method: 'POST',
        headers: {
          DPoP: proof,
          'x-kid': track.kid,
          'x-client-public-key': clientPubHex,
          'Content-Type': 'application/octet-stream',
        },
        body: new Uint8Array(0),
        credentials: 'include',
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const msg = body?.error ?? body?.detail ?? `HTTP ${res.status}`;
        setAudioError(`License thất bại: ${msg}`);
        setIsPlaying(false);
        addEvent({ type: 'error', label: `License thất bại: ${msg}`, ok: false });
        return;
      }

      // ── 4. Parse binary license [4-byte len][payload][sig] ─────────────
      // Format: [UInt32BE payloadLen][payload bytes][signature bytes]
      const buf        = await res.arrayBuffer();
      const view       = new DataView(buf);
      const payloadLen = view.getUint32(0);
      const payloadBuf = buf.slice(4, 4 + payloadLen);
      const sigBuf     = buf.slice(4 + payloadLen); // Ed25519 sig = 64 bytes
      const licensePayload = JSON.parse(new TextDecoder().decode(payloadBuf));

      // ── 5. Verify chữ ký Ed25519 ────────────────────────────────────────
      // Server gửi public key qua header X-License-Signing-Key (JWK OKP/Ed25519)
      // Client verify trước khi dùng bất kỳ dữ liệu nào trong payload
      const signingKeyHeader = res.headers.get('X-License-Signing-Key');
      if (!signingKeyHeader) {
        setAudioError('License thiếu signing key header');
        setIsPlaying(false);
        addEvent({ type: 'error', label: 'Thiếu X-License-Signing-Key', ok: false });
        return;
      }
      let sigPubKey: CryptoKey;
      try {
        const sigPubJwk = JSON.parse(signingKeyHeader) as JsonWebKey;
        sigPubKey = await crypto.subtle.importKey(
          'jwk',
          sigPubJwk,
          { name: 'Ed25519' },
          false,
          ['verify']
        );
      } catch (err: any) {
        setAudioError('Không thể import signing public key');
        setIsPlaying(false);
        addEvent({ type: 'error', label: 'Import Ed25519 pubkey thất bại', detail: err?.message, ok: false });
        return;
      }

      const sigValid = await crypto.subtle.verify(
        'Ed25519',
        sigPubKey,
        sigBuf,
        payloadBuf
      );

      if (!sigValid) {
        setAudioError('Chữ ký license không hợp lệ — từ chối phát');
        setIsPlaying(false);
        addEvent({ type: 'error', label: 'Ed25519 verify FAILED — license bị giả mạo?', ok: false });
        return;
      }

      addEvent({
        type: 'license',
        label: `License OK + Ed25519 verified — kid: ${licensePayload.kid?.slice(0, 8)}…`,
        detail: `wrappedCek: ${licensePayload.wrappedCek?.slice(0, 12)}…`,
        ok: true,
      });

      // ── 6. ECDH unwrap CEK ─────────────────────────────────────────────
      // Server dùng P-256 ECDH + HKDF-SHA256 + AES-256-GCM để wrap CEK
      console.log('[License] serverPublicKey:', licensePayload.serverPublicKey?.slice(0,16));
      console.log('[License] wrappedCek len:', licensePayload.wrappedCek?.length);
      console.log('[License] iv:', licensePayload.iv);
      let cekHex: string;
      try {
        cekHex = await unwrapCEK(
          (ecdhKeyPair as CryptoKeyPair).privateKey,
          licensePayload.serverPublicKey,
          licensePayload.wrappedCek,
          licensePayload.iv,
        );
        console.log('[License] CEK unwrapped, length:', cekHex.length);
      } catch (unwrapErr: any) {
        console.error('[License] unwrapCEK failed:', unwrapErr);
        setAudioError(`ECDH unwrap thất bại: ${unwrapErr?.message}`);
        setIsPlaying(false);
        addEvent({ type: 'error', label: 'ECDH unwrap CEK thất bại', detail: unwrapErr?.message, ok: false });
        return;
      }
      addEvent({ type: 'license', label: 'CEK unwrapped (X25519+HKDF+AES-256-GCM)', ok: true });

      // ── 7. Khởi động Shaka với ClearKey ───────────────────────────────
      console.log('[License] Launching Shaka with kid:', track.kid, 'cekLen:', cekHex.length);
      await initShaka(track, cekHex);

    } catch (err: any) {
      console.error('[fetchLicenseAndPlay] Error:', err);
      const msg = err?.message ?? String(err) ?? 'unknown';
      setAudioError(`Lỗi: ${msg}`);
      setIsPlaying(false);
      addEvent({ type: 'error', label: 'fetchLicenseAndPlay lỗi', detail: msg, ok: false });
    }
  }, [dpopKeyPair, addEvent, initShaka]);


  const handleSelectTrack = useCallback((track: TrackItem) => {
    setCurrentTrack(track);
    setProgress(0);
    setAudioError(null);
    setIsPlaying(true);
    router.replace(`/player?trackId=${track.id}`, { scroll: false });
    fetchLicenseAndPlay(track);
  }, [router, fetchLicenseAndPlay]);

  const handleSkip = (dir: 'prev' | 'next') => {
    if (!tracks.length || !currentTrack) return;
    const idx  = tracks.findIndex(t => t.id === currentTrack.id);
    const next = dir === 'next'
      ? tracks[(idx + 1) % tracks.length]
      : tracks[(idx - 1 + tracks.length) % tracks.length];
    handleSelectTrack(next);
  };

  const elapsed = currentTrack
    ? Math.floor((progress / 100) * currentTrack.duration)
    : 0;
  const fmt = (s: number) =>
    `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-screen bg-black text-white font-sans overflow-hidden select-none">
      <Sidebar role={role} currentPath="/player" />

      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex justify-between items-center px-6 py-4 border-b border-gray-900 bg-black/40 backdrop-blur-md">
          <h1 className="text-lg font-bold text-white flex items-center gap-2">
            <Music2 size={20} className="text-emerald-500" /> Player
          </h1>
          <div className="flex items-center gap-3">
            <span className="hidden sm:flex items-center gap-1.5 text-[10px] font-mono text-emerald-400 bg-emerald-950/40 border border-emerald-900/40 px-2.5 py-1 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse inline-block" />
              DPoP Active
            </span>
            <button
              onClick={() => logout()}
              className="bg-red-500/10 text-red-400 border border-red-900/50 px-4 py-1.5 rounded-full font-bold text-sm hover:bg-red-500 hover:text-white transition-all duration-200"
            >
              Đăng xuất
            </button>
          </div>
        </div>

        {/* Main area + Inspector stacked vertically */}
        <div className="flex flex-1 overflow-hidden flex-col">
          <div className="flex flex-1 overflow-hidden">
            {/* Track list */}
            <div className="w-72 border-r border-gray-900 overflow-y-auto p-4 flex flex-col gap-2 shrink-0">
              <p className="text-[10px] font-mono text-gray-500 uppercase tracking-widest mb-2">
                Danh sách phát
              </p>
              {isLoading ? (
                <div className="flex items-center gap-2 text-xs text-emerald-400 font-mono">
                  <div className="w-3 h-3 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
                  Đang tải...
                </div>
              ) : tracks.length === 0 ? (
                <p className="text-xs text-gray-600 font-mono">Chưa có bài hát nào.</p>
              ) : (
                tracks.map((track, idx) => (
                  <button
                    key={track.id}
                    onClick={() => handleSelectTrack(track)}
                    className={`flex items-center gap-3 p-2.5 rounded-lg text-left w-full transition-colors group
                      ${currentTrack?.id === track.id
                        ? 'bg-emerald-900/30 border border-emerald-800/40'
                        : 'hover:bg-gray-900 border border-transparent'
                      }`}
                  >
                    <div className="w-9 h-9 bg-gradient-to-br from-emerald-600 to-teal-900 rounded-md flex items-center justify-center text-lg shrink-0">
                      {cardEmojis[idx % cardEmojis.length]}
                    </div>
                    <div className="overflow-hidden">
                      <p className={`text-xs font-bold truncate ${currentTrack?.id === track.id ? 'text-emerald-400' : 'text-white'}`}>
                        {track.filename}
                      </p>
                      <p className="text-[10px] text-gray-500 font-mono">
                        {Math.floor(track.duration / 60)}:{String(track.duration % 60).padStart(2, '0')}
                      </p>
                    </div>
                    {currentTrack?.id === track.id && isPlaying && (
                      <div className="ml-auto shrink-0 flex gap-0.5 items-end h-4">
                        {[1, 2, 3].map(i => (
                          <div
                            key={i}
                            className="w-0.5 bg-emerald-400 rounded-full animate-bounce"
                            style={{ height: `${30 + i * 20}%`, animationDelay: `${i * 0.1}s` }}
                          />
                        ))}
                      </div>
                    )}
                  </button>
                ))
              )}
            </div>

            {/* Now playing */}
            <div className="flex-1 flex flex-col items-center justify-center p-8 bg-gradient-to-b from-gray-900 to-black overflow-y-auto">
              {currentTrack ? (
                <>
                  {/* Hidden audio element for dash.js */}
                  <audio ref={audioRef} className="hidden" />

                  {/* Error banner */}
                  {audioError && (
                    <div className="w-full max-w-sm mb-4 flex items-start gap-2 bg-red-950/40 border border-red-800/50 rounded-lg px-3 py-2.5 text-xs text-red-400 font-mono">
                      <span className="shrink-0 mt-0.5">⚠</span>
                      <span>{audioError}</span>
                    </div>
                  )}

                  {/* Cover */}
                  <div className={`w-48 h-48 bg-gradient-to-br from-emerald-600 to-teal-900 rounded-2xl flex items-center justify-center text-7xl shadow-2xl mb-6 transition-all duration-500 ${isPlaying ? 'scale-105 shadow-emerald-900/40' : ''}`}>
                    {cardEmojis[tracks.findIndex(t => t.id === currentTrack.id) % cardEmojis.length]}
                  </div>

                  {/* Info */}
                  <div className="text-center mb-5">
                    <h2 className="text-xl font-bold text-white mb-1">{currentTrack.filename}</h2>
                    <p className="text-xs text-gray-400 font-mono">KID: {currentTrack.kid.substring(0, 12)}…</p>
                  </div>

                  {/* Progress */}
                  <div className="w-full max-w-sm mb-4">
                    <div
                      className="h-1 bg-gray-800 rounded-full overflow-hidden cursor-pointer"
                      onClick={(e) => {
                        const rect = e.currentTarget.getBoundingClientRect();
                        const pct = (e.clientX - rect.left) / rect.width;
                        setProgress(pct * 100);
                        if (audioRef.current && audioRef.current.duration) {
                          audioRef.current.currentTime = pct * audioRef.current.duration;
                        }
                      }}
                    >
                      <div
                        className="h-full bg-emerald-500 rounded-full transition-all duration-1000"
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                    <div className="flex justify-between text-[10px] text-gray-500 font-mono mt-1">
                      <span>{fmt(elapsed)}</span>
                      <span>{fmt(currentTrack.duration)}</span>
                    </div>
                  </div>

                  {/* Controls */}
                  <div className="flex items-center gap-6 mb-5">
                    <button onClick={() => handleSkip('prev')} className="text-gray-400 hover:text-white transition-colors">
                      <SkipBack size={22} />
                    </button>
                    <button
                      onClick={() => setIsPlaying(p => !p)}
                      className="w-14 h-14 bg-white rounded-full flex items-center justify-center hover:scale-105 transition-transform shadow-lg"
                    >
                      {isPlaying
                        ? <Pause size={24} fill="black" color="black" />
                        : <Play size={24} fill="black" color="black" className="ml-1" />
                      }
                    </button>
                    <button onClick={() => handleSkip('next')} className="text-gray-400 hover:text-white transition-colors">
                      <SkipForward size={22} />
                    </button>
                  </div>

                  {/* Volume */}
                  <div className="flex items-center gap-3 w-full max-w-[200px]">
                    <button onClick={() => setIsMuted(m => !m)} className="text-gray-400 hover:text-white transition-colors">
                      {isMuted ? <VolumeX size={16} /> : <Volume2 size={16} />}
                    </button>
                    <input
                      type="range" min={0} max={100} value={isMuted ? 0 : volume}
                      onChange={e => { setVolume(+e.target.value); setIsMuted(false); }}
                      className="flex-1 h-1 accent-emerald-500 cursor-pointer"
                    />
                    <span className="text-[10px] text-gray-500 font-mono w-6">{isMuted ? 0 : volume}</span>
                  </div>
                </>
              ) : (
                <div className="text-center text-gray-600">
                  <Music2 size={48} className="mx-auto mb-4 opacity-30" />
                  <p className="font-mono text-sm">Chọn một bài hát để phát</p>
                </div>
              )}
            </div>
          </div>

          {/* Security Inspector — docked to bottom */}
          <Inspector
            events={inspectorEvents}
            dpopThumbprint={dpopKeyPair?.thumbprint ?? null}
            role={role}
          />
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Export
// ─────────────────────────────────────────────────────────────────────────────

export default function PlayerPage() {
  return (
    <Suspense fallback={
      <div className="flex h-screen bg-black items-center justify-center text-emerald-400 font-mono text-sm gap-3">
        <div className="w-4 h-4 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
        Đang tải player...
      </div>
    }>
      <PlayerInner />
    </Suspense>
  );
}