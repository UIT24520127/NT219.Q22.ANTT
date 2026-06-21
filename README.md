# UITify — Secure Music Streaming Platform

Capstone project for **NT219 — Cryptography** (UIT, HK2 2025–2026) — **Group 20**

A Spotify-inspired music streaming platform with end-to-end cryptographic protection: MPEG-DASH/CENC content encryption, DPoP-bound license delivery, OpenBao KMS, and spread-spectrum forensic watermarking.

| MSSV | Họ tên |
|------|--------|
| 24520127 | Tống Khí Đức Anh |
| 24520346 | Phạm Ngọc Dũng|
| 24520357 | Đỗ Tiến Dương|

---

## Architecture

5 Docker services across 3 isolated networks:

```
[Internet]
    │
    ▼
 Nginx (TLS 1.3)          ← public-subnet
    │
    ▼
 Next.js App              ← private-subnet
    ├── OpenBao KMS
    ├── Keycloak OIDC
    └── MariaDB            ← db-subnet (internal, no public route)
```

Encrypted segments are stored on **Cloudflare R2** and never served directly — all access goes through a signed-URL proxy that requires a valid license.

---

## Security Layers

| Layer | Mechanism |
|-------|-----------|
| Transport | TLS 1.3 (ZeroSSL), HSTS, CSP/X-Frame/nosniff headers |
| Auth | Keycloak OIDC, HttpOnly cookie, role-based (`music_listener` / `music_uploader`) |
| Token binding | DPoP (RFC 9449) + JTI blacklist (Upstash Redis) — replay blocked |
| Content encryption | MPEG-DASH CENC, AES-128-CTR per-track KID |
| Key protection at rest | OpenBao KMS — AES-256-GCM transit encrypt over CEK |
| License delivery | X25519 ECDH + HKDF-SHA256 CEK wrapping, Ed25519 binary signature |
| Watermarking | audiowmark spread-spectrum (track-level forensic tracing) |
| Rate limiting | Nginx: 5 req/min (auth), 30 req/min (API), 100 req/min (media) |
| Default-deny API | All `/api/*` routes blocked at Nginx unless explicitly whitelisted |
| Network isolation | `db-subnet` is internal — database unreachable from public-subnet |

---

## Tech Stack

- **App:** Next.js 15 (App Router), TypeScript
- **Auth:** Keycloak 26+, NextAuth.js
- **KMS:** OpenBao 2.0 (HashiCorp Vault fork)
- **Database:** MariaDB 10.11
- **JTI / rate-limit store:** Upstash Redis
- **Packaging:** shaka-packager (CENC), FFmpeg
- **Storage / CDN:** Cloudflare R2
- **Watermark:** audiowmark
- **Reverse proxy:** Nginx (TLS 1.3)
- **Container:** Docker Compose

---

## Quick Start

### Prerequisites

- Docker + Docker Compose
- Domain with public DNS (DuckDNS or similar)
- TLS certificate files at `/etc/nginx/ssl/cert.pem` and `/etc/nginx/ssl/key.pem`
- Cloudflare R2 bucket (for encrypted segments)
- Upstash Redis instance (for DPoP JTI blacklist)

### 1. Clone and configure

```bash
git clone <repo-url>
cd project
cp .env.example .env
# Edit .env and fill in all secrets
```

Key `.env` variables:

```env
DOMAIN=uitify.duckdns.org
DB_ROOT_PASSWORD=
KC_ADMIN_PASSWORD=
BAO_PRODUCTION_TOKEN=
KEYCLOAK_CLIENT_ID=
KEYCLOAK_SECRET=
KEYCLOAK_DPOP_PRIVATE_JWK=
LICENSE_SIGNING_PRIVATE_JWK=
LICENSE_SIGNING_PUBLIC_JWK=
R2_ACCOUNT_ID=
R2_BUCKET_NAME=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
```

### 2. Start all services

```bash
docker compose up -d
```

Startup order: `db` (healthcheck) → `openbao` + `keycloak` → `app` → `nginx`

### 3. Keycloak realm

Realm config auto-imports from `realm-export.json` on first start (`start --import-realm`).

