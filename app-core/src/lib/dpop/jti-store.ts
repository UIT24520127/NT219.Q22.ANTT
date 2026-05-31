// lib/dpop/jti-store.ts
// ─────────────────────────────────────────────────────────────────────────────
// DPoP JTI Blacklist — dùng Redis (Upstash) để chặn replay attack.
//
// RFC 9449 §11.1: server PHẢI reject DPoP proof có jti đã từng thấy
// trong cửa sổ thời gian (ở đây = TTL của proof + buffer 30s).
// ─────────────────────────────────────────────────────────────────────────────

import { Redis } from '@upstash/redis';

const redis = Redis.fromEnv();

// TTL = max age của DPoP proof (2 phút) + 30s buffer
const JTI_TTL_SECONDS = 150;

const KEY = (jti: string) => `dpop:jti:${jti}`;

/**
 * Kiểm tra jti đã dùng chưa, nếu chưa thì đánh dấu dùng rồi (atomic).
 * Trả về true nếu jti HỢP LỆ (chưa từng thấy), false nếu REPLAY.
 */
export async function checkAndMarkJTI(jti: string): Promise<boolean> {
  // SET NX — chỉ set nếu key chưa tồn tại, trả về 1 nếu thành công
  const result = await redis.set(KEY(jti), '1', {
    nx: true,
    ex: JTI_TTL_SECONDS,
  });
  // result = 'OK' nếu set thành công (jti mới), null nếu đã tồn tại (replay)
  return result !== null;
}

/**
 * Kiểm tra jti đã dùng chưa (read-only, không mark).
 * Dùng để debug / test.
 */
export async function isJTIUsed(jti: string): Promise<boolean> {
  const val = await redis.get(KEY(jti));
  return val !== null;
}