"use client";

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Fingerprint, ShieldCheck, User, Lock } from 'lucide-react';

export default function LoginPage() {
  const router = useRouter();
  const [loginMethod, setLoginMethod] = useState<'passkey' | 'totp'>('passkey');
  const [loading, setLoading] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const handleDummyPasskey = (e: React.MouseEvent) => {
    e.preventDefault();
    alert("Tính năng quét vân tay/Passkey sẽ được hoàn thiện sau!");
  };

  const handlePasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const response = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });

      const data = await response.json();

      if (response.ok) {
        alert("Tuyệt vời! Đăng nhập thành công và đã nhận DPoP-bound Token!");
        localStorage.setItem("token", data.access_token);
        router.push('/'); // Đăng nhập xong nhảy về trang chủ nghe nhạc
      } else {
        alert(`Đăng nhập thất bại: ${data.error_description || data.error}`);
      }
    } catch (error) {
      alert("Không thể kết nối đến máy chủ Backend!");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-900 text-white">
      <div className="bg-gray-800 p-8 rounded-xl shadow-2xl w-96 border border-gray-700">
        <div className="text-center mb-6">
          <ShieldCheck className="w-16 h-16 mx-auto text-green-500 mb-4" />
          <h1 className="text-2xl font-bold">Secure Player</h1>
          <p className="text-gray-400 text-sm mt-2">Hệ thống DRM Streaming Bảo Mật</p>
        </div>

        {/* Form Đăng nhập bằng Password thuần túy, sạch đẹp */}
        <form className="flex flex-col gap-4" onSubmit={handlePasswordLogin}>
          <div className="relative">
            <input type="text" placeholder="Tên đăng nhập" required value={username} onChange={(e) => setUsername(e.target.value)} className="w-full bg-gray-900 border border-gray-600 rounded-lg p-3 pl-10 text-white focus:outline-none focus:border-blue-500" />
            <User className="w-5 h-5 absolute left-3 top-3 text-gray-400" />
          </div>
          <div className="relative">
            <input type="password" placeholder="Mật khẩu" required value={password} onChange={(e) => setPassword(e.target.value)} className="w-full bg-gray-900 border border-gray-600 rounded-lg p-3 pl-10 text-white focus:outline-none focus:border-blue-500" />
            <Lock className="w-5 h-5 absolute left-3 top-3 text-gray-400" />
          </div>
          <button type="submit" disabled={loading} className="w-full bg-blue-600 hover:bg-blue-700 p-3 rounded-lg font-bold transition-all mt-2 disabled:opacity-50">
            {loading ? 'Đang kết nối...' : 'Đăng nhập'}
          </button>
        </form>

        <div className="mt-6 text-center text-sm text-gray-400">
          <p>Chưa có tài khoản? <span onClick={() => router.push('/register')} className="text-green-500 hover:text-green-400 cursor-pointer font-bold transition-colors">Đăng ký ngay</span></p>
        </div>
      </div>
    </div>
  );
}