import mysql from 'mysql2/promise';

// Tạo pool kết nối để tối ưu hiệu năng
const pool = mysql.createPool({
  host: 'localhost',
  port: 3306,
  user: 'root',
  password: 'root_password', // Khớp với file docker-compose
  database: 'drm_system',    // Khớp với file docker-compose
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

export default pool;