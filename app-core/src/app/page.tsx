"use client";
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useEffect, useState } from 'react';

export default function HomePage() {
  const router = useRouter();
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  // Kiểm tra trạng thái lúc load trang để hiển thị UI cho phù hợp
  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) {
      setIsLoggedIn(true);
    }
  }, []);

  // KHỐI LOGIC THỐNG NHẤT THEO YÊU CẦU CỦA SẾP
  const handlePlayMusic = () => {
    const token = localStorage.getItem('token'); // Lấy Token bảo mật
    
    if (!token) {
      // Cái thứ 3: Chưa đăng nhập -> Đá sang trang Login
      console.log("🔒 Chưa xác thực: Chuyển hướng sang trang Đăng nhập.");
      router.push('/login');
    } else {
      // Cái thứ 2: Đã đăng nhập -> Mở trang Player nghe nhạc bản quyền
      console.log("🔓 Đã xác thực: Mở luồng DRM Player.");
      router.push('/player');
    }
  };

  return (
    <div className="flex h-screen bg-black text-white font-sans overflow-hidden">
      
      {/* ==================== SIDEBAR TRÁI ==================== */}
      <div className="w-64 bg-black p-6 hidden md:flex flex-col gap-8">
        <div className="text-2xl font-bold tracking-tighter flex items-center gap-2">
          <span className="text-blue-500 text-3xl">♪</span> UITify DRM
        </div>
        <div className="flex flex-col gap-5 text-gray-400 font-semibold text-sm">
          <span className="text-white cursor-pointer transition-colors duration-200 flex items-center gap-4">
            🏠 Trang chủ
          </span>
          <span className="hover:text-white cursor-pointer transition-colors duration-200 flex items-center gap-4">
            🔍 Tìm kiếm
          </span>
          <span className="hover:text-white cursor-pointer transition-colors duration-200 flex items-center gap-4">
            📚 Thư viện
          </span>
        </div>
      </div>

      {/* ==================== NỘI DUNG CHÍNH ==================== */}
      <div className="flex-1 bg-gradient-to-b from-gray-900 to-black overflow-y-auto rounded-lg m-2 relative">
        
        {/* Header - Thanh điều hướng & Nút Auth */}
        <div className="flex justify-between items-center p-4 sticky top-0 bg-black/40 backdrop-blur-md z-10">
          <div className="flex gap-2">
            <div className="w-8 h-8 rounded-full bg-black/60 flex items-center justify-center cursor-not-allowed opacity-60">{'<'}</div>
            <div className="w-8 h-8 rounded-full bg-black/60 flex items-center justify-center cursor-not-allowed opacity-60">{'>'}</div>
          </div>
          <div>
            {isLoggedIn ? (
              <button 
                onClick={() => {
                  localStorage.removeItem('token');
                  window.location.reload();
                }}
                className="bg-red-500/20 text-red-500 border border-red-500 px-6 py-2.5 rounded-full font-bold hover:bg-red-500 hover:text-white transition-all duration-200"
              >
                Đăng xuất
              </button>
            ) : (
              <Link href="/login">
                <button className="bg-white text-black px-6 py-2.5 rounded-full font-bold hover:scale-105 transition-transform duration-200">
                  Đăng nhập
                </button>
              </Link>
            )}
          </div>
        </div>

        {/* Lưới danh sách nhạc (Playlist Grid) */}
        <div className="p-6">
          <h2 className="text-2xl font-bold mb-6 hover:underline cursor-pointer">Bản quyền phát hành mới</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
            
            {/* Card Nhạc - Có gắn sự kiện kiểm tra Auth */}
            <div onClick={handlePlayMusic} className="bg-[#181818] p-4 rounded-md hover:bg-[#282828] transition-colors duration-300 cursor-pointer group relative">
              <div className="aspect-square bg-gradient-to-br from-blue-600 to-purple-600 rounded-md mb-4 shadow-lg flex items-center justify-center text-5xl">
                🎸
              </div>
              {/* Nút Play xanh lá thần thánh */}
              <div className="absolute right-6 bottom-20 bg-green-500 rounded-full p-3 opacity-0 group-hover:opacity-100 translate-y-2 group-hover:translate-y-0 transition-all duration-300 shadow-xl">
                <svg role="img" height="24" width="24" viewBox="0 0 24 24" fill="black"><path d="M7.05 3.606l13.49 7.788a.7.7 0 010 1.212L7.05 20.394A.7.7 0 016 19.788V4.212a.7.7 0 011.05-.606z"></path></svg>
              </div>
              <h3 className="font-bold truncate mb-1">Acoustic Chill</h3>
              <p className="text-xs text-gray-400 truncate">Bảo vệ bởi Widevine DRM</p>
            </div>

            <div onClick={handlePlayMusic} className="bg-[#181818] p-4 rounded-md hover:bg-[#282828] transition-colors duration-300 cursor-pointer group relative">
              <div className="aspect-square bg-gradient-to-br from-green-500 to-emerald-800 rounded-md mb-4 shadow-lg flex items-center justify-center text-5xl">
                🎧
              </div>
              <div className="absolute right-6 bottom-20 bg-green-500 rounded-full p-3 opacity-0 group-hover:opacity-100 translate-y-2 group-hover:translate-y-0 transition-all duration-300 shadow-xl">
                <svg role="img" height="24" width="24" viewBox="0 0 24 24" fill="black"><path d="M7.05 3.606l13.49 7.788a.7.7 0 010 1.212L7.05 20.394A.7.7 0 016 19.788V4.212a.7.7 0 011.05-.606z"></path></svg>
              </div>
              <h3 className="font-bold truncate mb-1">Lofi Coding</h3>
              <p className="text-xs text-gray-400 truncate">Mã hóa ECDH P-256</p>
            </div>

            <div onClick={handlePlayMusic} className="bg-[#181818] p-4 rounded-md hover:bg-[#282828] transition-colors duration-300 cursor-pointer group relative">
              <div className="aspect-square bg-gradient-to-br from-orange-500 to-red-600 rounded-md mb-4 shadow-lg flex items-center justify-center text-5xl">
                🔥
              </div>
              <div className="absolute right-6 bottom-20 bg-green-500 rounded-full p-3 opacity-0 group-hover:opacity-100 translate-y-2 group-hover:translate-y-0 transition-all duration-300 shadow-xl">
                <svg role="img" height="24" width="24" viewBox="0 0 24 24" fill="black"><path d="M7.05 3.606l13.49 7.788a.7.7 0 010 1.212L7.05 20.394A.7.7 0 016 19.788V4.212a.7.7 0 011.05-.606z"></path></svg>
              </div>
              <h3 className="font-bold truncate mb-1">Top Hits 2026</h3>
              <p className="text-xs text-gray-400 truncate">Shaka Player Engine</p>
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}