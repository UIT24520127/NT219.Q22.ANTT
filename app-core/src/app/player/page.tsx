"use client";
import React, { useEffect, useRef, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

// ─── Global state (tồn tại suốt lifecycle của tab) ───────────────────────────

/** ECDH keypair — dùng để trao đổi CEK (tuần 3) */
let globalECDHKeyPair: CryptoKeyPair | null = null;
let globalECDHPublicKeyHex = "";

// ══════════════════════════════════════════════════════════════════════════════
// TUẦN 4 — DPOP KEYPAIR
// Tách biệt hoàn toàn với ECDH keypair:
//   - ECDH keypair: dùng deriveKey/deriveBits → trao đổi bí mật CEK
//   - DPoP keypair: dùng sign/verify → chứng minh sở hữu key với server
// ══════════════════════════════════════════════════════════════════════════════
let globalDPoPKeyPair: CryptoKeyPair | null = null;
/** Public key JWK của DPoP — nhúng vào header mỗi proof JWT */
let globalDPoPPublicJWK: JsonWebKey | null = null;

let isPipelineActiveGlobal = false;

// ─── Helper: Base64URL encode (không dùng thư viện ngoài) ────────────────────
function base64urlEncode(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let binary = '';
  bytes.forEach(b => binary += String.fromCharCode(b));
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

// ─── Helper: Tạo UUID v4 ────────────────────────────────────────────────────
function generateUUID(): string {
  return crypto.randomUUID
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = (Math.random() * 16) | 0;
        return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
      });
}

// ══════════════════════════════════════════════════════════════════════════════
// TUẦN 4 — HÀM TẠO DPOP PROOF JWT
//
// Mỗi request đến /api/license cần một proof riêng (jti khác nhau, iat mới).
// Proof JWT có cấu trúc:
//   header: { alg:"ES256", typ:"dpop+jwt", jwk:<public key> }
//   payload: { jti, htm, htu, iat, ath }
//
// ath = BASE64URL(SHA-256(access_token)) — ràng buộc proof với token cụ thể
// ══════════════════════════════════════════════════════════════════════════════
async function createDPoPProof(
  htm: string,
  htu: string,
  accessToken: string
): Promise<string> {
  if (!globalDPoPKeyPair || !globalDPoPPublicJWK) {
    throw new Error('DPoP keypair chưa được khởi tạo');
  }

  // Tính ath: SHA-256 của access token rồi base64url encode
  const tokenBytes = new TextEncoder().encode(accessToken);
  const hashBuf = await crypto.subtle.digest('SHA-256', tokenBytes);
  const ath = base64urlEncode(hashBuf);

  // Tạo header và payload
  const header = {
    alg: 'ES256',
    typ: 'dpop+jwt',
    jwk: globalDPoPPublicJWK,
  };
  const payload = {
    jti: generateUUID(),
    htm: htm.toUpperCase(),
    htu: htu.replace(/\/$/, ''), // chuẩn hoá: bỏ trailing slash
    iat: Math.floor(Date.now() / 1000),
    ath,
  };

  // Encode header và payload
  const encodedHeader = base64urlEncode(new TextEncoder().encode(JSON.stringify(header)));
  const encodedPayload = base64urlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const signingInput = `${encodedHeader}.${encodedPayload}`;

  // Ký bằng ECDSA P-256 — SubtleCrypto trả về raw r||s (IEEE P1363, 64 bytes)
  const signatureBuffer = await crypto.subtle.sign(
    { name: 'ECDSA', hash: { name: 'SHA-256' } },
    globalDPoPKeyPair.privateKey,
    new TextEncoder().encode(signingInput)
  );
  const encodedSignature = base64urlEncode(signatureBuffer);

  return `${signingInput}.${encodedSignature}`;
}

// ─────────────────────────────────────────────────────────────────────────────

