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

      // 3. 🔥 [ĐỒNG BỘ MẬT MÃ KDF]: Tính toán Shared Secret và băm SHA-256 như phía Server
      console.log("🔐 [Crypto] Dẫn xuất Shared Secret và chạy hàm băm KDF SHA-256...");
      const sharedSecretBits = await crypto.subtle.deriveBits(
        { name: "ECDH", public: serverPublicKey },
        globalKeyPair.privateKey,
        256
      );

      const hashedSecretBits = await crypto.subtle.digest("SHA-256", sharedSecretBits);

      const derivedKey = await crypto.subtle.importKey(
        "raw",
        hashedSecretBits,
        { name: "AES-GCM" },
        true, // Cần đặt là true để có thể exportKey kiểm tra gỡ lỗi
        ["decrypt"]
      );

      // 4. Giải mã lớp bọc mật mã AES-GCM (Unwrap) để thu hồi khóa nội dung gốc (CEK)
      const ivBytes = hexToBytes(licenseData.ivHex || licenseData.iv);
      const wrappedBytes = hexToBytes(licenseData.encryptedCekHex || licenseData.wrappedCek);

      // Gỡ lỗi in các tham số phía Browser
      const exportedRaw = await crypto.subtle.exportKey("raw", derivedKey);
      const aesKeyHex = Array.from(new Uint8Array(exportedRaw))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
      console.log("🛡️ [Client Debug] Client Public Key Hex:", globalPublicKeyHex);
      console.log("🛡️ [Client Debug] Server Public Key Hex:", licenseData.serverPublicKeyHex || licenseData.serverPublicKey);
      console.log("🛡️ [Client Debug] Derived AES Key (SHA-256 KDF) Hex:", aesKeyHex);
      console.log("🛡️ [Client Debug] IV Hex:", licenseData.ivHex || licenseData.iv);
      console.log("🛡️ [Client Debug] Wrapped CEK Hex:", licenseData.encryptedCekHex || licenseData.wrappedCek);

      let cekBuffer;
      try {
        cekBuffer = await crypto.subtle.decrypt(
          { 
            name: "AES-GCM", 
            iv: ivBytes,
            tagLength: 128 // 128 bits = 16 bytes chuẩn mã hóa Node.js sinh ra
          },
          derivedKey,
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

      const encRes = await fetch(segmentUri, {
        method: 'GET',
        mode: 'cors',
        headers: { 'Accept': 'video/mp4,audio/mp4,*/*' }
      });
      if (!encRes.ok) throw new Error("Không thể tải tệp âm thanh phân đoạn!");
      const encryptedAudioData = await encRes.arrayBuffer();

      // =========================================================================
      // 6. 🔥 [SỬA ĐỔI CHÍNH XÁC]: GIẢI MÃ NHẬN DIỆN HỘP ISO-BMFF (SAMPLE-LEVEL BYPASS)
      // =========================================================================
      console.log("🔐 [Crypto] Phân tích cấu trúc hộp MP4 để trích xuất khối dữ liệu mdat...");
      const view = new DataView(encryptedAudioData);
      const originalView = new Uint8Array(encryptedAudioData);
      
      let moofOffset = -1;
      let trunOffset = -1;
      let sencOffset = -1;
      let mdatOffset = -1;
      let mdatSize = -1;
      
      for (let i = 0; i < encryptedAudioData.byteLength - 8; i++) {
        const type = String.fromCharCode(originalView[i], originalView[i+1], originalView[i+2], originalView[i+3]);
        if (type === 'moof') {
          moofOffset = i;
        } else if (type === 'trun') {
          trunOffset = i;
        } else if (type === 'senc') {
          sencOffset = i;
        } else if (type === 'mdat') {
          mdatOffset = i;
          mdatSize = view.getUint32(mdatOffset - 4);
        }
      }
      
      let decryptedAudioBuffer: ArrayBuffer;
      
      if (moofOffset !== -1 && trunOffset !== -1 && sencOffset !== -1 && mdatOffset !== -1) {
        moofOffset -= 4;
        trunOffset -= 4;
        sencOffset -= 4;
        mdatOffset -= 4;
        
        console.log(`🎯 [MP4 Parser] Tìm thấy senc tại ${sencOffset}, trun tại ${trunOffset}, mdat tại ${mdatOffset}`);
        
        const sampleCount = view.getUint32(trunOffset + 12);
        const flags = view.getUint32(trunOffset + 8) & 0x00FFFFFF;
        
        let currentIdx = trunOffset + 16;
        const dataOffsetPresent = flags & 0x000001;
        const firstSampleFlagsPresent = flags & 0x000004;
        
        if (dataOffsetPresent) currentIdx += 4;
        if (firstSampleFlagsPresent) currentIdx += 4;
        
        const sampleSizes = [];
        const sampleDurationPresent = flags & 0x000100;
        const sampleSizePresent = flags & 0x000200;
        const sampleFlagsPresent = flags & 0x000400;
        const sampleCompositionTimeOffsetPresent = flags & 0x000800;
        
        let entrySize = 0;
        if (sampleDurationPresent) entrySize += 4;
        if (sampleSizePresent) entrySize += 4;
        if (sampleFlagsPresent) entrySize += 4;
        if (sampleCompositionTimeOffsetPresent) entrySize += 4;
        
        for (let j = 0; j < sampleCount; j++) {
          let sIdx = currentIdx + j * entrySize;
          let entryOffset = 0;
          if (sampleDurationPresent) entryOffset += 4;
          let size = sampleSizePresent ? view.getUint32(sIdx + entryOffset) : 0;
          sampleSizes.push(size);
        }
        
        const cryptoKey = await crypto.subtle.importKey("raw", cekBuffer, { name: "AES-CTR" }, false, ["decrypt"]);
        
        let mdatDataOffset = mdatOffset + 8;
        const decryptedMdat = new Uint8Array(mdatSize - 8);
        let writeOffset = 0;
        
        for (let j = 0; j < sampleCount; j++) {
          const size = sampleSizes[j];
          const sampleIV = new Uint8Array(encryptedAudioData, sencOffset + 16 + j * 8, 8);
          
          const counter = new Uint8Array(16);
          counter.set(sampleIV, 0);
          
          const ciphertext = encryptedAudioData.slice(mdatDataOffset, mdatDataOffset + size);
          
          const decryptedSample = await crypto.subtle.decrypt(
            { name: "AES-CTR", counter: counter, length: 64 },
            cryptoKey,
            ciphertext
          );
          
          decryptedMdat.set(new Uint8Array(decryptedSample), writeOffset);
          mdatDataOffset += size;
          writeOffset += size;
        }
        
        const finalFileBuffer = new Uint8Array(encryptedAudioData.byteLength);
        finalFileBuffer.set(originalView.subarray(0, mdatOffset + 8), 0);
        finalFileBuffer.set(decryptedMdat, mdatOffset + 8);
        if (originalView.byteLength > mdatOffset + mdatSize) {
          finalFileBuffer.set(originalView.subarray(mdatOffset + mdatSize), mdatOffset + mdatSize);
        }
        
        decryptedAudioBuffer = finalFileBuffer.buffer;
        console.log(`✅ [Crypto] Giải mã CENC từng sample hoàn tất! Gộp file mp4: ${decryptedAudioBuffer.byteLength} bytes`);
      } else {
        console.warn("⚠️ [MP4 Parser] Không tìm thấy senc/trun/mdat riêng biệt, fallback giải mã toàn bộ file.");
        const cryptoKey = await crypto.subtle.importKey("raw", cekBuffer, { name: "AES-CTR" }, false, ["decrypt"]);
        decryptedAudioBuffer = await crypto.subtle.decrypt(
          { name: "AES-CTR", counter: new Uint8Array(16), length: 64 },
          cryptoKey,
          encryptedAudioData
        );
      }
      
      console.log("✅ [Crypto] Khôi phục cấu trúc âm thanh ISO-BMFF sạch thành công! Kích thước:", decryptedAudioBuffer.byteLength, "bytes");

      // 7. Khởi chạy kiến trúc MediaSource (MSE) để bơm dữ liệu vào thẻ Audio ẩn mà không lo lỗi CENC 6006
      const audio = audioRef.current;
      if (!audio) return;

      const mediaSource = new MediaSource();
      mediaSourceRef.current = mediaSource;
      audio.src = URL.createObjectURL(mediaSource);

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