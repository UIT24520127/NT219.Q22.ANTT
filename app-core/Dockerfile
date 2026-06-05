# ============================================================================
# Stage 0: Build audiowmark trên Debian slim
# libzita-resampler-dev có sẵn qua apt — tránh phụ thuộc URL cá nhân
# ============================================================================
FROM node:24-slim AS audiowmark-builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential autoconf automake libtool pkg-config \
    curl ca-certificates \
    libfftw3-dev libsndfile1-dev libmpg123-dev libgcrypt20-dev \
    libzita-resampler-dev && \
    rm -rf /var/lib/apt/lists/*

RUN curl -fL https://github.com/swesterfeld/audiowmark/archive/refs/tags/0.6.5.tar.gz \
      | tar xz -C /tmp && \
    cd /tmp/audiowmark-0.6.5 && \
    ./autogen.sh && \
    ./configure --prefix=/usr/local && \
    make -j2 && \
    make install

# ============================================================================
# Stage 1: Builder — node:24-alpine (chỉ build JS/TS, không cần system libs)
# ============================================================================
FROM node:24-alpine AS builder

WORKDIR /app

RUN apk add --no-cache python3 make g++ ffmpeg

COPY package*.json ./
RUN npm install --prefer-offline --no-audit

COPY . .
RUN npm run build

# ============================================================================
# Stage 2: Runtime — node:24-slim (Debian, compatible với audiowmark binary)
# ============================================================================
FROM node:24-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    curl \
    ca-certificates \
    libfftw3-single3 \
    libsndfile1 \
    libmpg123-0 \
    libgcrypt20 \
    libzita-resampler1 && \
    rm -rf /var/lib/apt/lists/*

RUN curl -fL https://github.com/shaka-project/shaka-packager/releases/download/v3.2.0/packager-linux-x64 \
      -o /usr/local/bin/packager && \
    chmod +x /usr/local/bin/packager

# audiowmark binary từ builder (cùng Debian bookworm → glibc compatible)
COPY --from=audiowmark-builder /usr/local/bin/audiowmark /usr/local/bin/audiowmark

COPY package*.json ./

RUN npm ci --omit=dev --prefer-offline --no-audit && \
    npm cache clean --force

COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public

RUN mkdir -p /app/certs /audio/segments

# Debian dùng groupadd/useradd thay vì addgroup/adduser của Alpine
RUN groupadd --gid 1001 nodejs && \
    useradd --uid 1001 --gid 1001 --no-create-home nextjs && \
    chown -R nextjs:nodejs /app /audio

USER nextjs

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl -f http://localhost:3000/api/health || exit 1

EXPOSE 3000

ENV NODE_ENV=production
ENV PORT=3000

CMD ["npm", "start"]
