"use client";
import React, { useState } from 'react';
import { startAuthentication } from '@simplewebauthn/browser';
import { Fingerprint, KeyRound, ShieldCheck } from 'lucide-react';

export default function LoginPage() {
  const [loginMethod, setLoginMethod] = useState<'passkey' | 'totp'>('passkey');
  const [loading, setLoading] = useState(false);

  // Thêm state để bắt dữ liệu người dùng nhập
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [totp, setTotp] = useState('');

  // 1. Luồng xử lý Passkey (Sẽ gọi API của Người A viết riêng)
  const handlePasskeyLogin = async () => {
    setLoading(true);
    try {
      alert("Đợi Người A làm xong API Passkey rồi gắn link vào đây!");
    } catch (error) {
      console.error('Lỗi xác thực:', error);
    } finally {
      setLoading(false);
    }
  };

  // 2. Luồng xử lý Mật khẩu + TOTP (Gọi thẳng vào Keycloak)
  const handlePasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    
    // !!! BẠN CẦN THAY ĐỔI 2 THÔNG SỐ NÀY KHI NGƯỜI A GỬI CẤU HÌNH !!!
    const REALM_NAME = "drm-realm"; 
    const CLIENT_ID = "frontend-client"; 

    try {
      const response = await fetch(`http://localhost:8080/realms/${REALM_NAME}/protocol/openid-connect/token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        // Gói hàng gửi sang Keycloak
        body: new URLSearchParams({
          grant_type: 'password',
          client_id: CLIENT_ID,
          username: username,
          password: password,
          // totp: totp (Sẽ cấu hình thêm nếu Keycloak yêu cầu gửi kèm mã OTP)
        }),
      });

      const data = await response.json();

      if (response.ok) {
        console.log("Tuyệt vời! Lấy được Token rồi:", data.access_token);
        alert("Đăng nhập thành công! Đã lấy được Access Token (xem F12 console).");
        // Lát nữa có token rồi mình sẽ viết code chuyển hướng sang trang xem phim
      } else {
        alert("Sai tài khoản hoặc mật khẩu! Keycloak báo lỗi: " + data.error_description);
      }
    } catch (error) {
      alert("Không kết nối được với Keycloak! Đảm bảo Docker drm_auth đang chạy ở cổng 8080.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-900 text-white">
      <div className="bg-gray-800 p-8 rounded-xl shadow-2xl w-96 border border-gray-700">
        <div className="text-center mb-8">
          <ShieldCheck className="w-16 h-16 mx-auto text-green-500 mb-4" />
          <h1 className="text-2xl font-bold">Secure Player</h1>
          <p className="text-gray-400 text-sm mt-2">Dự án DRM Streaming</p>
        </div>

        <div className="flex mb-6 bg-gray-700 rounded-lg p-1">
          <button 
            className={`flex-1 py-2 rounded-md text-sm font-semibold transition-all ${loginMethod === 'passkey' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'}`}
            onClick={() => setLoginMethod('passkey')}
          >
            Passkey
          </button>
          <button 
            className={`flex-1 py-2 rounded-md text-sm font-semibold transition-all ${loginMethod === 'totp' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'}`}
            onClick={() => setLoginMethod('totp')}
          >
            Password + TOTP
          </button>
        </div>

        {loginMethod === 'passkey' ? (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-gray-400 text-center mb-2">Đăng nhập nhanh chóng và an toàn bằng sinh trắc học.</p>
            <button 
              onClick={handlePasskeyLogin} disabled={loading}
              className="flex items-center justify-center gap-2 w-full bg-green-600 hover:bg-green-700 p-3 rounded-lg font-bold transition-all disabled:opacity-50"
            >
              <Fingerprint className="w-5 h-5" />
              {loading ? 'Đang gọi API...' : 'Quét vân tay / Passkey'}
            </button>
          </div>
        ) : (
          <form className="flex flex-col gap-4" onSubmit={handlePasswordLogin}>
            <input 
              type="text" placeholder="Tên đăng nhập" required
              value={username} onChange={(e) => setUsername(e.target.value)}
              className="w-full bg-gray-900 border border-gray-600 rounded-lg p-3 text-white focus:outline-none focus:border-blue-500"
            />
            <input 
              type="password" placeholder="Mật khẩu" required
              value={password} onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-gray-900 border border-gray-600 rounded-lg p-3 text-white focus:outline-none focus:border-blue-500"
            />
            <div className="relative">
              <input 
                type="text" placeholder="Mã TOTP (nếu có)" maxLength={6}
                value={totp} onChange={(e) => setTotp(e.target.value)}
                className="w-full bg-gray-900 border border-gray-600 rounded-lg p-3 text-white focus:outline-none focus:border-blue-500 pl-10"
              />
              <KeyRound className="w-5 h-5 absolute left-3 top-3 text-gray-400" />
            </div>
            <button 
              type="submit" disabled={loading}
              className="w-full bg-blue-600 hover:bg-blue-700 p-3 rounded-lg font-bold transition-all mt-2 disabled:opacity-50"
            >
              {loading ? 'Đang kết nối...' : 'Đăng nhập bằng Mật khẩu'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}