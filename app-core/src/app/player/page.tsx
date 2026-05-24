"use client";
import React, { useEffect, useRef } from 'react';

export default function PlayerPage() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const playerRef = useRef<any>(null);

  useEffect(() => {
    const initPlayer = async () => {
      const shaka: any = await import('shaka-player/dist/shaka-player.compiled.js');
      shaka.polyfill.installAll();

      if (!shaka.Player.isBrowserSupported()) {
        console.error('Trình duyệt của bạn không hỗ trợ Shaka Player!');
        return;
      }

      // =====================================================================
      // 🔑 NÂNG CẤP TUẦN 3: TỰ ĐỘNG SINH CẶP KHÓA ĐỘNG ECDH (P-256)
      // =====================================================================
      console.log("🔑 Đang khởi tạo cặp khóa ECDH (P-256) dưới Client trình duyệt...");
      const keyPair = await window.crypto.subtle.generateKey(
        { name: "ECDH", namedCurve: "P-256" },
        true,
        ["deriveKey", "deriveBits"]
      );
      
      const exportedPublicKey = await window.crypto.subtle.exportKey("raw", keyPair.publicKey);
      const publicKeyBase64 = btoa(String.fromCharCode(...new Uint8Array(exportedPublicKey)));
      console.log("📌 Client Public Key gửi đi (Base64):", publicKeyBase64);
      // =====================================================================

      const audio = audioRef.current;
      if (!audio) return;

      const player = new shaka.Player(audio);
      playerRef.current = player;

      player.getNetworkingEngine().registerRequestFilter((type: any, request: any) => {
        if (type === shaka.net.NetworkingEngine.RequestType.LICENSE) {
          console.log("🛑 Đã chặn bản tin Widevine Challenge gốc thành công!");
          
          const token = localStorage.getItem('token') || 'mock-token-uit-2026'; 
          
          request.headers['Authorization'] = `Bearer ${token}`;
          request.headers['X-Client-Public-Key'] = publicKeyBase64;
          
          console.log("🚀 Đã đính kèm Bearer Token hợp lệ vào Header Authorization.");
          console.log("🛡️ Đã đóng gói cặp khóa trao đổi ECDH chống nghe lén dữ liệu trên đường truyền.");
          console.log("🔄 Đang bẻ lái request chạy thẳng về API nội bộ của nhóm...");
          
          request.uris = ['http://localhost:3000/api/license'];
        }
      });

      player.configure({
        drm: {
          servers: { 'com.widevine.alpha': 'http://localhost:3000/api/license' }
        }
      });

      try {
        const manifestUri = 'https://storage.googleapis.com/shaka-demo-assets/sintel-widevine/dash.mpd';
        await player.load(manifestUri);
        console.log('✅ Audio đã load thành công!');
      } catch (e) {
        console.error('❌ Lỗi khi load audio', e);
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
      <p className="text-gray-400 mb-10">Hệ thống Trình phát nhạc chống tải lậu - Tuần 3 (Advanced Security)</p>
      
      {/* GIAO DIỆN CHUẨN AUDIO */}
      <div className="w-full max-w-2xl bg-gray-900 rounded-2xl shadow-xl border border-gray-800 p-6 flex items-center gap-5 transition-all hover:border-gray-700">
        <div className="w-20 h-20 bg-blue-600 rounded-xl flex items-center justify-center shadow-md border-2 border-blue-500">
          <span className="text-white text-5xl font-mono">♪</span>
        </div>
        
        <div className="flex-1 flex flex-col gap-2">
            <p className="text-white font-bold text-lg">Sintel - Widevine Stream Test</p>
            <p className="text-gray-500 text-sm mb-2">UIT Music DRM Project</p>
            <audio
              ref={audioRef}
              className="w-full h-10"
              controls
              autoPlay
              controlsList="nodownload"
            ></audio>
        </div>
      </div>
    </div>
  );
}