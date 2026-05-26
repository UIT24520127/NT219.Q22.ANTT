# ============================================================================
# DOCKERFILE - Next.js Application with Secure Audio Delivery
# ============================================================================
# Multi-stage build optimized for production
# - Stage 1: Build dependencies and application
# - Stage 2: Runtime environment with minimal footprint
# ============================================================================

# ============================================================================
# Stage 1: Builder
# ============================================================================
FROM node:24-alpine AS builder

WORKDIR /app

# Install build dependencies
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    ffmpeg

# Copy package files
COPY package*.json ./

# Install dependencies (production + dev for build time)
RUN npm ci --prefer-offline --no-audit

# Copy source code
COPY . .

# Build Next.js application
RUN npm run build

# ============================================================================
# Stage 2: Runtime
# ============================================================================
FROM node:20-alpine

WORKDIR /app

# Install runtime dependencies only
RUN apk add --no-cache \
    ffmpeg \
    curl

# Copy package files from builder
COPY package*.json ./

# Install production dependencies only
RUN npm ci --only=production --prefer-offline --no-audit && \
    npm cache clean --force

# Copy built application from builder
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public

# Copy SSL certificates directory (will be mounted as volume)
RUN mkdir -p /app/certs

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs
RUN adduser -S nextjs -u 1001

# Set ownership
RUN chown -R nextjs:nodejs /app

USER nextjs

# ============================================================================
# Health Check
# ============================================================================
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD curl -f http://localhost:3000/api/health || exit 1

# ============================================================================
# Expose Port
# ============================================================================
EXPOSE 3000

# ============================================================================
# Environment Variables (with defaults)
# ============================================================================
ENV NODE_ENV=production
ENV PORT=3000

# ============================================================================
# Start Application
# ============================================================================
CMD ["node_modules/.bin/next", "start"]

# ============================================================================
# Docker Build & Run Instructions:
# ============================================================================
# Build:
#   docker build -t drm-app:latest .
#
# Run (Development):
#   docker run -it \
#     -p 3000:3000 \
#     -e DATABASE_URL="..." \
#     -e R2_ACCOUNT_ID="..." \
#     -v $(pwd)/certs:/app/certs:ro \
#     drm-app:latest
#
# Run (Production via docker-compose):
#   docker-compose -f docker-compose-secure.yml up -d
# ============================================================================
