secure-player-root/                     # Thư mục gốc dự án trên GitHub
├── .github/workflows/                  # CI/CD tự động build Docker
├── docker-compose.yml                  # File điều phối chính
├── .env                                # CHỈ CHỨA: Endpoint, DB URL, non-sensitive config
│
├── ingest/                             # ZONE 4: MANAGEMENT ZONE (Isolated)
│   ├── input-temp/                     # Vùng đệm chứa file nhạc thô .mp3 chưa xử lý
│   └── scripts/                        # Di chuyển thư mục 'scripts' cũ vào đây
│       └── packager.sh                 # Script băm nhạc rồi đẩy thẳng lên Cloudflare R2
│
├── app-core/                           # ZONE 1 & 2: CỤM NEXT.JS FULL STACK (Bọc lại cho sạch)
│   ├── src/
│   │   └── app/
│   │       ├── api/auth/               # Backend: Route xử lý Auth Keycloak
│   │       ├── api/license/            # Backend: License Proxy (Xử lý Widevine Challenge)
│   │       │   └── route.ts            #
│   │       ├── login/                  # Frontend: Giao diện Đăng nhập
│   │       └── player/                 # Frontend: Giao diện Trình phát nhạc (Shaka Player)
│   │   └── lib/                        # Backend: Logic kết nối hạ tầng nhạy cảm
│   │       ├── db/mariadb.ts           # Kết nối Database Pooling
│   │       ├── kms/bao.ts              # Service gọi giải mã qua OpenBao
│   │       └── storage/r2.ts           # Service tạo Signed URL kết nối Cloudflare R2
│   ├── public/                         # Assets tĩnh của Web
│   ├── package.json                    # Config dependencies của Next.js
│   ├── next.config.mjs                 #
│   └── tsconfig.json                   #
│
├── security/                           # ZONE 3: SECURITY ZONE
│   ├── openbao/                        # Cấu hình OpenBao KMS (Auto-unseal qua OCI KMS)
│   └── watermark/                      # Script nhúng dấu vết sóng âm A/B Switching
│   └── opa/
		└── policies/
│
└── data/                               # ZONE 3: DATA STORAGE ZONE (Vùng tối - No Public IP)
    ├── database/                       #
    │   └── init.sql                    # Script tạo bảng tracks, audit_logs (Cập nhật đường dẫn)
    ├── valkey/                         # Cấu hình bộ nhớ đệm Valkey (Chống Replay DPoP)
    └── cache/                          # Chỉ làm vùng nhớ đệm temporary local-dev
