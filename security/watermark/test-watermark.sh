#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# UITify — Watermark Test Script
# Yêu cầu: ffmpeg, audiowmark, curl, jq
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3000}"
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

echo "=== [1/5] Tạo file WAV test (5 giây sine 440Hz) ==="
ffmpeg -y -hide_banner -loglevel error \
  -f lavfi -i "sine=frequency=440:sample_rate=44100" \
  -t 5 -ac 2 "$WORK_DIR/original.wav"
echo "    → $WORK_DIR/original.wav"

echo ""
echo "=== [2/5] Nhúng watermark test payload ==="
# Dùng trackId giả — 32-char hex
TEST_PAYLOAD="deadbeefcafebabe1234567890abcdef"
audiowmark add "$WORK_DIR/original.wav" "$WORK_DIR/watermarked.wav" "$TEST_PAYLOAD"
echo "    Payload nhúng : $TEST_PAYLOAD"

echo ""
echo "=== [3/5] Quét watermark ==="
EXTRACTED=$(audiowmark get "$WORK_DIR/watermarked.wav" 2>/dev/null \
  | grep -oE '[0-9a-f]{32}' | head -1)
echo "    Payload quét  : $EXTRACTED"

if [ "$EXTRACTED" = "$TEST_PAYLOAD" ]; then
  echo "    ✅ Khớp — audiowmark hoạt động đúng"
else
  echo "    ⚠️  Payload khác (có thể do lỗi codec hoặc chưa đủ dữ liệu)"
fi

echo ""
echo "=== [4/5] Kiểm tra độ bền qua re-encode (AAC 192k → WAV) ==="
ffmpeg -y -hide_banner -loglevel error \
  -i "$WORK_DIR/watermarked.wav" \
  -c:a aac -b:a 192k "$WORK_DIR/reencoded.aac"
ffmpeg -y -hide_banner -loglevel error \
  -i "$WORK_DIR/reencoded.aac" \
  -ar 44100 -ac 2 "$WORK_DIR/reencoded.wav"

REENCODED_PAYLOAD=$(audiowmark get "$WORK_DIR/reencoded.wav" 2>/dev/null \
  | grep -oE '[0-9a-f]{32}' | head -1)
echo "    Payload sau re-encode : ${REENCODED_PAYLOAD:-<không đọc được>}"

if [ "${REENCODED_PAYLOAD:-}" = "$TEST_PAYLOAD" ]; then
  echo "    ✅ Watermark sống sót sau AAC re-encode"
else
  echo "    ⚠️  Watermark bị mất sau re-encode (bình thường nếu file quá ngắn <30s)"
fi

echo ""
echo "=== [5/5] Gọi API verify (cần server đang chạy) ==="
echo "    BASE_URL = $BASE_URL"
echo ""

HTTP_CODE=$(curl -s -o "$WORK_DIR/response.json" -w "%{http_code}" \
  "$BASE_URL/api/watermark/verify?payload=$EXTRACTED")

if [ "$HTTP_CODE" = "200" ]; then
  echo "    ✅ 200 OK"
  jq . "$WORK_DIR/response.json"
elif [ "$HTTP_CODE" = "404" ]; then
  echo "    ℹ️  404 — payload test không có trong DB (bình thường)"
  echo "    Để test đầy đủ: upload 1 bài nhạc thật rồi quét lại."
else
  echo "    ❌ HTTP $HTTP_CODE"
  cat "$WORK_DIR/response.json"
fi

echo ""
echo "─────────────────────────────────────────────────────────────────────────────"
echo "Hướng dẫn test với bài nhạc thật (sau khi upload qua UI):"
echo ""
echo "  1. Upload bài nhạc .m4a qua trang /upload"
echo "  2. Lấy trackId từ response: jq .data.trackId response.json"
echo "  3. Tính payload: echo <trackId> | tr -d '-'"
echo "  4. Gọi API: curl '$BASE_URL/api/watermark/verify?payload=<payload>' | jq ."
echo ""
echo "Verify cert offline (cần node + jose):"
echo "  node -e \\"
echo "    \"const jose=require('jose'); const jwt='<certJWT>'; const pk=<publicKey_json>;"
echo "     jose.jwtVerify(jwt, await jose.importJWK(pk,'ES256')).then(r=>console.log(r.payload))\""