Roles required in `drm-realm`: `music_listener`, `music_uploader`.

---

## Project Structure

```
project/
├── app-core/                   # Next.js app
│   └── src/
│       ├── app/api/
│       │   ├── auth/           # NextAuth OIDC callbacks + DPoP key gen
│       │   ├── license/        # License server — 13-step auth + crypto pipeline
│       │   ├── ingest/upload/  # Upload pipeline — CENC packaging + R2 upload
│       │   └── watermark/      # Watermark verify endpoint + audit trail lookup
│       └── lib/
│           ├── dpop/verify.ts  # DPoP proof verify (RFC 9449, 9-step, JTI blacklist)
│           ├── kms/bao.ts      # OpenBao transit decrypt
│           ├── crypto/ecdh.ts  # X25519 ECDH + HKDF-SHA256 CEK wrapping
│           └── track-db.ts     # MariaDB queries + audit_logs
├── security/
│   ├── nginx/nginx.conf        # TLS 1.3, rate limiting, API whitelist (default deny)
│   ├── config/bao-config.hcl  # OpenBao server config
│   └── certificates/           # TLS cert generation scripts
├── ingest/scripts/
│   └── init-db.sql             # MariaDB schema (tracks, audit_logs)
├── data/                       # Runtime volumes (gitignored)
├── realm-export.json           # Keycloak realm + client config
└── docker-compose.yml
```

---

## License Flow

```
Client                   App (Next.js)              OpenBao
  │                           │                         │
  ├─ POST /api/license        │                         │
  │  Cookie: access_token     │                         │
  │  DPoP: <proof_jwt>        │                         │
  │  Body: CENC challenge ───►│                         │
  │                           ├─ 1. Verify JWT (Keycloak JWKS)
  │                           ├─ 2. Check role music_listener
  │                           ├─ 3. Rate limit (Upstash, 10/min)
  │                           ├─ 4. Verify DPoP proof + JTI blacklist
  │                           ├─ 5. Extract KID from challenge
  │                           ├─ 6. Lookup encrypted CEK (MariaDB)
  │                           ├─ 7. Decrypt CEK ──────────────────►│
  │                           │◄─────────────── plaintext CEK ─────│
  │                           ├─ 8. ECDH wrap CEK (X25519 + HKDF)
  │                           ├─ 9. Ed25519 sign binary payload
  │                           └─ 10. Log LICENSE_ISSUED → audit_logs
  │◄── binary license ────────│
  │    [4B len][payload][sig] │
```

---

## Watermark Forensic Chain

When a ripped audio file is detected in the wild:

```bash
# 1. Extract embedded payload from ripped audio
audiowmark get ripped.wav
# Output: pattern XXXXX  (trackId without hyphens)

# 2. Resolve trackId to track metadata and KID
curl https://uitify.duckdns.org/api/watermark/verify \
  -H "Content-Type: application/json" \
  -d '{"payload": "<trackId>"}'
# Response: { trackId, title, artist, kid }

# 3. Trace which users received a license for this KID
SELECT user_id, timestamp FROM audit_logs
WHERE kid = '<kid>' AND event_type = 'LICENSE_ISSUED'
ORDER BY timestamp DESC;
```

---

## Research Questions

| RQ | Question | Answer summary |
|----|----------|----------------|
| RQ1 | Key distribution design balancing security, latency, scalability? | ECDH per-session wrapping + Redis rate limit: ~50ms license latency |
| RQ2 | Forensic watermarking for P2P/stream-rip leak tracing? | audiowmark survives re-encode; detection ~3s; track-level (not per-user) |
| RQ3 | Where do cryptographic attack vectors exist and how are they mitigated? | DPoP replay → JTI blacklist; token theft → HttpOnly cookie; KID brute-force → rate limit + role gate |

---

## Known Limitations

- ClearKey DRM (no Widevine/PlayReady CDM) — CEK extractable from browser memory
- Watermark is track-level, not per-user — identifies the track, not the individual leaker
- OpenBao uses a static root token (no dynamic secrets / auto-unseal)
- No CDN edge caching for license responses (all license requests hit origin)
