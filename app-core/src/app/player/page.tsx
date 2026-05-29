"use client";
import React, { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

let globalKeyPair: CryptoKeyPair | null = null;
let globalPublicKeyHex = "";
let isPipelineActiveGlobal = false;

export default function CustomPlayerPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPlaying, setIsPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusLog, setStatusLog] = useState<string>("Hệ thống sẵn sàng...");

  const [currentTime, setCurrentTime] = useState("0:00");
  const [duration, setDuration] = useState("0:00");
  const [volume, setVolume] = useState(1.0);

  const audioRef = useRef<HTMLAudioElement>(null);
  const mediaSourceRef = useRef<MediaSource | null>(null);
  const sourceBufferRef = useRef<SourceBuffer | null>(null);

  const cryptoKeyRef = useRef<CryptoKey | null>(null);
  const currentSegmentIndexRef = useRef(1);
  const isFetchingRef = useRef(false);
  const [isLoadingStream, setIsLoadingStream] = useState(false);

  const [songTitle, setSongTitle] = useState<string>("Đang tải dữ liệu...");
  const [trackId, setTrackId] = useState<string>("");
  const [targetKID, setTargetKID] = useState<string>("");
  const [totalSegments, setTotalSegments] = useState<number>(1);

  // ✅ Refs để tránh closure stale trong checkAndBufferNext
  const totalSegmentsRef = useRef<number>(1);
  const trackIdRef = useRef<string>("");
  useEffect(() => { totalSegmentsRef.current = totalSegments; }, [totalSegments]);
  useEffect(() => { trackIdRef.current = trackId; }, [trackId]);

  const formatTime = (secs: number) => {
    if (isNaN(secs) || secs === Infinity) return "0:00";
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  useEffect(() => {
    const fetchTrackMetadata = async () => {
      const id = searchParams.get('trackId') || "791a86f0-6b1e-4440-bd29-bdc44c9fdb8f";
      setTrackId(id);
      trackIdRef.current = id;
      try {
        setStatusLog("🔍 Đang truy vấn Metadata bài hát...");
        const res = await fetch(`/api/ingest/upload?trackId=${id}`);
        if (!res.ok) throw new Error("Không tìm thấy thông tin bài hát");
        const json = await res.json();
        const trackData = json.data.track;
        setSongTitle(trackData.filename);
        setTargetKID(trackData.kid);
        const calc = Math.max(1, Math.ceil(trackData.duration / 10));
        setTotalSegments(calc);
        totalSegmentsRef.current = calc;
        setStatusLog(`✅ Đã nạp: ${calc} phân đoạn.`);
      } catch (err: any) {
        setError("Lỗi nạp bài hát: " + err.message);
      }
    };
    fetchTrackMetadata();
  }, [searchParams]);

  useEffect(() => {
    const initECDH = async () => {
      try {
        if (!globalKeyPair) {
          setStatusLog("🔑 Đang khởi tạo cặp khóa ECDH (P-256)...");
          globalKeyPair = await window.crypto.subtle.generateKey(
            { name: "ECDH", namedCurve: "P-256" }, true, ["deriveKey", "deriveBits"]
          );
          const exported = await window.crypto.subtle.exportKey("raw", globalKeyPair.publicKey);
          globalPublicKeyHex = Array.from(new Uint8Array(exported))
            .map(b => b.toString(16).padStart(2, '0')).join('');
          setStatusLog("✅ Hệ thống mật mã ECDH sẵn sàng.");
        }
      } catch (err: any) {
        setError("Lỗi khởi tạo ECDH: " + err.message);
      }
    };
    initECDH();
    return () => { resetStreaming(); };
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onTime = () => setCurrentTime(formatTime(audio.currentTime));
    const onMeta = () => { if (audio.duration && audio.duration !== Infinity) setDuration(formatTime(audio.duration)); };
    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('loadedmetadata', onMeta);
    return () => { audio.removeEventListener('timeupdate', onTime); audio.removeEventListener('loadedmetadata', onMeta); };
  }, []);

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = parseFloat(e.target.value);
    setVolume(v);
    if (audioRef.current) audioRef.current.volume = v;
  };

  const resetStreaming = () => {
    const audio = audioRef.current;
    if (audio) { audio.pause(); audio.src = ""; try { audio.load(); } catch (e) { } }
    mediaSourceRef.current = null;
    sourceBufferRef.current = null;
    currentSegmentIndexRef.current = 1;
    cryptoKeyRef.current = null;
    isFetchingRef.current = false;
    setIsPlaying(false);
  };

  // =========================================================================
  // ✅ GIẢI MÃ CENC ĐÚNG CHUẨN: Per-sample AES-CTR với IV từ senc box
  //
  // Cấu trúc đã xác nhận từ binary analysis:
  // - scheme = 'cenc' (AES-CTR, không phải cbcs)
  // - IV size = 8 bytes per sample (tenc: default_Per_Sample_IV_Size = 8)
  // - IV sequential: sample[n] = sample[0] + n (tăng +1 mỗi sample)
  // - IVs lưu trong senc box bên trong traf của moof
  // - trun có sample_size_present → parse được offset từng sample trong mdat
  // - segment_1 KHÔNG có senc → CLEAR, không cần decrypt
  // =========================================================================
  const decryptSegment = async (
    segmentBuffer: ArrayBuffer,
    cryptoKey: CryptoKey,
    segmentIndex: number
  ): Promise<ArrayBuffer> => {
    const data = new Uint8Array(segmentBuffer);

    // ── Helper: đọc u32 big-endian
    const u32 = (off: number) =>
      ((data[off] << 24) | (data[off + 1] << 16) | (data[off + 2] << 8) | data[off + 3]) >>> 0;

    // ── Helper: tìm box theo tên, trả về {offset vào content, size của box}
    const findBox = (haystack: Uint8Array, name: string, startAt = 0): { start: number; size: number } | null => {
      const needle = name.split('').map(c => c.charCodeAt(0));
      let i = startAt;
      while (i + 8 <= haystack.length) {
        const sz = ((haystack[i] << 24) | (haystack[i + 1] << 16) | (haystack[i + 2] << 8) | haystack[i + 3]) >>> 0;
        if (sz < 8 || i + sz > haystack.length) break;
        if (haystack[i + 4] === needle[0] && haystack[i + 5] === needle[1] &&
          haystack[i + 6] === needle[2] && haystack[i + 7] === needle[3]) {
          return { start: i, size: sz };
        }
        i += sz;
      }
      return null;
    };

    // ── Tìm moof và mdat
    const moofBox = findBox(data, 'moof');
    const mdatBox = moofBox ? findBox(data, 'mdat', moofBox.start + moofBox.size) : null;

    if (!moofBox || !mdatBox) {
      console.warn(`⚠️ seg${segmentIndex}: không tìm thấy moof/mdat, trả về nguyên bản`);
      return segmentBuffer;
    }

    const moofContent = data.subarray(moofBox.start + 8, moofBox.start + moofBox.size);

    // ── Tìm traf bên trong moof
    const trafBox = findBox(moofContent, 'traf');
    if (!trafBox) {
      console.warn(`⚠️ seg${segmentIndex}: không có traf → clear segment, bỏ qua decrypt`);
      return segmentBuffer;
    }
    const trafContent = moofContent.subarray(trafBox.start + 8, trafBox.start + trafBox.size);

    // ── Tìm senc trong traf
    const sencBox = findBox(trafContent, 'senc');
    if (!sencBox) {
      // Segment 1 (clear) — không có senc, trả về nguyên bản
      console.log(`ℹ️ seg${segmentIndex}: không có senc → CLEAR segment`);
      return segmentBuffer;
    }

    const sencContent = trafContent.subarray(sencBox.start + 8, sencBox.start + sencBox.size);
    const sencVersion = sencContent[0];
    const sencFlags = ((sencContent[1] << 16) | (sencContent[2] << 8) | sencContent[3]) >>> 0;
    const sampleCount = ((sencContent[4] << 24) | (sencContent[5] << 16) | (sencContent[6] << 8) | sencContent[7]) >>> 0;

    // Đọc IV 8-byte của từng sample từ senc
    const ivList: bigint[] = [];
    let sencOff = 8;
    for (let s = 0; s < sampleCount; s++) {
      // IV 8 bytes dạng big-endian → đọc thành BigInt
      let iv = BigInt(0);
      for (let b = 0; b < 8; b++) iv = (iv << BigInt(8)) | BigInt(sencContent[sencOff + b]);
      ivList.push(iv);
      sencOff += 8;
      if (sencFlags & 0x2) {
        // has_subsample_encryption_info: skip subsample entries
        const subCount = (sencContent[sencOff] << 8) | sencContent[sencOff + 1];
        sencOff += 2 + subCount * 6;
      }
    }

    // ── Tìm trun trong traf để lấy sample sizes
    const trunBox = findBox(trafContent, 'trun');
    if (!trunBox) {
      console.warn(`⚠️ seg${segmentIndex}: không có trun`);
      return segmentBuffer;
    }
    const trunContent = trafContent.subarray(trunBox.start + 8, trunBox.start + trunBox.size);
    const trunVersion = trunContent[0];
    const trunFlags = ((trunContent[1] << 16) | (trunContent[2] << 8) | trunContent[3]) >>> 0;
    const trunSampleCount = ((trunContent[4] << 24) | (trunContent[5] << 16) | (trunContent[6] << 8) | trunContent[7]) >>> 0;

    const hasDO = !!(trunFlags & 0x001);
    const hasFF = !!(trunFlags & 0x004);
    const hasDur = !!(trunFlags & 0x100);
    const hasSz = !!(trunFlags & 0x200);
    const hasSF = !!(trunFlags & 0x400);
    const hasCT = !!(trunFlags & 0x800);

    let trunOff = 8;
    if (hasDO) trunOff += 4;
    if (hasFF) trunOff += 4;

    // Đọc sample sizes
    const sampleSizes: number[] = [];
    for (let s = 0; s < trunSampleCount; s++) {
      if (hasDur) trunOff += 4;
      if (hasSz) {
        const sz = ((trunContent[trunOff] << 24) | (trunContent[trunOff + 1] << 16) |
          (trunContent[trunOff + 2] << 8) | trunContent[trunOff + 3]) >>> 0;
        sampleSizes.push(sz);
        trunOff += 4;
      }
      if (hasSF) trunOff += 4;
      if (hasCT) trunOff += 4;
    }

    if (sampleSizes.length === 0 || sampleSizes.length !== sampleCount) {
      console.warn(`⚠️ seg${segmentIndex}: sample sizes không khớp senc (${sampleSizes.length} vs ${sampleCount})`);
      return segmentBuffer;
    }

    // ── Decrypt từng sample trong mdat
    const mdatPayloadStart = mdatBox.start + 8;
    const result = new Uint8Array(segmentBuffer.byteLength);
    // Copy toàn bộ trước (giữ nguyên header boxes)
    result.set(data);

    let mdatOffset = 0;
    for (let s = 0; s < sampleCount; s++) {
      const sampleSize = sampleSizes[s];
      const sampleStart = mdatPayloadStart + mdatOffset;

      // Tạo 16-byte counter block: [8-byte IV big-endian] + [8 zero bytes]
      const counterBlock = new Uint8Array(16);
      const iv64 = ivList[s];
      for (let b = 0; b < 8; b++) {
        counterBlock[b] = Number((iv64 >> BigInt(56 - b * 8)) & BigInt(0xFF));
      }
      // counterBlock[8..15] = 0 (đã là 0)

      try {
        const decryptedSample = await crypto.subtle.decrypt(
          { name: "AES-CTR", counter: counterBlock, length: 128 },
          cryptoKey,
          data.subarray(sampleStart, sampleStart + sampleSize)
        );
        result.set(new Uint8Array(decryptedSample), sampleStart);
      } catch (e) {
        console.error(`💥 seg${segmentIndex} sample[${s}] decrypt error:`, e);
      }

      mdatOffset += sampleSize;
    }

    console.log(`✅ seg${segmentIndex}: đã decrypt ${sampleCount} samples`);
    return result.buffer;
  };

  const playSong = async () => {
    if (isPipelineActiveGlobal) return;
    if (!trackId || !targetKID) { setError("Dữ liệu bài hát chưa nạp!"); return; }

    setError(null);
    setIsLoadingStream(true);
    isPipelineActiveGlobal = true;
    resetStreaming();
    isFetchingRef.current = false;

    try {
      if (!globalKeyPair) throw new Error("ECDH chưa khởi tạo!");
      const audio = audioRef.current;
      if (!audio) throw new Error("Thẻ Audio chưa sẵn sàng!");

      // Unlock autoplay
      try { audio.src = ""; await audio.play().catch(() => {}); audio.pause(); } catch (e) {}

      setStatusLog("📡 Đang thực hiện ECDH key exchange...");
      const token = localStorage.getItem('token') || 'mock-token-uit-2026';

      const licenseRes = await fetch("/api/license", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "authorization": `Bearer ${token}`,
          "x-kid": targetKID,
          "x-client-public-key": globalPublicKeyHex,
        },
        body: JSON.stringify({}),
      });
      if (!licenseRes.ok) throw new Error(`License Server lỗi: ${licenseRes.status}`);

      const responseBuf = new Uint8Array(await licenseRes.arrayBuffer());
      const payloadLen = ((responseBuf[0] << 24) | (responseBuf[1] << 16) | (responseBuf[2] << 8) | responseBuf[3]) >>> 0;
      const licenseData = JSON.parse(new TextDecoder().decode(responseBuf.slice(4, 4 + payloadLen)));

      const hexToBytes = (hex: string) => new Uint8Array(hex.match(/.{1,2}/g)!.map((b: string) => parseInt(b, 16)));

      const serverPubKey = await crypto.subtle.importKey(
        "raw", hexToBytes(licenseData.serverPublicKey),
        { name: "ECDH", namedCurve: "P-256" }, false, []
      );
      const sharedBits = await crypto.subtle.deriveBits({ name: "ECDH", public: serverPubKey }, globalKeyPair.privateKey, 256);
      const hashedBits = await crypto.subtle.digest("SHA-256", sharedBits);
      const derivedKey = await crypto.subtle.importKey("raw", hashedBits, { name: "AES-GCM" }, false, ["decrypt"]);
      const cekBuf = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: hexToBytes(licenseData.iv), tagLength: 128 },
        derivedKey,
        hexToBytes(licenseData.wrappedCek)
      );

      // extractable: false — key không thể export ra khỏi browser
      const cryptoKey = await crypto.subtle.importKey("raw", cekBuf, { name: "AES-CTR" }, false, ["decrypt"]);
      cryptoKeyRef.current = cryptoKey;

      setStatusLog("🛠️ Khởi tạo MSE Pipeline...");
      const ms = new MediaSource();
      mediaSourceRef.current = ms;
      audio.src = URL.createObjectURL(ms);
      audio.volume = volume;

      let isInitAppended = false;
      // Số segment đã nạp xong vào SourceBuffer (dùng để evict buffer cũ)
      let lastEvictedEnd = 0;

      // ── Hằng số điều phối buffer window ──────────────────────────────────
      const BUFFER_AHEAD_TARGET = 30;  // giây — mục tiêu buffer phía trước
      const BUFFER_AHEAD_MAX   = 45;  // giây — dừng fetch nếu vượt ngưỡng này
      const BUFFER_BEHIND_KEEP =  5;  // giây — giữ lại bao nhiêu giây đã phát (để seek back)
      // ─────────────────────────────────────────────────────────────────────

      // Tính buffered ahead chính xác, kể cả khi audio chưa phát (currentTime=0)
      const getBufferedAhead = (): number => {
        const sb = sourceBufferRef.current;
        if (!sb) return 0;
        const ranges = sb.buffered;
        const ct = audio.currentTime;
        let maxEnd = 0;
        for (let i = 0; i < ranges.length; i++) {
          // Lấy end của range nào chứa currentTime, hoặc range liền sau
          if (ranges.end(i) > ct && ranges.start(i) <= ct + 0.5) {
            return ranges.end(i) - ct;
          }
          // Trường hợp audio chưa phát (ct=0): lấy end của range đầu tiên
          if (ct === 0 && ranges.start(i) === 0) {
            return ranges.end(i);
          }
        }
        return 0;
      };

      // Evict phần buffer đã phát qua (giải phóng RAM)
      const evictOldBuffer = () => {
        const sb = sourceBufferRef.current;
        if (!sb || sb.updating || ms.readyState !== 'open') return;
        const ct = audio.currentTime;
        const evictTo = Math.max(0, ct - BUFFER_BEHIND_KEEP);
        if (evictTo > lastEvictedEnd + 1) {
          try {
            sb.remove(0, evictTo);
            lastEvictedEnd = evictTo;
            console.log(`🗑️ Evict buffer 0–${evictTo.toFixed(1)}s`);
          } catch (e) { /* ignore */ }
        }
      };

      const checkAndBufferNext = async () => {
        if (!isPipelineActiveGlobal) return;
        const sb = sourceBufferRef.current;
        if (!ms || ms.readyState !== 'open') return;
        if (!sb || sb.updating || isFetchingRef.current) {
          setTimeout(checkAndBufferNext, 300);
          return;
        }

        // Evict buffer cũ trước khi quyết định fetch mới
        evictOldBuffer();
        if (sb.updating) return; // evict đang chạy, chờ updateend gọi lại

        // Đã nạp hết tất cả segment
        if (currentSegmentIndexRef.current > totalSegmentsRef.current) {
          console.log("🎉 Đã nạp đủ toàn bộ. Kết thúc stream.");
          if (!sb.updating) ms.endOfStream();
          return;
        }

        const bufferedAhead = getBufferedAhead();

        if (bufferedAhead >= BUFFER_AHEAD_MAX) {
          // Đệm quá đầy — polling lại sau khi nhạc phát vơi
          setTimeout(checkAndBufferNext, 3000);
          return;
        }

        // Quyết định fetch
        isFetchingRef.current = true;
        const idx = currentSegmentIndexRef.current;
        console.log(`📡 ahead=${bufferedAhead.toFixed(1)}s → fetch segment_${idx}`);

        try {
          const res = await fetch(`/audio/segments/${trackIdRef.current}/segment_${idx}.m4s`);
          if (!res.ok) {
            if (res.status === 404 && idx >= totalSegmentsRef.current) {
              if (ms.readyState === 'open') ms.endOfStream();
              isFetchingRef.current = false;
              return;
            }
            throw new Error(`HTTP ${res.status}`);
          }

          const raw = await res.arrayBuffer();
          const decrypted = await decryptSegment(raw, cryptoKey, idx);
          currentSegmentIndexRef.current += 1;
          // appendBuffer xong → updateend sẽ reset isFetchingRef và gọi lại
          sb.appendBuffer(decrypted);
        } catch (err) {
          console.error(`Lỗi fetch segment_${idx}:`, err);
          isFetchingRef.current = false;
          setTimeout(checkAndBufferNext, 2000);
        }
      };

      ms.addEventListener('sourceopen', async () => {
        try {
          let codec = 'audio/mp4; codecs="mp4a.40.2"';
          if (!MediaSource.isTypeSupported(codec)) codec = 'audio/mp4; codecs="mp4a.40"';

          const sb = ms.addSourceBuffer(codec);
          // mode = 'segments' là mặc định, đảm bảo decode đúng thứ tự
          sourceBufferRef.current = sb;

          sb.addEventListener('updateend', () => {
            if (ms.readyState !== 'open' || sb.updating) return;
            isFetchingRef.current = false;

            if (!isInitAppended) {
              isInitAppended = true;
              console.log("📦 init.mp4 xong. Kéo segment_1...");
              checkAndBufferNext();
            } else {
              // Bắt đầu phát ngay khi có đủ dữ liệu đầu tiên (segment 1 xong)
              if (currentSegmentIndexRef.current === 2 && audio.paused) {
                audio.play()
                  .then(() => { setIsPlaying(true); setIsLoadingStream(false); })
                  .catch(() => setIsLoadingStream(false));
              }
              // Chỉ fetch tiếp nếu buffer chưa đủ — không fetch vô điều kiện
              const ahead = getBufferedAhead();
              if (ahead < BUFFER_AHEAD_TARGET) {
                checkAndBufferNext();
              } else {
                // Đặt timer polling thay vì fetch ngay
                setTimeout(checkAndBufferNext, 2000);
              }
            }
          });

          setStatusLog("📥 Nạp init.mp4...");
          const initRes = await fetch(`/audio/segments/${trackIdRef.current}/init.mp4`);
          if (!initRes.ok) throw new Error("Không tải được init.mp4!");
          sb.appendBuffer(await initRes.arrayBuffer());

        } catch (e: any) {
          setError("MSE Error: " + e.message);
          setIsLoadingStream(false);
          isPipelineActiveGlobal = false;
        }
      });

    } catch (err: any) {
      setError(err.message);
      setIsLoadingStream(false);
      isPipelineActiveGlobal = false;
    }
  };

  const stopPlay = () => {
    isPipelineActiveGlobal = false;
    resetStreaming();
    setIsPlaying(false);
    setIsLoadingStream(false);
    setStatusLog("⏹ Đã dừng và giải phóng bộ đệm.");
  };

  // ⚠️ DEBUG ONLY — xóa trước production vì Blob tĩnh không có DRM
  const testBlobPlayback = async () => {
    if (!cryptoKeyRef.current) { setError("Chưa có key — bấm Stream trước"); return; }
    try {
      setStatusLog("🧪 Ghép Blob test...");
      const initRes = await fetch(`/audio/segments/${trackId}/init.mp4`);
      const initBuf = await initRes.arrayBuffer();

      const blobs: ArrayBuffer[] = [];
      for (let i = 1; i <= 3; i++) {
        const r = await fetch(`/audio/segments/${trackId}/segment_${i}.m4s`);
        if (!r.ok) continue;
        const raw = await r.arrayBuffer();
        blobs.push(await decryptSegment(raw, cryptoKeyRef.current!, i));
        console.log(`✅ segment_${i} decrypted`);
      }

      const blob = new Blob([initBuf, ...blobs], { type: 'audio/mp4' });
      if (audioRef.current) {
        audioRef.current.src = URL.createObjectURL(blob);
        audioRef.current.load();
        await audioRef.current.play();
        setIsPlaying(true);
        setStatusLog(`🎵 Blob test: ${blobs.length} segments`);
      }
    } catch (err: any) {
      setError("Blob test lỗi: " + err.message);
    }
  };

  return (
    <div className="min-h-screen bg-gray-950 p-6 flex flex-col items-center justify-center relative select-none">
      <button onClick={() => router.push('/')} className="absolute top-6 left-6 bg-gray-900 border border-gray-800 text-gray-300 px-4 py-2 rounded-full font-semibold hover:bg-gray-800 transition-all shadow-md">✕ Quay lại</button>
      <h1 className="text-3xl font-bold text-white mb-2">Secure Audio DASH-MSE Player</h1>
      <p className="text-gray-400 mb-10 text-sm">Mật Mã học NT219 - UIT</p>

      <div className="w-full max-w-md bg-gray-900 rounded-2xl border border-gray-800 p-6 flex flex-col gap-5">
        <div className="flex items-center gap-4">
          <div className={`w-16 h-16 ${isPlaying ? 'bg-emerald-600 animate-pulse border-emerald-500' : 'bg-gray-800'} rounded-xl flex items-center justify-center border-2 shadow-lg`}>
            <span className="text-white text-3xl">📡</span>
          </div>
          <div>
            <p className="text-white font-bold text-base truncate max-w-[240px]">{songTitle}</p>
            <p className="text-emerald-400 text-[11px] font-mono animate-pulse">● CENC Per-Sample AES-CTR</p>
          </div>
        </div>

        <audio ref={audioRef} className="hidden" />

        <div className="flex items-center justify-between px-3 py-2 bg-gray-950/60 border border-gray-800 rounded-xl font-mono text-xs text-gray-400">
          <span>Thời gian thực:</span>
          <span className="text-emerald-400 font-semibold">{currentTime} / {duration}</span>
        </div>

        <div className="flex items-center gap-3 px-3 py-2.5 bg-gray-950/60 border border-gray-800 rounded-xl">
          <span className="text-gray-500 text-xs">🔊</span>
          <input type="range" min="0" max="1" step="0.05" value={volume} onChange={handleVolumeChange}
            className="flex-1 accent-emerald-500 h-1.5 bg-gray-800 rounded-lg cursor-pointer" />
        </div>

        <div className="flex gap-3 mt-1">
          <button onClick={playSong} disabled={isPlaying || isLoadingStream}
            className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white py-3 rounded-xl font-semibold text-sm disabled:opacity-40 transition-all shadow-md">
            {isLoadingStream ? "⏳ Đang kết nối..." : "📡 Bắt đầu Stream"}
          </button>
          <button onClick={stopPlay} disabled={!isPlaying && !isLoadingStream}
            className="bg-gray-800 text-gray-300 px-5 py-3 rounded-xl font-semibold text-sm disabled:opacity-40 transition-all border border-gray-700 shadow-md">
            ⏹ Dừng
          </button>
          <button onClick={testBlobPlayback}
            className="bg-gray-700 hover:bg-gray-600 text-gray-300 px-4 py-3 rounded-xl font-semibold text-sm transition-all shadow-md">
            🧪 Test
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
