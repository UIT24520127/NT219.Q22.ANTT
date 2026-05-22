"use client";
import React, { useEffect, useRef } from 'react';

export default function PlayerPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const playerRef = useRef<any>(null);

  useEffect(() => {
    // Khởi tạo Shaka Player trên Client-side
    const initPlayer = async () => {
const shaka: any = await import('shaka-player/dist/shaka-player.compiled.js');      shaka.polyfill.installAll();

      if (!shaka.Player.isBrowserSupported()) {
        console.error('Trình duyệt của bạn không hỗ trợ Shaka Player!');
        return;
      }

      const video = videoRef.current;
      if (!video) return;

      const player = new shaka.Player(video);
      playerRef.current = player;

      // =====================================================================
      // 🚨 ĐÂY LÀ PHẦN "BẺ LÁI" WIDEVINE CHALLENGE (KPI TUẦN 2) 🚨
      // =====================================================================
      player.getNetworkingEngine().registerRequestFilter((type: any, request: any) => {
        // Nếu phát hiện player định gửi request đi xin khóa (LICENSE)
        if (type === shaka.net.NetworkingEngine.RequestType.LICENSE) {
          console.log("🛑 Đã chặn bản tin Widevine Challenge gốc từ trình duyệt!");
          console.log("🔄 Đang đóng gói và bẻ lái gửi về Proxy nội bộ của nhóm (/api/license)...");
          
          // Ghi đè đường dẫn, ép nó ném Challenge về API của Người A (Đức Anh)
          request.uris = ['http://localhost:3000/api/license'];
        }
      });

      // Cấu hình DRM mặc định trỏ về hàm nội bộ
      player.configure({
        drm: {
          servers: { 'com.widevine.alpha': 'http://localhost:3000/api/license' }
        }
      });
      // =====================================================================

      try {
        // Link manifest test chuẩn của Shaka. (Tuần sau Người B băm nhạc xong sẽ đổi link này)
        const manifestUri = 'https://storage.googleapis.com/shaka-demo-assets/sintel-widevine/dash.mpd';        await player.load(manifestUri);
        console.log('✅ Video đã load thành công!');
      } catch (e) {
        console.error('❌ Lỗi khi load video', e);
      }
    };

    initPlayer();

    return () => {
      if (playerRef.current) playerRef.current.destroy();
    };
  }, []);

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-950 p-6">
      <h1 className="text-3xl font-bold text-white mb-2">DRM Secure Player</h1>
      <p className="text-gray-400 mb-8">Hệ thống Trình phát nhạc chống tải lậu - Tuần 2</p>
      
      <div className="w-full max-w-4xl bg-black rounded-xl overflow-hidden shadow-2xl border border-gray-800">
        <video
          ref={videoRef}
          className="w-full aspect-video"
          controls
          autoPlay
          controlsList="nodownload" // Tắt nút tải xuống của trình duyệt
        ></video>
      </div>
    </div>
  );
}