/**
 * DPoP JTI Replay Store
 *
 * Lưu các jti (JWT ID) đã dùng để phát hiện replay attack.
 * Dùng in-memory Map với TTL tự dọn — đủ cho single-instance server.
 *
 * Production scale-out: thay bằng Redis SETNX + EXPIRE.
 */

interface JtiEntry {
  expiresAt: number; // epoch ms
}

// jti → thời điểm hết hạn
const store = new Map<string, JtiEntry>();

// Dọn rác mỗi 5 phút
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

let cleanupTimer: ReturnType<typeof setInterval> | null = null;

function startCleanup() {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [jti, entry] of store.entries()) {
      if (entry.expiresAt <= now) store.delete(jti);
    }
  }, CLEANUP_INTERVAL_MS);
  // Không giữ process sống chỉ vì timer này
  if (cleanupTimer && typeof cleanupTimer === 'object' && 'unref' in cleanupTimer) {
    (cleanupTimer as any).unref();
  }
}

startCleanup();

/**
 * Kiểm tra jti đã tồn tại chưa, nếu chưa thì ghi vào store.
 * @param jti   - chuỗi UUID từ DPoP proof
 * @param ttlMs - thời gian sống tính bằng ms (mặc định 2 phút, khớp exp của proof)
 * @returns true nếu jti MỚI (chưa từng dùng), false nếu REPLAY
 */
export function checkAndMarkJTI(jti: string, ttlMs = 2 * 60 * 1000): boolean {
  const now = Date.now();

  // Dọn entry hết hạn của chính jti này trước
  const existing = store.get(jti);
  if (existing) {
    if (existing.expiresAt > now) {
      // jti vẫn còn hiệu lực → REPLAY
      return false;
    }
    // Đã hết hạn → coi như mới (edge case hiếm)
    store.delete(jti);
  }

  store.set(jti, { expiresAt: now + ttlMs });
  return true;
}

/** Lấy số jti đang lưu (dùng cho health check / metrics) */
export function getStoreSize(): number {
  return store.size;
}