function PlayerInner() {
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

  const totalSegmentsRef = useRef<number>(1);
  const trackIdRef = useRef<string>("");
  useEffect(() => { totalSegmentsRef.current = totalSegments; }, [totalSegments]);
  useEffect(() => { trackIdRef.current = trackId; }, [trackId]);

  // ── Auth guard: redirect về login nếu chưa đăng nhập ─────────────────────
  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) {
      const returnUrl = window.location.pathname + window.location.search;
      router.replace(`/login?returnTo=${encodeURIComponent(returnUrl)}`);
    }
  }, [router]);

  const formatTime = (secs: number) => {
    if (isNaN(secs) || secs === Infinity) return "0:00";
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  // ── Nạp metadata bài hát ──────────────────────────────────────────────────
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

  // ══════════════════════════════════════════════════════════════════════════
  // TUẦN 4 — KHỞI TẠO CẢ HAI KEYPAIR: ECDH (tuần 3) + DPOP (tuần 4)
  // ══════════════════════════════════════════════════════════════════════════
  useEffect(() => {
    const initCrypto = async () => {
      try {
        // ── ECDH keypair (giữ nguyên tuần 3) ─────────────────────────────
        if (!globalECDHKeyPair) {
          setStatusLog("🔑 Khởi tạo ECDH keypair...");
          globalECDHKeyPair = await window.crypto.subtle.generateKey(
            { name: 'ECDH', namedCurve: 'P-256' },
            true,
            ['deriveKey', 'deriveBits']
          );
          const exported = await window.crypto.subtle.exportKey('raw', globalECDHKeyPair.publicKey);
          globalECDHPublicKeyHex = Array.from(new Uint8Array(exported))
            .map(b => b.toString(16).padStart(2, '0')).join('');
        }

        // ── DPoP keypair (MỚI — tuần 4) ──────────────────────────────────
        if (!globalDPoPKeyPair) {
          setStatusLog("🛡️ Khởi tạo DPoP keypair (ECDSA P-256)...");
          globalDPoPKeyPair = await window.crypto.subtle.generateKey(
            { name: 'ECDSA', namedCurve: 'P-256' },
            true,         // extractable=true chỉ để export public key JWK
            ['sign', 'verify']
          );
          // Export public key dạng JWK để nhúng vào DPoP proof header
          globalDPoPPublicJWK = await window.crypto.subtle.exportKey(
            'jwk',
            globalDPoPKeyPair.publicKey
          );
          // Xoá 'd' nếu có (paranoid check — SubtleCrypto không bao giờ export d từ publicKey)
          if (globalDPoPPublicJWK && 'd' in globalDPoPPublicJWK) {
            delete (globalDPoPPublicJWK as any).d;
          }
        }

        setStatusLog("✅ Hệ thống mật mã sẵn sàng (ECDH + DPoP).");
      } catch (err: any) {
        setError("Lỗi khởi tạo crypto: " + err.message);
      }
    };
    initCrypto();
    return () => { resetStreaming(); };
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onTime = () => setCurrentTime(formatTime(audio.currentTime));
    const onMeta = () => {
      if (audio.duration && audio.duration !== Infinity) setDuration(formatTime(audio.duration));
    };
    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('loadedmetadata', onMeta);
    return () => {
      audio.removeEventListener('timeupdate', onTime);
      audio.removeEventListener('loadedmetadata', onMeta);
    };
  }, []);

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = parseFloat(e.target.value);
    setVolume(v);
    if (audioRef.current) audioRef.current.volume = v;
  };

  const resetStreaming = () => {
    const audio = audioRef.current;
    if (audio) { audio.pause(); audio.src = ""; try { audio.load(); } catch { } }
    mediaSourceRef.current = null;
    sourceBufferRef.current = null;
    currentSegmentIndexRef.current = 1;
    cryptoKeyRef.current = null;
    isFetchingRef.current = false;
    setIsPlaying(false);
  };

  // ── Decrypt segment (giữ nguyên hoàn toàn từ tuần 3) ─────────────────────
  const decryptSegment = async (
    segmentBuffer: ArrayBuffer,
    cryptoKey: CryptoKey,
    segmentIndex: number
  ): Promise<ArrayBuffer> => {
    const data = new Uint8Array(segmentBuffer);
    const u32 = (off: number) =>
      ((data[off] << 24) | (data[off + 1] << 16) | (data[off + 2] << 8) | data[off + 3]) >>> 0;

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

    const moofBox = findBox(data, 'moof');
    const mdatBox = moofBox ? findBox(data, 'mdat', moofBox.start + moofBox.size) : null;
    if (!moofBox || !mdatBox) return segmentBuffer;

    const moofContent = data.subarray(moofBox.start + 8, moofBox.start + moofBox.size);
    const trafBox = findBox(moofContent, 'traf');
    if (!trafBox) return segmentBuffer;
    const trafContent = moofContent.subarray(trafBox.start + 8, trafBox.start + trafBox.size);

    const sencBox = findBox(trafContent, 'senc');
    if (!sencBox) return segmentBuffer;

    const sencContent = trafContent.subarray(sencBox.start + 8, sencBox.start + sencBox.size);
    const sencFlags = ((sencContent[1] << 16) | (sencContent[2] << 8) | sencContent[3]) >>> 0;
    const sampleCount = ((sencContent[4] << 24) | (sencContent[5] << 16) | (sencContent[6] << 8) | sencContent[7]) >>> 0;

    const ivList: bigint[] = [];
    let sencOff = 8;
    for (let s = 0; s < sampleCount; s++) {
      let iv = BigInt(0);
      for (let b = 0; b < 8; b++) iv = (iv << BigInt(8)) | BigInt(sencContent[sencOff + b]);
      ivList.push(iv);
      sencOff += 8;
      if (sencFlags & 0x2) {
        const subCount = (sencContent[sencOff] << 8) | sencContent[sencOff + 1];
        sencOff += 2 + subCount * 6;
      }
    }

    const trunBox = findBox(trafContent, 'trun');
    if (!trunBox) return segmentBuffer;
    const trunContent = trafContent.subarray(trunBox.start + 8, trunBox.start + trunBox.size);
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

    if (sampleSizes.length === 0 || sampleSizes.length !== sampleCount) return segmentBuffer;

    const mdatPayloadStart = mdatBox.start + 8;
    const result = new Uint8Array(segmentBuffer.byteLength);
    result.set(data);

    let mdatOffset = 0;
    for (let s = 0; s < sampleCount; s++) {
      const sampleSize = sampleSizes[s];
      const sampleStart = mdatPayloadStart + mdatOffset;
      const counterBlock = new Uint8Array(16);
      const iv64 = ivList[s];
      for (let b = 0; b < 8; b++) {
        counterBlock[b] = Number((iv64 >> BigInt(56 - b * 8)) & BigInt(0xFF));
      }
      try {
        const decryptedSample = await crypto.subtle.decrypt(
          { name: 'AES-CTR', counter: counterBlock, length: 128 },
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

  // ══════════════════════════════════════════════════════════════════════════
  // TUẦN 4 — PLAY SONG: THÊM DPOP PROOF VÀO LICENSE REQUEST
  // ══════════════════════════════════════════════════════════════════════════
  const playSong = async () => {
    if (isPipelineActiveGlobal) return;
    if (!trackId || !targetKID) { setError("Dữ liệu bài hát chưa nạp!"); return; }

    setError(null);
    setIsLoadingStream(true);
    isPipelineActiveGlobal = true;
    resetStreaming();
    isFetchingRef.current = false;

    try {
      if (!globalECDHKeyPair) throw new Error("ECDH chưa khởi tạo!");
      if (!globalDPoPKeyPair) throw new Error("DPoP chưa khởi tạo!");
      const audio = audioRef.current;
      if (!audio) throw new Error("Thẻ Audio chưa sẵn sàng!");

      try { audio.src = ""; await audio.play().catch(() => {}); audio.pause(); } catch { }

      // ── Lấy token ─────────────────────────────────────────────────────
      const rawToken = localStorage.getItem('token') || 'mock-token-uit-2026';

      // ── Xây dựng URL license (phải khớp htu trong proof) ──────────────
      // Dùng window.location để tự động đúng môi trường dev/prod
      const licenseUrl = `${window.location.origin}/api/license`;

      // ── TẠO DPOP PROOF ────────────────────────────────────────────────
      setStatusLog("🛡️ Đang tạo DPoP proof...");
      const dpopProof = await createDPoPProof('POST', licenseUrl, rawToken);
      console.log("✅ [DPoP] Proof đã tạo.");

      // ── Gửi License Request với DPoP proof ────────────────────────────
      setStatusLog("📡 Đang thực hiện ECDH + DPoP key exchange...");
      const licenseRes = await fetch(licenseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${rawToken}`,   // Bearer token
          'DPoP': dpopProof,                        // DPoP proof JWT ← MỚI
          'x-kid': targetKID,
          'x-client-public-key': globalECDHPublicKeyHex,
        },
        body: JSON.stringify({}),
      });

      if (!licenseRes.ok) {
        const errBody = await licenseRes.text().catch(() => '');
        throw new Error(`License Server lỗi ${licenseRes.status}: ${errBody}`);
      }

      // ── Parse license response (giữ nguyên từ tuần 3) ─────────────────
      const responseBuf = new Uint8Array(await licenseRes.arrayBuffer());
      const payloadLen = ((responseBuf[0] << 24) | (responseBuf[1] << 16) |
        (responseBuf[2] << 8) | responseBuf[3]) >>> 0;
      const licenseData = JSON.parse(
        new TextDecoder().decode(responseBuf.slice(4, 4 + payloadLen))
      );

      const hexToBytes = (hex: string) =>
        new Uint8Array(hex.match(/.{1,2}/g)!.map((b: string) => parseInt(b, 16)));

      const serverPubKey = await crypto.subtle.importKey(
        'raw', hexToBytes(licenseData.serverPublicKey),
        { name: 'ECDH', namedCurve: 'P-256' }, false, []
      );
      const sharedBits = await crypto.subtle.deriveBits(
        { name: 'ECDH', public: serverPubKey },
        globalECDHKeyPair.privateKey,
        256
      );
      const hashedBits = await crypto.subtle.digest('SHA-256', sharedBits);
      const derivedKey = await crypto.subtle.importKey(
        'raw', hashedBits, { name: 'AES-GCM' }, false, ['decrypt']
      );
      const cekBuf = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: hexToBytes(licenseData.iv), tagLength: 128 },
        derivedKey,
        hexToBytes(licenseData.wrappedCek)
      );
      const cryptoKey = await crypto.subtle.importKey(
        'raw', cekBuf, { name: 'AES-CTR' }, false, ['decrypt']
      );
      cryptoKeyRef.current = cryptoKey;

      // ── MSE Pipeline (giữ nguyên từ tuần 3) ───────────────────────────
      setStatusLog("🛠️ Khởi tạo MSE Pipeline...");
      const ms = new MediaSource();
      mediaSourceRef.current = ms;
      audio.src = URL.createObjectURL(ms);
      audio.volume = volume;

      let isInitAppended = false;
      let lastEvictedEnd = 0;
      const BUFFER_AHEAD_TARGET = 30;
      const BUFFER_AHEAD_MAX = 45;
      const BUFFER_BEHIND_KEEP = 5;

      const getBufferedAhead = (): number => {
        const sb = sourceBufferRef.current;
        if (!sb) return 0;
        const ranges = sb.buffered;
        const ct = audio.currentTime;
        for (let i = 0; i < ranges.length; i++) {
          if (ranges.end(i) > ct && ranges.start(i) <= ct + 0.5) return ranges.end(i) - ct;
          if (ct === 0 && ranges.start(i) === 0) return ranges.end(i);
        }
        return 0;
      };

      const evictOldBuffer = () => {
        const sb = sourceBufferRef.current;
        if (!sb || sb.updating || ms.readyState !== 'open') return;
        const evictTo = Math.max(0, audio.currentTime - BUFFER_BEHIND_KEEP);
        if (evictTo > lastEvictedEnd + 1) {
          try { sb.remove(0, evictTo); lastEvictedEnd = evictTo; } catch { }
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
        evictOldBuffer();
        if (sb.updating) return;
        if (currentSegmentIndexRef.current > totalSegmentsRef.current) {
          if (!sb.updating) ms.endOfStream();
          return;
        }
        if (getBufferedAhead() >= BUFFER_AHEAD_MAX) {
          setTimeout(checkAndBufferNext, 3000);
          return;
        }
        isFetchingRef.current = true;
        const idx = currentSegmentIndexRef.current;
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
          sourceBufferRef.current = sb;

          sb.addEventListener('updateend', () => {
            if (ms.readyState !== 'open' || sb.updating) return;
            isFetchingRef.current = false;
            if (!isInitAppended) {
              isInitAppended = true;
              checkAndBufferNext();
            } else {
              if (currentSegmentIndexRef.current === 2 && audio.paused) {
                audio.play()
                  .then(() => { setIsPlaying(true); setIsLoadingStream(false); })
                  .catch(() => setIsLoadingStream(false));
              }
              const ahead = getBufferedAhead();
              if (ahead < BUFFER_AHEAD_TARGET) {
                checkAndBufferNext();
              } else {
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
      <button
        onClick={() => router.push('/')}
        className="absolute top-6 left-6 bg-gray-900 border border-gray-800 text-gray-300 px-4 py-2 rounded-full font-semibold hover:bg-gray-800 transition-all shadow-md"
      >
        ✕ Quay lại
      </button>

      <h1 className="text-3xl font-bold text-white mb-2">Secure Audio DASH-MSE Player</h1>
      <p className="text-gray-400 mb-10 text-sm">Mật Mã học NT219 - UIT</p>

      <div className="w-full max-w-md bg-gray-900 rounded-2xl border border-gray-800 p-6 flex flex-col gap-5">
        <div className="flex items-center gap-4">
          <div className={`w-16 h-16 ${isPlaying ? 'bg-emerald-600 animate-pulse border-emerald-500' : 'bg-gray-800'} rounded-xl flex items-center justify-center border-2 shadow-lg`}>
            <span className="text-white text-3xl">📡</span>
          </div>
          <div>
            <p className="text-white font-bold text-base truncate max-w-[240px]">{songTitle}</p>
            {/* Hiển thị cả hai lớp bảo vệ */}
            <p className="text-emerald-400 text-[11px] font-mono">● CENC AES-CTR + DPoP P-256</p>
          </div>
        </div>

        <audio ref={audioRef} className="hidden" />

        <div className="flex items-center justify-between px-3 py-2 bg-gray-950/60 border border-gray-800 rounded-xl font-mono text-xs text-gray-400">
          <span>Thời gian thực:</span>
          <span className="text-emerald-400 font-semibold">{currentTime} / {duration}</span>
        </div>

        <div className="flex items-center gap-3 px-3 py-2.5 bg-gray-950/60 border border-gray-800 rounded-xl">
          <span className="text-gray-500 text-xs">🔊</span>
          <input
            type="range" min="0" max="1" step="0.05" value={volume}
            onChange={handleVolumeChange}
            className="flex-1 accent-emerald-500 h-1.5 bg-gray-800 rounded-lg cursor-pointer"
          />
        </div>

        <div className="flex gap-3 mt-1">
          <button
            onClick={playSong}
            disabled={isPlaying || isLoadingStream}
            className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white py-3 rounded-xl font-semibold text-sm disabled:opacity-40 transition-all shadow-md"
          >
            {isLoadingStream ? "⏳ Đang kết nối..." : "📡 Bắt đầu Stream"}
          </button>
          <button
            onClick={stopPlay}
            disabled={!isPlaying && !isLoadingStream}
            className="bg-gray-800 text-gray-300 px-5 py-3 rounded-xl font-semibold text-sm disabled:opacity-40 transition-all border border-gray-700 shadow-md"
          >
            ⏹ Dừng
          </button>
          <button
            onClick={testBlobPlayback}
            className="bg-gray-700 hover:bg-gray-600 text-gray-300 px-4 py-3 rounded-xl font-semibold text-sm transition-all shadow-md"
          >
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

// ─────────────────────────────────────────────────────────────────────────────
// Wrapper bắt buộc: bọc PlayerInner trong Suspense để Next.js build thành công.
// useSearchParams() bên trong PlayerInner chỉ chạy được ở client,
// Suspense fallback hiển thị trong lúc hydrate.
// ─────────────────────────────────────────────────────────────────────────────
export default function PlayerPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-emerald-400 font-mono text-sm">Đang khởi tạo Player...</p>
        </div>
      </div>
    }>
      <PlayerInner />
    </Suspense>
  );
}
