"use client";
import React, { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

let globalKeyPair: CryptoKeyPair | null = null;
let globalPublicKeyHex = "";

export default function CustomPlayerPage() {
  const router = useRouter();
  const [isPlaying, setIsPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Sử dụng ref cho thẻ HTMLAudioElement và MediaSource
  const audioRef = useRef<HTMLAudioElement>(null);
  const mediaSourceRef = useRef<MediaSource | null>(null);
  const sourceBufferRef = useRef<SourceBuffer | null>(null);

  useEffect(() => {
    const initECDH = async () => {
      if (!globalKeyPair) {
        console.log("🔑 [Client] Khởi tạo cặp khóa trao đổi ECDH (P-256)...");
        globalKeyPair = await window.crypto.subtle.generateKey(
          { name: "ECDH", namedCurve: "P-256" },
          true,
          ["deriveKey", "deriveBits"]
        );
        const exported = await window.crypto.subtle.exportKey("raw", globalKeyPair.publicKey);
        globalPublicKeyHex = Array.from(new Uint8Array(exported))
          .map(b => b.toString(16).padStart(2, '0'))
          .join('');
        console.log("✅ [Client] Public Key sẵn sàng đưa vào Header:", globalPublicKeyHex);
      }
    };
    initECDH();
  }, []);

  const playSong = async () => {
    setError(null);
    try {
      if (!globalKeyPair) throw new Error("Hệ thống ECDH chưa khởi tạo xong!");

      // 1. Gửi yêu cầu lấy License chứa wrapped CEK từ backend
      console.log("📡 [Network] Đang gửi yêu cầu bắt tay lấy License...");
      const token = localStorage.getItem('token') || 'mock-token-uit-2026';
      
      const licenseRes = await fetch("http://localhost:3000/api/license", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "authorization": `Bearer ${token}`,
          // Sử dụng đúng KID đồng bộ với hệ thống file mã hóa trên R2 của ông
          "x-kid": "75635febb8a5be6b233b566534e225ad",
          "x-client-public-key": globalPublicKeyHex,
        },
        body: JSON.stringify({}),
      });

      if (!licenseRes.ok) throw new Error(`Lỗi kết nối License Server: Status ${licenseRes.status}`);
      
      // Khôi phục mảng byte nhị phân phản hồi từ License Server
      const responseBuffer = new Uint8Array(await licenseRes.arrayBuffer());
      const payloadLen = (responseBuffer[0] << 24) | (responseBuffer[1] << 16) | (responseBuffer[2] << 8) | responseBuffer[3];
      const payloadBytes = responseBuffer.slice(4, 4 + payloadLen);
      const licenseData = JSON.parse(new TextDecoder().decode(payloadBytes));
      
      console.log("📥 [Client] Đã nhận dữ liệu mã hóa License thành công!");

      // Helper hỗ trợ chuyển đổi chuỗi mã Hex thành Array vị trí Byte
      const hexToBytes = (hex: string) => new Uint8Array(hex.match(/.{1,2}/g)?.map((b: string) => parseInt(b, 16)) || []);

      // 2. Nhập Public Key của Server vào RAM Client
      const serverPublicKey = await crypto.subtle.importKey(
        "raw", 
        hexToBytes(licenseData.serverPublicKeyHex || licenseData.serverPublicKey),
        { name: "ECDH", namedCurve: "P-256" }, 
        false, 
        []
      );

// 3. Tính toán Shared Secret Key (Khóa bí mật dùng chung) bằng thuật toán ECDH
const sharedSecret = await crypto.subtle.deriveKey(
  { name: "ECDH", public: serverPublicKey },
  globalKeyPair.privateKey,
  { name: "AES-GCM", length: 256 },
  false,
  ["decrypt"]
);

// 4. Giải mã lớp bọc mật mã AES-GCM (Unwrap) để thu hồi khóa nội dung gốc (CEK)
const ivBytes = hexToBytes(licenseData.ivHex || licenseData.iv);
const wrappedBytes = hexToBytes(licenseData.encryptedCekHex || licenseData.wrappedCek);

let cekBuffer;
try {
  // BỔ SUNG CHÍNH XÁC THAM SỐ tagLength: 128 Ở ĐÂY
  cekBuffer = await crypto.subtle.decrypt(
    { 
      name: "AES-GCM", 
      iv: ivBytes,
      tagLength: 128 // 128 bits = 16 bytes chuẩn mã hóa Node.js sinh ra
    },
    sharedSecret,
    wrappedBytes
  );
  console.log("✅ [Web Crypto SUCCESS] Gỡ bọc ECDH lấy lại CEK bản rõ thành công rực rỡ!");
} catch (cryptoError) {
  console.error("🚨 [Web Crypto FATAL] Không thể gỡ bọc do lệch cấu trúc mảng Byte:", cryptoError);
  throw cryptoError;
}

      console.log("✅ [Client] Tiến trình bóc tách mật mã thành công! Đã có khóa CEK bản rõ trên RAM.");

      // =========================================================================
// 5. Tải tệp âm thanh phân đoạn segment.mp4 từ Cloudflare R2 / Local Gateway
// =========================================================================
console.log("📡 [Network] Đang tải trực tiếp file phân đoạn segment.mp4...");
const segmentUri = `http://localhost:3000/audio/segments/0ee52ddd-a7b2-474d-9044-c9a33e1397ec/segment.mp4`;



      mediaSource.addEventListener('sourceopen', () => {
        // Khởi tạo kênh nạp dạng âm thanh MP4 với codec mã hóa chung audio/mp4
        const sourceBuffer = mediaSource.addSourceBuffer('audio/mp4; codecs="mp4a.40.2"');
        sourceBufferRef.current = sourceBuffer;

        // Tiến hành bơm mảng byte âm thanh đã giải mã sạch hoàn toàn vào lõi phát trình duyệt
        sourceBuffer.appendBuffer(decryptedAudioBuffer);

        sourceBuffer.addEventListener('updateend', () => {
          // Báo hiệu cho MediaSource biết đã nạp xong toàn bộ dữ liệu âm thanh và bắt đầu phát nhạc
          if (mediaSource.readyState === 'open') {
            mediaSource.endOfStream();
            audio.play().then(() => {
              setIsPlaying(true);
              console.log("🎉 [Custom Player] Âm thanh đã được phát thành công!");
            }).catch(e => console.error("Lỗi tự động phát âm thanh:", e));
          }
        });
      });

    } catch (err: any) {
      console.error("❌ Lỗi phát nhạc trên Custom Player:", err);
      setError(err.message);
    }
  };

  const stopPlay = () => {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.src = "";
    }
    if (mediaSourceRef.current && mediaSourceRef.current.readyState === 'open') {
      mediaSourceRef.current.endOfStream();
    }
    setIsPlaying(false);
  };

  return (
    <div className="min-h-screen bg-gray-950 p-6 flex flex-col items-center justify-center relative">
      <button onClick={() => router.push('/')} className="absolute top-6 left-6 flex items-center gap-2 bg-gray-900 border border-gray-800 text-gray-300 px-4 py-2 rounded-full font-semibold hover:bg-gray-800 hover:text-white transition-all duration-200 shadow-md">
        ✕ Quay lại
      </button>

      <h1 className="text-3xl font-bold text-white mb-2">Custom Byte-Stream Player</h1>
      <p className="text-gray-400 mb-10">Giải mã mảng byte nhị phân trực tiếp trên RAM | Đồ án Mật Mã NT219</p>
      
      <div className="w-full max-w-2xl bg-gray-900 rounded-2xl shadow-xl border border-gray-800 p-6 flex items-center gap-5 transition-all hover:border-gray-700">
        <div className="w-20 h-20 bg-emerald-600 rounded-xl flex items-center justify-center shadow-md border-2 border-emerald-500">
          <span className="text-white text-5xl font-mono">♪</span>
        </div>
        
        <div className="flex-1 flex flex-col gap-4">
          <div>
            <p className="text-white font-bold text-lg">Secure Audio Stream (MSE Bypass DRM 6006)</p>
            <p className="text-gray-500 text-sm">ECDH Private Key Derived Shared Secret → In-Memory AES-CTR Decryption</p>
          </div>

          {/* Thẻ audio ẩn xử lý bằng MediaSource */}
          <audio ref={audioRef} className="hidden" controlsList="nodownload"></audio>

          <div className="flex gap-4">
            <button onClick={playSong} disabled={isPlaying} className="bg-blue-600 hover:bg-blue-500 text-white px-6 py-3 rounded-xl font-semibold disabled:opacity-50 disabled:pointer-events-none transition-all shadow-md flex items-center gap-2">
              ▶ Phát nhạc
            </button>
            <button onClick={stopPlay} disabled={!isPlaying} className="bg-red-600 hover:bg-red-500 text-white px-6 py-3 rounded-xl font-semibold disabled:opacity-50 disabled:pointer-events-none transition-all shadow-md flex items-center gap-2">
              ⏹ Dừng
            </button>
          </div> 
        </div>
      </div>
      
      {error && <div className="mt-6 w-full max-w-2xl p-4 bg-red-900/40 border border-red-800/60 text-red-300 rounded-xl shadow-inner text-sm">Lỗi: {error}</div>}
      
      <div className="mt-6 w-full max-w-2xl p-4 bg-gray-900 rounded-xl border border-gray-800 shadow-md">
        <p className="text-sm text-gray-400 font-semibold mb-1">🔐 Luồng an toàn mật mã học:</p>
        <p className="text-xs text-gray-500 leading-relaxed">
          Trao đổi khóa bất đối xứng ECDH (P-256) sinh ra Shared Secret ➔ Giải mã Gói tin mã hóa AES-GCM thu được khóa nội dung CEK thô trên RAM ➔ Hàm `crypto.subtle.decrypt` bóc sạch lớp mã hóa AES-CTR 128-bit của tệp tin `segment.mp4` và nạp thẳng mảng byte sạch vào MediaSourceBuffer để phát nhạc. Trình duyệt không kích hoạt EME bảo mật nên bẻ gãy hoàn toàn lỗi DRM 6006!
        </p>
      </div>
    </div>
  );
}