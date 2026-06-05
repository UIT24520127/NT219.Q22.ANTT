"use client";
// app/upload/page.tsx
// Middleware đã chặn nếu không có role music_uploader
import { useRouter } from 'next/navigation';
import { useEffect, useState, useRef } from 'react';
import { Upload, CheckCircle2, AlertCircle, Loader2, Music2, FileAudio, LogOut } from 'lucide-react';
import { getCurrentUser, getRoleFromPayload, logout, type JWTPayload } from '@/lib/auth/token';

interface UploadedTrack {
  id:        string;
  filename:  string;
  duration:  number;
  kid:       string;
  createdAt: string;
}

type UploadStatus = 'idle' | 'uploading' | 'success' | 'error';

function Sidebar({ role, currentPath }: { role: string | null; currentPath: string }) {
  const router = useRouter();
  const links = [
    { icon: '🏠', label: 'Trang chủ', href: '/',       roles: null },
    { icon: '⬆️', label: 'Upload',    href: '/upload',  roles: ['music_uploader'] },
  ];

  return (
    <div className="w-64 bg-black p-6 hidden md:flex flex-col gap-8 border-r border-gray-900 shrink-0">
      <div className="text-2xl font-bold tracking-tighter flex items-center gap-2">
        <span className="text-emerald-500 text-3xl">♪</span> UITify
      </div>
      {role && (
        <div className="flex flex-col gap-1">
          <span className="text-[10px] text-gray-500 font-mono uppercase tracking-widest">Đăng nhập là</span>
          <span className="text-xs font-mono font-bold px-2.5 py-1 rounded-full w-fit bg-violet-950/60 border border-violet-800/40 text-violet-400">
            🎙 Music Uploader
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
              className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-semibold text-left w-full transition-colors
                ${currentPath === link.href ? 'text-white bg-gray-800' : ''}
                ${canAccess
                  ? 'text-gray-400 hover:text-white hover:bg-gray-900 cursor-pointer'
                  : 'text-gray-600 cursor-not-allowed opacity-50'}`}
            >
              <span>{link.icon}</span>
              <span>{link.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Logout ở cuối sidebar */}
      <div className="mt-auto">
        <button
          onClick={() => logout()}
          className="flex items-center gap-2 w-full px-3 py-2 rounded-lg text-sm text-red-400
                     hover:bg-red-950/30 hover:text-red-300 transition-colors"
        >
          <LogOut size={14} /> Đăng xuất
        </button>
      </div>
    </div>
  );
}

export default function UploadPage() {
  const router = useRouter();

  const [user, setUser]                   = useState<JWTPayload | null>(null);
  const [role, setRole]                   = useState<string | null>(null);
  const [file, setFile]                   = useState<File | null>(null);
  const [status, setStatus]               = useState<UploadStatus>('idle');
  const [uploadedTrack, setUploadedTrack] = useState<UploadedTrack | null>(null);
  const [errorMsg, setErrorMsg]           = useState('');
  const [isDragOver, setIsDragOver]       = useState(false);
  const [uploadedList, setUploadedList]   = useState<UploadedTrack[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Xác thực user — double-check client side (middleware là lớp 1)
  useEffect(() => {
    getCurrentUser().then((u) => {
      if (!u) { router.replace('/login'); return; }
      const r = getRoleFromPayload(u);
      if (r !== 'music_uploader') { router.replace('/403'); return; }
      setUser(u);
      setRole(r);
    });
  }, [router]);

  useEffect(() => {
    if (!role) return;
    fetch('/api/tracks', { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(json => {
        if (!json?.data) return;
        const list: UploadedTrack[] = Array.isArray(json.data) ? json.data : [];
        setUploadedList(list);
      })
      .catch(() => {});
  }, [role, uploadedTrack]);

  const handleFile = (f: File) => {
    if (!f.type.startsWith('audio/') && f.type !== 'video/mp4') {
      setErrorMsg('Chỉ chấp nhận file âm thanh (aac, m4a, mp4...)');
      return;
    }
    setFile(f);
    setStatus('idle');
    setErrorMsg('');
    setUploadedTrack(null);
  };

  const handleUpload = async () => {
    if (!file) return;
    setStatus('uploading');
    setErrorMsg('');

    try {
      // ── Tạo DPoP proof cho upload endpoint ───────────────────────────────
      // Import jose dynamic để chạy phía client
      const jose = await import('jose');

      const { privateKey, publicKey } = await jose.generateKeyPair('ES256', { extractable: true });
      const publicJwk = await jose.exportJWK(publicKey);

      const uploadUrl = `${window.location.origin}/api/ingest/upload`;

      // Đọc ath từ cookie dpop_ath (non-HttpOnly, set lúc login)
      const ath = document.cookie
        .split('; ')
        .find(c => c.startsWith('dpop_ath='))
        ?.split('=')[1];

      if (!ath) {
        setStatus('error');
        setErrorMsg('Phiên đăng nhập hết hạn. Vui lòng đăng nhập lại.');
        return;
      }

      const dpopProof = await new jose.SignJWT({
        jti: crypto.randomUUID(),
        htm: 'POST',
        htu: uploadUrl,
        ath,
      })
        .setProtectedHeader({ alg: 'ES256', typ: 'dpop+jwt', jwk: publicJwk })
        .setIssuedAt()
        .setExpirationTime('2m')
        .sign(privateKey);

      // ── Gửi file kèm DPoP proof ───────────────────────────────────────────
      const formData = new FormData();
      formData.append('audio', file);   // field name 'audio' khớp với route

      const res = await fetch('/api/ingest/upload', {
        method:      'POST',
        credentials: 'include',         // gửi kèm HttpOnly cookie
        headers:     { 'DPoP': dpopProof },
        body:        formData,
      });

      const json = await res.json();

      if (!res.ok) {
        setStatus('error');
        setErrorMsg(json.error || `Lỗi ${res.status}`);
        return;
      }

      const track: UploadedTrack = {
        id:        json.data.trackId,
        filename:  json.data.filename,
        duration:  json.data.duration ?? 0,
        kid:       json.data.kid,
        createdAt: json.data.createdAt,
      };

      setUploadedTrack(track);
      setStatus('success');
      setFile(null);

    } catch (err: any) {
      setStatus('error');
      setErrorMsg(err.message || 'Lỗi kết nối');
    }
  };

  const fmt = (s: number) => `${Math.floor(s / 60)}m ${Math.floor(s % 60)}s`;

  return (
    <div className="flex h-screen bg-black text-white font-sans overflow-hidden select-none">
      <Sidebar role={role} currentPath="/upload" />

      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex justify-between items-center px-6 py-4 border-b border-gray-900 bg-black/40 backdrop-blur-md">
          <h1 className="text-lg font-bold flex items-center gap-2">
            <Upload size={20} className="text-emerald-500" /> Upload nhạc
          </h1>
          <div className="flex items-center gap-3">
            {user && (
              <span className="text-xs text-gray-400 font-mono">
                {(user as any).preferred_username}
              </span>
            )}
            <span className="hidden sm:flex items-center gap-1.5 text-[10px] font-mono text-emerald-400
                             bg-emerald-950/40 border border-emerald-900/40 px-2.5 py-1 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse inline-block" />
              DPoP Active
            </span>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-8 bg-gradient-to-b from-gray-900 to-black">
          <div className="max-w-2xl mx-auto flex flex-col gap-6">

            {/* Drop zone */}
            <div
              onDragOver={e => { e.preventDefault(); setIsDragOver(true); }}
              onDragLeave={() => setIsDragOver(false)}
              onDrop={e => { e.preventDefault(); setIsDragOver(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-2xl p-12 flex flex-col items-center justify-center gap-4 cursor-pointer transition-all duration-200
                ${isDragOver
                  ? 'border-emerald-500 bg-emerald-950/20'
                  : file
                  ? 'border-emerald-700 bg-emerald-950/10'
                  : 'border-gray-700 hover:border-gray-600 hover:bg-gray-900/30'}`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".aac,.m4a,.mp4,audio/*"
                className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
              />
              {file ? (
                <>
                  <FileAudio size={48} className="text-emerald-500" />
                  <div className="text-center">
                    <p className="font-bold text-white">{file.name}</p>
                    <p className="text-xs text-gray-400 font-mono mt-1">
                      {(file.size / 1024 / 1024).toFixed(2)} MB · {file.type}
                    </p>
                  </div>
                  <p className="text-xs text-gray-500">Click để chọn file khác</p>
                </>
              ) : (
                <>
                  <Upload size={48} className="text-gray-600" />
                  <div className="text-center">
                    <p className="font-semibold text-gray-300">Kéo thả file nhạc vào đây</p>
                    <p className="text-xs text-gray-500 mt-1">hoặc click để chọn · AAC, M4A</p>
                  </div>
                </>
              )}
            </div>

            {/* Error */}
            {errorMsg && (
              <div className="flex items-center gap-3 bg-red-950/40 border border-red-900/50 rounded-xl px-4 py-3 text-sm text-red-400 font-mono">
                <AlertCircle size={16} className="shrink-0" />
                {errorMsg}
              </div>
            )}

            {/* Upload button */}
            {file && status !== 'success' && (
              <button
                onClick={handleUpload}
                disabled={status === 'uploading'}
                className="flex items-center justify-center gap-3 w-full py-3.5 rounded-xl font-bold text-sm
                           bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed
                           transition-all duration-200 text-white"
              >
                {status === 'uploading' ? (
                  <><Loader2 size={18} className="animate-spin" /> Đang mã hóa & upload...</>
                ) : (
                  <><Upload size={18} /> Upload & Encrypt</>
                )}
              </button>
            )}

            {/* Success result */}
            {status === 'success' && uploadedTrack && (
              <div className="bg-emerald-950/30 border border-emerald-800/40 rounded-2xl p-6 flex flex-col gap-3">
                <div className="flex items-center gap-2 text-emerald-400 font-bold">
                  <CheckCircle2 size={20} /> Upload thành công!
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                  {[
                    ['Track ID',  uploadedTrack.id],
                    ['Filename',  uploadedTrack.filename],
                    ['KID',       uploadedTrack.kid],
                    ['Duration',  fmt(uploadedTrack.duration)],
                  ].map(([k, v]) => (
                    <div key={k} className="col-span-2 flex gap-2">
                      <span className="text-gray-500 w-20 shrink-0">{k}</span>
                      <span className="text-gray-300 truncate">{v}</span>
                    </div>
                  ))}
                </div>
                <button
                  onClick={() => { setStatus('idle'); setUploadedTrack(null); }}
                  className="mt-2 text-xs text-emerald-400 hover:text-emerald-300 underline underline-offset-4 text-left"
                >
                  Upload bài khác
                </button>
              </div>
            )}

            {/* Uploaded list */}
            {uploadedList.length > 0 && (
              <div className="mt-4">
                <p className="text-[10px] font-mono text-gray-500 uppercase tracking-widest mb-3">
                  Đã upload ({uploadedList.length} bài)
                </p>
                <div className="flex flex-col gap-2">
                  {uploadedList.map(track => (
                    <div key={track.id}
                      className="flex items-center gap-3 bg-[#121212] border border-gray-900 rounded-xl p-3 hover:border-gray-800 transition-colors">
                      <div className="w-10 h-10 bg-gradient-to-br from-emerald-700 to-teal-900 rounded-lg flex items-center justify-center shrink-0">
                        <Music2 size={18} className="text-emerald-300" />
                      </div>
                      <div className="flex-1 overflow-hidden">
                        <p className="text-sm font-bold text-white truncate">{track.filename}</p>
                        <p className="text-[10px] text-gray-500 font-mono">
                          KID: {track.kid.substring(0, 12)}... · {fmt(track.duration)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

          </div>
        </div>
      </div>
    </div>
  );
}