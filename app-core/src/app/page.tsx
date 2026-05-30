"use client";
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useEffect, useState } from 'react';

interface TrackItem {
  id: string;
  filename: string;
  duration: number;
  kid: string;
  createdAt: string;
}

const cardEmojis = ["🎸", "🎧", "🔥", "🎵", "🎹", "🎼", "🎺", "🥁", "🎻", "🪗"];

export default function HomePage() {
  const router = useRouter();
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [tracks, setTracks] = useState<TrackItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('token');
    setIsLoggedIn(!!token);

    const fetchAllTracks = async () => {
      try {
        // Gọi API danh sách — không truyền trackId để lấy tất cả
        const res = await fetch('/api/ingest/upload');
        if (res.ok) {
          const json = await res.json();
          // Hỗ trợ cả hai dạng response: { data: [tracks] } hoặc { data: { tracks: [] } }
          const list: TrackItem[] =
            Array.isArray(json.data)
              ? json.data
              : Array.isArray(json.data?.tracks)
              ? json.data.tracks
              : json.data?.track
              ? [json.data.track]
              : [];
          setTracks(list);
        }
      } catch (error) {
        console.error('⚠️ Không thể tải danh sách bài hát:', error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchAllTracks();
  }, []);

  const handlePlayMusic = (trackId: string) => {
    const token = localStorage.getItem('token');
    if (!token) {
      router.push('/login');
    } else {
      router.push(`/player?trackId=${trackId}`);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('refresh_token');
    setIsLoggedIn(false);
  };

  return (
    <div className="flex h-screen bg-black text-white font-sans overflow-hidden select-none">

      {/* ── Sidebar ── */}
      <div className="w-64 bg-black p-6 hidden md:flex flex-col gap-8 border-r border-gray-950">
        <div className="text-2xl font-bold tracking-tighter flex items-center gap-2">
          <span className="text-emerald-500 text-3xl">♪</span> UITify
        </div>
        <div className="flex flex-col gap-5 text-gray-400 font-semibold text-sm">
          <span className="text-white cursor-pointer flex items-center gap-4">
            🏠 Trang chủ
          </span>
          <span className="opacity-50 cursor-not-allowed flex items-center gap-4">
            🔍 Tìm kiếm (Disabled)
          </span>
          <span className="opacity-50 cursor-not-allowed flex items-center gap-4">
            📚 Thư viện (Disabled)
          </span>
        </div>

        {/* Security stack badge ở cuối sidebar */}
        <div className="mt-auto p-3 bg-gray-950 border border-gray-900 rounded-xl text-[10px] font-mono text-gray-500 flex flex-col gap-1">
          <span className="text-emerald-500 font-bold text-[11px] mb-1">🔐 Security Stack</span>
          <span>✓ AES-128 CENC</span>
          <span>✓ ECDH P-256</span>
          <span>✓ ECDSA Signing</span>
          <span className="text-emerald-400">✓ DPoP RFC 9449</span>
          <span>✓ OpenBao KMS</span>
        </div>
      </div>

      {/* ── Main content ── */}
      <div className="flex-1 bg-gradient-to-b from-gray-900 to-black overflow-y-auto rounded-lg m-2 relative">

        {/* Sticky header */}
        <div className="flex justify-between items-center p-4 sticky top-0 bg-black/40 backdrop-blur-md z-10">
          <div className="flex gap-2">
            <div className="w-8 h-8 rounded-full bg-black/60 flex items-center justify-center cursor-not-allowed opacity-60">{'<'}</div>
            <div className="w-8 h-8 rounded-full bg-black/60 flex items-center justify-center cursor-not-allowed opacity-60">{'>'}</div>
          </div>
          <div className="flex items-center gap-3">
            {/* DPoP indicator — chỉ hiện khi đã đăng nhập */}
            {isLoggedIn && (
              <span className="hidden sm:flex items-center gap-1.5 text-[10px] font-mono text-emerald-400 bg-emerald-950/40 border border-emerald-900/40 px-2.5 py-1 rounded-full">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse inline-block" />
                DPoP Active
              </span>
            )}
            {isLoggedIn ? (
              <button
                onClick={handleLogout}
                className="bg-red-500/10 text-red-400 border border-red-900/50 px-6 py-2 rounded-full font-bold text-sm hover:bg-red-500 hover:text-white transition-all duration-200"
              >
                Đăng xuất
              </button>
            ) : (
              <Link href="/login">
                <button className="bg-white text-black px-6 py-2 rounded-full font-bold text-sm hover:scale-105 transition-transform duration-200">
                  Đăng nhập
                </button>
              </Link>
            )}
          </div>
        </div>

        {/* Track grid */}
        <div className="p-6">
          <h2 className="text-2xl font-bold mb-1">Bản quyền phát hành mới</h2>
          <p className="text-gray-400 text-xs mb-6">
            Bảo vệ bởi CENC + ECDH + DPoP (RFC 9449) + OpenBao KMS
          </p>

          {isLoading ? (
            <div className="flex items-center gap-3 text-sm text-emerald-400 font-mono">
              <div className="w-4 h-4 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
              Đang đồng bộ danh sách bài hát mã hóa...
            </div>
          ) : tracks.length === 0 ? (
            <div className="p-8 bg-gray-900/40 border border-gray-800 rounded-xl text-center text-sm text-gray-500 font-mono">
              ⚠️ Hệ thống chưa ghi nhận bản nhạc nào. Vui lòng chạy luồng Ingest trước!
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
              {tracks.map((track, index) => (
                <div
                  key={track.id}
                  onClick={() => handlePlayMusic(track.id)}
                  className="bg-[#121212] border border-gray-900 p-4 rounded-xl hover:bg-[#1c1c1c] hover:border-gray-800 transition-all duration-300 cursor-pointer group relative"
                >
                  {/* Cover art */}
                  <div className="aspect-square bg-gradient-to-br from-emerald-600 to-teal-900 rounded-lg mb-4 shadow-lg flex items-center justify-center text-5xl group-hover:scale-[1.02] transition-transform duration-300">
                    {cardEmojis[index % cardEmojis.length]}
                  </div>

                  {/* Play button */}
                  <div className="absolute right-6 bottom-24 bg-emerald-500 rounded-full p-3 opacity-0 group-hover:opacity-100 translate-y-3 group-hover:translate-y-0 transition-all duration-300 shadow-xl z-10">
                    <svg role="img" height="20" width="20" viewBox="0 0 24 24" fill="black">
                      <path d="M7.05 3.606l13.49 7.788a.7.7 0 010 1.212L7.05 20.394A.7.7 0 016 19.788V4.212a.7.7 0 011.05-.606z" />
                    </svg>
                  </div>

                  <h3 className="font-bold text-sm text-white truncate mb-1 pr-2">
                    {track.filename}
                  </h3>
                  <p className="text-[11px] text-gray-400 font-mono truncate mb-2">
                    KID: {track.kid.substring(0, 8)}...
                  </p>

                  <div className="flex items-center justify-between mt-3 pt-2 border-t border-gray-900 text-[10px] text-gray-500 font-mono">
                    <span>⏱️ {Math.floor(track.duration / 60)}m {track.duration % 60}s</span>
                    {/* Badge cập nhật tuần 4 */}
                    <span className="text-emerald-400 bg-emerald-950/40 px-1.5 py-0.5 rounded border border-emerald-900/30 whitespace-nowrap">
                      DPoP+ECDH
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}