# ============================================================================
# Stage 1: Builder — node:24-alpine (build time)
# ============================================================================
FROM node:24-alpine AS builder

WORKDIR /app

RUN apk add --no-cache python3 make g++ ffmpeg

COPY package*.json ./
RUN npm install --prefer-offline --no-audit

COPY . .
RUN npm run build

# ============================================================================
# Stage 2: Runtime — PHẢI cùng major version với builder (node:24-alpine)
# ⚠️  Bản gốc dùng node:20 ở runtime nhưng build bằng node:24
#     → native modules (.node files) bị ABI mismatch → crash khi start
# ============================================================================
FROM node:24-alpine

WORKDIR /app

RUN apk add --no-cache \
    ffmpeg \
    curl \
    libc6-compat && \
    # Shaka Packager — dùng đúng binary cho linux-x64 musl (Alpine)
    curl -fL https://github.com/shaka-project/shaka-packager/releases/download/v3.2.0/packager-linux-x64 \
      -o /usr/local/bin/packager && \
    chmod +x /usr/local/bin/packager

COPY package*.json ./

# ⚠️  --only=production bị deprecated từ npm v9+, dùng --omit=dev
RUN npm ci --omit=dev --prefer-offline --no-audit && \
    npm cache clean --force

COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public

# Thư mục audio segments phải tồn tại trước khi chown
RUN mkdir -p /app/certs /audio/segments

RUN addgroup -g 1001 -S nodejs && \
    adduser -S nextjs -u 1001

# nextjs user cần write vào /audio (ingest tạo segment files)
RUN chown -R nextjs:nodejs /app /audio

USER nextjs

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD curl -f http://localhost:3000/api/health || exit 1

EXPOSE 3000

ENV NODE_ENV=production
ENV PORT=3000

# Production image nên dùng `npm start` (next start), không phải `npm run dev`
# docker-compose override sang `npm run dev` khi dev — OK
CMD ["npm", "start"]