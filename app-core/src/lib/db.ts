import mysql from 'mysql2/promise';

// Khởi tạo Pool kết nối tự động cấu hình theo môi trường (Docker Network / Local Dev)
const pool = mysql.createPool({
  // Nếu chạy trực tiếp Next.js bằng npm run dev ngoài máy thật, biến DB_HOST sẽ lấy 'localhost'
  // Nếu chạy container hóa hoàn toàn, biến DB_HOST sẽ được inject là 'drm_mariadb' từ .env hoặc docker-compose
  host: process.env.DB_HOST || 'drm_mariadb', 
  port: parseInt(process.env.DB_PORT || '3306', 10),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || 'root_password', // Khớp chính xác với cấu hình docker-compose
  database: process.env.DB_NAME || 'drm_system',        // Khớp với db khởi tạo
  
  // Tối ưu hóa Pooling xử lý đồng thời nhiều luồng lấy License cùng lúc
  waitForConnections: true,
  connectionLimit: 10,  // Giới hạn tối đa 10 kết nối đồng thời tránh nghẽn DB
  queueLimit: 0         // Không giới hạn hàng đợi yêu cầu
});

export default pool;