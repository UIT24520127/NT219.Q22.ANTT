"use client";
import React, { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

let globalKeyPair: CryptoKeyPair | null = null;
let globalPublicKeyHex = "";

export default function CustomPlayerPage() {
  const router = useRouter();
  const [isPlaying, setIsPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusLog, setStatusLog] = useState<string>("Hệ thống sẵn sàng...");
  
  // State quản lý thời gian và âm lượng tự custom
  const [currentTime, setCurrentTime] = useState("0:00");
  const [duration, setDuration] = useState("0:00");
  const [volume, setVolume] = useState(1.0); // Mức âm lượng mặc định: 100% (1.0)

  const audioRef = useRef<HTMLAudioElement>(null);

  // Hàm helper định dạng số giây thành dạng mm:ss
  const formatTime = (secs: number) => {
    if (isNaN(secs)) return "0:00";
    const minutes = Math.floor(secs / 60);
    const seconds = Math.floor(secs % 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  useEffect(() => {
    const initECDH = async () => {
      try {
        if (!globalKeyPair) {
          setStatusLog("🔑 Đang khởi tạo cặp khóa ECDH (P-256)...");
          globalKeyPair = await window.crypto.subtle.generateKey(
            { name: "ECDH", namedCurve: "P-256" },
            true,
            ["deriveKey", "deriveBits"]
          );
          const exported = await window.crypto.subtle.exportKey("raw", globalKeyPair.publicKey);
          globalPublicKeyHex = Array.from(new Uint8Array(exported))
            .map(b => b.toString(16).padStart(2, '0'))
            .join('');
          setStatusLog("✅ Hệ thống mật mã ECDH đã sẵn sàng trên RAM.");
        }
      } catch (err: any) {
        setError("Lỗi khởi tạo hệ thống mật mã: " + err.message);
      }
    };
    initECDH();

    return () => {
      if (audioRef.current) {
        audioRef.current.src = "";
        audioRef.current.load();
      }
    };
  }, []);

  // Lắng nghe cập nhật từ thẻ audio ngầm
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleTimeUpdate = () => {
      setCurrentTime(formatTime(audio.currentTime));
    };

    const handleLoadedMetadata = () => {
      setDuration(formatTime(audio.duration));
    };

    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('loadedmetadata', handleLoadedMetadata);

    return () => {
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
    };
  }, []);

  // Hàm xử lý khi kéo thanh volume
  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newVolume = parseFloat(e.target.value);
    setVolume(newVolume);
    if (audioRef.current) {
      audioRef.current.volume = newVolume;
    }
  };

  // Hàm click vào icon loa để Mute nhanh hoặc Unmute
  const toggleMute = () => {
    if (audioRef.current) {
      if (volume > 0) {
        setVolume(0);
        audioRef.current.volume = 0;
      } else {
        setVolume(1.0);
        audioRef.current.volume = 1.0;
      }
    }
  };

  // Helper hiển thị Icon Loa linh hoạt theo mức âm lượng
  const getVolumeIcon = () => {
    if (volume === 0) return "🔇";
    if (volume < 0.4) return "🔈";
    if (volume < 0.7) return "🔉";
    return "🔊";
  };

  const playSong = async () => {
    setError(null);
    setIsPlaying(false);
    
    try {
      if (!globalKeyPair) throw new Error("Hệ thống ECDH chưa khởi tạo xong!");

      setStatusLog("📡 Đang gửi yêu cầu bắt tay lấy License...");
      const token = localStorage.getItem('token') || 'mock-token-uit-2026';
      
      const licenseRes = await fetch("http://localhost:3000/api/license", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "authorization": `Bearer ${token}`,
          "x-kid": "75635febb8a5be6b233b566534e225ad",
          "x-client-public-key": globalPublicKeyHex,
        },
        body: JSON.stringify({}),
      });

      if (!licenseRes.ok) throw new Error(`Lỗi kết nối License Server: Status ${licenseRes.status}`);
      
      const responseBuffer = new Uint8Array(await licenseRes.arrayBuffer());
      const payloadLen = (responseBuffer[0] << 24) | (responseBuffer[1] << 16) | (responseBuffer[2] << 8) | responseBuffer[3];
      const payloadBytes = responseBuffer.slice(4, 4 + payloadLen);
      const licenseData = JSON.parse(new TextDecoder().decode(payloadBytes));

      const hexToBytes = (hex: string) => new Uint8Array(hex.match(/.{1,2}/g)?.map((b: string) => parseInt(b, 16)) || []);

      const serverPublicKey = await crypto.subtle.importKey(
        "raw", 
        hexToBytes(licenseData.serverPublicKeyHex || licenseData.serverPublicKey),
        { name: "ECDH", namedCurve: "P-256" }, 
        false, 
        []
      );

      setStatusLog("🔐 Dẫn xuất Shared Secret & tính toán KDF SHA-256...");
      const sharedSecretBits = await crypto.subtle.deriveBits(
        { name: "ECDH", public: serverPublicKey },
        globalKeyPair.privateKey,
        256
      );

      const hashedSecretBits = await crypto.subtle.digest("SHA-256", sharedSecretBits);
      const derivedKey = await crypto.subtle.importKey("raw", hashedSecretBits, { name: "AES-GCM" }, false, ["decrypt"]);

      const ivBytes = hexToBytes(licenseData.ivHex || licenseData.iv);
      const wrappedBytes = hexToBytes(licenseData.encryptedCekHex || licenseData.wrappedCek);

      const cekBuffer = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: ivBytes, tagLength: 128 },
        derivedKey,
        wrappedBytes
      );

      setStatusLog("📡 Đang tải tệp âm thanh mã hóa phân đoạn CENC...");
      const segmentUri = `http://localhost:3000/audio/segments/0ee52ddd-a7b2-474d-9044-c9a33e1397ec/segment.mp4?nocache=${Date.now()}`;

      const encRes = await fetch(segmentUri, {
        method: 'GET',
        cache: 'no-store',
        headers: { 
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache',
          'Accept': 'video/mp4,audio/mp4,*/*' 
        }
      });
      if (!encRes.ok) throw new Error("Không thể tải tệp âm thanh phân đoạn!");
      const encryptedAudioData = await encRes.arrayBuffer();

      setStatusLog("🔐 Đang bóc tách CENC và giải mã từng sample dữ liệu...");
      const view = new DataView(encryptedAudioData);
      const originalView = new Uint8Array(encryptedAudioData);
      
      const cryptoKey = await crypto.subtle.importKey("raw", cekBuffer, { name: "AES-CTR" }, false, ["decrypt"]);
      
      const decryptedData = new Uint8Array(encryptedAudioData.byteLength);
      decryptedData.set(new Uint8Array(encryptedAudioData));
      
      let offset = 0;
      let activeTrunOffset = -1;
      let activeSencOffset = -1;
      
      while (offset < encryptedAudioData.byteLength - 8) {
        const size = view.getUint32(offset);
        const type = String.fromCharCode(originalView[offset+4], originalView[offset+5], originalView[offset+6], originalView[offset+7]);
        
        if (type === 'moof') {
          activeTrunOffset = -1;
          activeSencOffset = -1;
          
          const findSubBoxes = (start: number, end: number) => {
            let o = start;
            while (o < end - 8) {
              const s = view.getUint32(o);
              const t = String.fromCharCode(originalView[o+4], originalView[o+5], originalView[o+6], originalView[o+7]);
              if (t === 'traf') {
                findSubBoxes(o + 8, o + s);
              } else if (t === 'trun') {
                activeTrunOffset = o;
              } else if (t === 'senc') {
                activeSencOffset = o;
              }
              o += s;
            }
          };
          findSubBoxes(offset + 8, offset + size);
          
        } else if (type === 'mdat') {
          if (activeTrunOffset !== -1 && activeSencOffset !== -1) {
            const trunOffset = activeTrunOffset;
            const sencOffset = activeSencOffset;
            const sampleCount = view.getUint32(trunOffset + 12);
            const flags = view.getUint32(trunOffset + 8) & 0x00FFFFFF;
            
            let currentIdx = trunOffset + 16;
            if (flags & 0x000001) currentIdx += 4;
            if (flags & 0x000004) currentIdx += 4;
            
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
              let entryOffset = sampleDurationPresent ? 4 : 0;
              sampleSizes.push(sampleSizePresent ? view.getUint32(sIdx + entryOffset) : 0);
            }
            
            let mdatDataOffset = offset + 8;
            let writeOffset = offset + 8;
            
            for (let j = 0; j < sampleCount; j++) {
              const s = sampleSizes[j];
              const sampleIV = new Uint8Array(encryptedAudioData, sencOffset + 16 + j * 8, 8);
              
              const counter = new Uint8Array(16);
              counter.set(sampleIV, 0);
              
              const ciphertext = encryptedAudioData.slice(mdatDataOffset, mdatDataOffset + s);
              
              const decryptedSample = await crypto.subtle.decrypt(
                { name: "AES-CTR", counter: counter, length: 64 },
                cryptoKey,
                ciphertext
              );
              
              decryptedData.set(new Uint8Array(decryptedSample), writeOffset);
              mdatDataOffset += s;
              writeOffset += s;
            }
          }
        }
        offset += size;
      }
      
      const decryptedAudioBuffer = decryptedData.buffer;

      const audio = audioRef.current;
      if (!audio) throw new Error("Thẻ Audio chưa sẵn sàng!");

      setStatusLog("⚡ Đang tối ưu bộ đệm luồng RAM an toàn...");

      const audioBlob = new Blob([decryptedAudioBuffer], { type: 'audio/mp4' });
      const blobUrl = URL.createObjectURL(audioBlob);

      audio.onplaying = () => {
        setIsPlaying(true);
        setStatusLog("🎉 Luồng âm thanh bảo mật đang phát trực tuyến!");
        URL.revokeObjectURL(blobUrl);
      };
      
      audio.onerror = () => {
        console.error("Audio error code:", audio.error);
        setStatusLog("❌ Trình duyệt từ chối giải mã luồng.");
        try { URL.revokeObjectURL(blobUrl); } catch(e){}
      };

      audio.src = blobUrl;
      // Giữ mức volume hiện tại của người dùng chọn
      audio.volume = volume; 
      audio.muted = false;

      audio.play()
        .catch(playErr => {
          console.warn("Autoplay blocked:", playErr);
          setStatusLog("⚠️ Hãy bấm nút ▶ trên trình phát để mồi âm thanh (Chrome Autoplay Policy).");
        });

    } catch (err: any) {
      console.error("❌ Lỗi phát nhạc:", err);
      setError(err.message);
      setStatusLog("❌ Luồng phát thất bại.");
    }
  };

  const stopPlay = () => {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.src = "";
      audio.load();
    }
    setIsPlaying(false);
    setCurrentTime("0:00");
    setDuration("0:00");
    setStatusLog("⏹ Đã dừng phát nhạc và giải phóng bộ nhớ RAM.");
  };

  return (
    <div className="min-h-screen bg-gray-950 p-6 flex flex-col items-center justify-center relative select-none">
      
      <button onClick={() => router.push('/')} className="absolute top-6 left-6 flex items-center gap-2 bg-gray-900 border border-gray-800 text-gray-300 px-4 py-2 rounded-full font-semibold hover:bg-gray-800 hover:text-white transition-all duration-200 shadow-md">
        ✕ Quay lại
      </button>

      <h1 className="text-3xl font-bold text-white mb-2 tracking-tight">Secure Audio Stream Player</h1>
      <p className="text-gray-400 mb-10 text-sm font-medium">Đồ án Tốt Nghiệp / Mật Mã học NT219 - UIT</p>
      
      <div className="w-full max-w-md bg-gray-900 rounded-2xl shadow-2xl border border-gray-800 p-6 flex flex-col gap-5 transition-all duration-300">
        <div className="flex items-center gap-4">
          <div className={`w-16 h-16 ${isPlaying ? 'bg-blue-600 animate-pulse border-blue-500' : 'bg-gray-800 border-gray-700'} rounded-xl flex items-center justify-center shadow-lg border-2 transition-all duration-300`}>
            <span className="text-white text-3xl font-mono">♪</span>
          </div>
          
          <div className="flex-1 min-w-0">
            <p className="text-white font-bold text-base tracking-wide truncate">Encrypted Segment Audio Stream</p>
            <p className="text-gray-500 text-[11px] mt-0.5 font-mono truncate">DRM: In-Memory ECDH + AES-CTR</p>
          </div>
        </div>

        {/* Thẻ audio ẩn hoàn toàn */}
        <audio ref={audioRef} className="hidden" controlsList="nodownload"></audio>

        {/* BLOCK 1: Khung hiển thị thời gian số */}
        <div className="flex items-center justify-between px-3 py-2 bg-gray-950/60 border border-gray-800/60 rounded-xl font-mono text-xs text-gray-400">
          <span>Thời gian:</span>
          <span className="text-blue-400 font-semibold">{currentTime} <span className="text-gray-600">/</span> {duration}</span>
        </div>

        {/* BLOCK 2: Khung điều chỉnh âm lượng (Loa to nhỏ) tự Custom */}
        <div className="flex items-center gap-3 px-3 py-2.5 bg-gray-950/60 border border-gray-800/60 rounded-xl">
          <button 
            onClick={toggleMute} 
            className="text-base hover:scale-110 active:scale-95 transition-transform duration-100"
            title="Bấm để Tắt/Bật tiếng nhanh"
          >
            {getVolumeIcon()}
          </button>
          
          <input 
            type="range" 
            min="0" 
            max="1" 
            step="0.05" 
            value={volume} 
            onChange={handleVolumeChange} 
            className="flex-1 accent-blue-500 h-1.5 bg-gray-800 rounded-lg appearance-none cursor-pointer" 
          />
          
          <span className="font-mono text-[10px] text-gray-500 w-8 text-right">
            {Math.round(volume * 100)}%
          </span>
        </div>

        {/* BLOCK 3: Cụm nút điều khiển chính */}
        <div className="flex gap-3 mt-1">
          <button onClick={playSong} disabled={isPlaying} className="flex-1 bg-blue-600 hover:bg-blue-500 text-white py-3 rounded-xl font-semibold text-sm disabled:opacity-40 disabled:pointer-events-none transition-all shadow-md flex items-center justify-center gap-2">
            ▶ Giải mã & Phát
          </button>
          <button onClick={stopPlay} disabled={!isPlaying} className="bg-gray-800 hover:bg-gray-700 text-gray-300 px-5 py-3 rounded-xl font-semibold text-sm disabled:opacity-40 disabled:pointer-events-none transition-all border border-gray-700 shadow-md flex items-center justify-center gap-2">
            ⏹ Dừng
          </button>
        </div>
      </div>
      
      <div className="mt-5 w-full max-w-md p-3 bg-gray-900/60 border border-gray-800/80 rounded-xl shadow-inner flex items-center justify-between">
        <span className="text-[11px] text-gray-400 font-medium">Hệ thống:</span>
        <span className="text-[11px] font-mono font-semibold text-emerald-400 truncate max-w-[250px]">{statusLog}</span>
      </div>

      {error && <div className="mt-4 w-full max-w-md p-4 bg-red-950/40 border border-red-900/50 text-red-300 rounded-xl shadow-inner text-xs font-mono">Lỗi thực thi: {error}</div>}
      
      <div className="mt-6 w-full max-w-md p-4 bg-gray-950 rounded-xl border border-gray-900/40 text-center">
        <p className="text-[11px] text-gray-600 leading-relaxed">
          Cơ chế bảo mật: Dữ liệu âm thanh thô chỉ tồn tại dưới dạng phân mảnh nhị phân tạm thời trên RAM. 
          Bằng cách thu hồi Object URL ngay khi vừa phát, hệ thống bẻ gãy hoàn toàn khả năng sao chép.
        </p>
      </div>
    </div>
  );
}