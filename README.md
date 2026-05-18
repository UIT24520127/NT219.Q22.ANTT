project-root/
├── .github/          	# GitHub Actions (CI/CD) để tự động build docker image
├── docker-compose.yml	# File điều phối chính cho toàn bộ hệ thống
├── .env              	# Lưu biến môi trường (Database password, KMS keys)
│
├── ingest/           	# ZONE 4: MANAGEMENT (Xử lý nhạc đầu vào)
│   ├── Dockerfile
│   ├── scripts/          # Script chạy FFmpeg & Shaka Packager
│   └── input/        	# Nhạc gốc chưa xử lý
│
├── server/           	# ZONE 2: PRIVATE SUBNET (Backend logic)
│   ├── Dockerfile
│   ├── middleware/   	# Next.js Middleware & License Proxy
│   ├── auth/         	# Cấu hình Keycloak/IdP
│   └── policy/       	# Cấu hình Open Policy Agent (OPA)
│
├── proxy/            	# ZONE 2: NGINX (Edge Cache)
│   ├── Dockerfile
│   └── nginx.conf    	# Cấu hình cache và giới hạn IP chỉ cho phép Private
│
├── client/           	# ZONE 1: PUBLIC (Frontend)
│   ├── Dockerfile
│   ├── src/          	# Next.js Frontend + Shaka Player
│   └── public/
│
├── security/         	# ZONE 3: SECURITY (KMS & Watermarking)
│   ├── openbao/      	# Cấu hình OpenBao KMS
│   └── watermark/    	# Script nhúng Audio Watermarking
│
└── data/             	# ZONE 3: DATABASE & STORAGE (Persistent Data)
	├── mariadb/      	# Script khởi tạo SQL (Init.sql)
	├── valkey/       	# Cấu hình Valkey Cache
	└── storage/      	# Thư mục chứa các Encrypted Segments (.mpd, .m3u8)