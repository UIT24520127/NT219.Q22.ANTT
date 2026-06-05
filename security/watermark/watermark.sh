#!/usr/bin/env bash
set -euo pipefail

if [ $# -lt 2 ]; then
  echo "Usage: $(basename "$0") <input> <output> [frequency] [amplitude] [codec] [bitrate]"
  exit 1
fi

INPUT="$1"
OUTPUT="$2"
FREQUENCY="${3:-19000}"
AMPLITUDE="${4:-0.0005}"
CODEC="${5:-aac}"
BITRATE="${6:-256k}"

mkdir -p "$(dirname "$OUTPUT")"

ffmpeg -y -hide_banner -loglevel error \
  -i "$INPUT" \
  -filter_complex "[0:a]aresample=44100[a0];sine=frequency=${FREQUENCY}:sample_rate=44100:amplitude=${AMPLITUDE}:duration=999999[wm];[a0][wm]amix=inputs=2:duration=first:dropout_transition=0[a]" \
  -map "[a]" \
  -c:a "$CODEC" \
  -b:a "$BITRATE" \
  "$OUTPUT"
