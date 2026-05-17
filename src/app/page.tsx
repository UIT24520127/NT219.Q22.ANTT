"use client";
import React, { useState } from 'react';
import { Fingerprint, KeyRound, ShieldCheck } from 'lucide-react';

export default function LoginPage() {
  const [loginMethod, setLoginMethod] = useState<'passkey' | 'totp'>('passkey');
  const [loading, setLoading] = useState(false);
  
  // 1. Biến lưu tài khoản và mật khẩu
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  // Hàm tạm cho nút Passkey (vì mình chưa làm tính năng này)
  const handleDummyPasskey = (e: React.MouseEvent) => {
    e.preventDefault();
    alert("Tính năng quét vân tay/Passkey sẽ được hoàn thiện sau!");
  };

  // 2. Logic gọi API Keycloak chuẩn cho Mật khẩu
  const handlePasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    const REALM_NAME = "drm-realm";
    const CLIENT_ID = "frontend-client";

    try {
      const response = await fetch(`http://localhost:8080/realms/${REALM_NAME}/protocol/openid-connect/token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          grant_type: 'password',
          client_id: CLIENT_ID,
          username: username,
          password: password,
        }),
      });

      const data = await response.json();

      if (response.ok) {
        alert("Tuyệt vời! Đăng nhập thành công và đã lưu Token!");
        console.log("Access Token:", data.access_token);
        
        // Lưu token vào két sắt của trình duyệt
        localStorage.setItem("drm_token", data.access_token);
        
      } else {
        alert(`Keycloak báo lỗi: ${data.error_description || data.error}`);
      }
    } catch (error) {
      console.error("Lỗi kết nối:", error);
      alert("Không thể kết nối đến máy chủ Keycloak (Cổng 8080)!");
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
              onClick={handleDummyPasskey} disabled={loading}
              className="flex items-center justify-center gap-2 w-full bg-green-600 hover:bg-green-700 p-3 rounded-lg font-bold transition-all disabled:opacity-50"
            >
              <Fingerprint className="w-5 h-5" />
              {loading ? 'Đang tải...' : 'Quét vân tay / Passkey'}
            </button>
          </div>
        ) : (
          <form className="flex flex-col gap-4" onSubmit={handlePasswordLogin}>
            <input 
              type="text" placeholder="Tên đăng nhập" required
              value={username} 
              onChange={(e) => setUsername(e.target.value)}
              className="w-full bg-gray-900 border border-gray-600 rounded-lg p-3 text-white focus:outline-none focus:border-blue-500"
            />
            <input 
              type="password" placeholder="Mật khẩu" required
              value={password} 
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-gray-900 border border-gray-600 rounded-lg p-3 text-white focus:outline-none focus:border-blue-500"
            />
            <div className="relative">
              <input 
                type="text" placeholder="Mã TOTP (nếu có)" maxLength={6}
                className="w-full bg-gray-900 border border-gray-600 rounded-lg p-3 text-white focus:outline-none focus:border-blue-500 pl-10"
              />
              <KeyRound className="w-5 h-5 absolute left-3 top-3 text-gray-400" />
            </div>
            <button 
              type="submit" disabled={loading}
              className="w-full bg-blue-600 hover:bg-blue-700 p-3 rounded-lg font-bold transition-all mt-2 disabled:opacity-50"
            >
              {loading ? 'Đang tải...' : 'Đăng nhập bằng Mật khẩu'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}