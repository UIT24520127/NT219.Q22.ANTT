#!/bin/bash

# ============================================================================
# R2 CLOUDFLARE UPLOAD SCRIPT (Using Dockerized AWS CLI)
# ============================================================================
# This script syncs the local encrypted audio directory to Cloudflare R2.
# It reads credentials from the root .env file and uses a temporary docker container.
#
# USAGE:
#   chmod +x upload_to_r2.sh
#   ./upload_to_r2.sh
# ============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" &> /dev/null && pwd)"
ROOT_DIR="$(dirname $(dirname "$SCRIPT_DIR"))"
ENV_FILE="$ROOT_DIR/.env"
AUDIO_DIR="$ROOT_DIR/audio"

echo "========================================================================="
echo "  🚀 Starting R2 Audio Upload Sync"
echo "========================================================================="

# 1. Check if .env exists
if [ ! -f "$ENV_FILE" ]; then
    echo "❌ Error: .env file not found at $ENV_FILE"
    exit 1
fi

# 2. Extract R2 credentials from .env
# Using grep to extract without sourcing the whole file to avoid issues with other vars
R2_ACCOUNT_ID=$(grep -v '^#' "$ENV_FILE" | grep 'R2_ACCOUNT_ID' | cut -d '=' -f2- | tr -d '"' | tr -d "'")
R2_BUCKET_NAME=$(grep -v '^#' "$ENV_FILE" | grep 'R2_BUCKET_NAME' | cut -d '=' -f2- | tr -d '"' | tr -d "'")
R2_ACCESS_KEY_ID=$(grep -v '^#' "$ENV_FILE" | grep 'R2_ACCESS_KEY_ID' | cut -d '=' -f2- | tr -d '"' | tr -d "'")
R2_SECRET_ACCESS_KEY=$(grep -v '^#' "$ENV_FILE" | grep 'R2_SECRET_ACCESS_KEY' | cut -d '=' -f2- | tr -d '"' | tr -d "'")
R2_ENDPOINT=$(grep -v '^#' "$ENV_FILE" | grep 'R2_ENDPOINT' | cut -d '=' -f2- | tr -d '"' | tr -d "'")

# Validate required variables
if [ -z "$R2_ACCOUNT_ID" ] || [ -z "$R2_BUCKET_NAME" ] || [ -z "$R2_ACCESS_KEY_ID" ] || [ -z "$R2_SECRET_ACCESS_KEY" ]; then
    echo "❌ Error: Missing R2 credentials in .env file."
    echo "Please ensure R2_ACCOUNT_ID, R2_BUCKET_NAME, R2_ACCESS_KEY_ID, and R2_SECRET_ACCESS_KEY are set."
    exit 1
fi

# Use explicit endpoint if provided in .env, otherwise construct it
if [ -z "$R2_ENDPOINT" ]; then
    R2_ENDPOINT="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"
fi

echo "📦 Target Bucket : $R2_BUCKET_NAME"
echo "🔗 Endpoint      : $R2_ENDPOINT"
echo "📂 Source Dir    : $AUDIO_DIR"

if [ ! -d "$AUDIO_DIR" ]; then
    echo "⚠️ Warning: Audio directory $AUDIO_DIR does not exist. Creating it."
    mkdir -p "$AUDIO_DIR"
fi

echo ""
echo "⏳ Syncing files to R2..."

# 3. Run AWS CLI in Docker to sync files
# Using amazon/aws-cli image to avoid requiring aws-cli installed on host
docker run --rm -i \
  -v "$AUDIO_DIR:/audio" \
  -e AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" \
  -e AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" \
  amazon/aws-cli \
  --endpoint-url "$R2_ENDPOINT" \
  --region auto \
  s3 sync /audio "s3://$R2_BUCKET_NAME/" \
  --exclude "*" \
  --include "*.mp4" \
  --include "*.m4a" \
  --include "*.mpd" \
  --no-progress

echo ""
echo "✅ Upload completed successfully!"
echo "========================================================================="
