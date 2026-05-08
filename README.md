project/
├── 📂 .next/               # Folder chạy ngầm của Next.js (ignore)
├── 📂 node_modules/        # Thư viện (Axios, Next, React...)
├── 📂 public/              # Ảnh, icon...
├── 📂 scripts/
│   └── 📜 setup-bao.sh     # Script cấu hình KMS của bạn
├── 📂 src/
│   ├── 📂 app/             # Next.js App Router
│   │   └── 📂 api/
│   │       └── 📂 kms/
│   │           └── 📂 encrypt/
│   │               └── 📜 route.ts  # API nhận file, gọi KMS mã hóa
│   ├── 📂 lib/             # Nơi chứa "xương sống" logic
│   │   ├── 📂 kms/
│   │   │   └── 📜 bao.ts   # Logic gọi OpenBao (Service)
│   │   └── 📜 db.ts        # (Sắp tạo) Kết nối MariaDB
├── 📜 .env.local           # Biến môi trường (Root Token, DB Pass...)
├── 📜 docker-compose.yml   # "Bản vẽ" để dựng OpenBao & MariaDB
├── 📜 package.json         # Danh sách thư viện
└── 📜 tsconfig.json        # Cấu hình TypeScript (vừa fix @/* xong)