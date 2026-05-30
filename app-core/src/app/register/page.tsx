"use client";

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ShieldCheck, Mail, User, Lock } from 'lucide-react';

export default function RegisterPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirmPassword) {
      alert("Lỗi: Mật khẩu nhập lại không khớp!");
      return;
    }
    
    setLoading(true);
    try {
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, email, password }),
      });

      const data = await response.json();
      if (response.ok) {
        alert("🎉 Đăng ký thành công rực rỡ! Hệ thống sẽ tự chuyển về Đăng nhập.");
        router.push('/login'); // Thành công đẩy sang trang đăng nhập mới
      } else {
        alert(`Đăng ký thất bại: ${data.error}`);
      }
    } catch (error) {
      alert("Lỗi hệ thống, không gọi được Backend đăng ký!");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-900 text-white">
      <div className="bg-gray-800 p-8 rounded-xl shadow-2xl w-96 border border-gray-700">
        <div className="text-center mb-6">
          <ShieldCheck className="w-16 h-16 mx-auto text-blue-500 mb-4" />
          <h1 className="text-2xl font-bold">Tạo Tài Khoản Mới</h1>
          <p className="text-gray-400 text-sm mt-2">Dự án DRM Streaming</p>
        </div>

        <form className="flex flex-col gap-4" onSubmit={handleRegister}>
          <div className="relative">
            <input type="text" placeholder="Tên đăng nhập" required value={username} onChange={(e) => setUsername(e.target.value)} className="w-full bg-gray-900 border border-gray-600 rounded-lg p-3 pl-10 text-white focus:outline-none focus:border-green-500" />
            <User className="w-5 h-5 absolute left-3 top-3 text-gray-400" />
          </div>
          <div className="relative">
            <input type="email" placeholder="Email bắt buộc" required value={email} onChange={(e) => setEmail(e.target.value)} className="w-full bg-gray-900 border border-gray-600 rounded-lg p-3 pl-10 text-white focus:outline-none focus:border-green-500" />
            <Mail className="w-5 h-5 absolute left-3 top-3 text-gray-400" />
          </div>
          <div className="relative">
            <input type="password" placeholder="Mật khẩu" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} className="w-full bg-gray-900 border border-gray-600 rounded-lg p-3 pl-10 text-white focus:outline-none focus:border-green-500" />
            <Lock className="w-5 h-5 absolute left-3 top-3 text-gray-400" />
          </div>
          <div className="relative">
            <input type="password" placeholder="Nhập lại mật khẩu" required value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} className="w-full bg-gray-900 border border-gray-600 rounded-lg p-3 pl-10 text-white focus:outline-none focus:border-green-500" />
            <Lock className="w-5 h-5 absolute left-3 top-3 text-gray-400" />
          </div>
          <button type="submit" disabled={loading} className="w-full bg-green-600 hover:bg-green-700 p-3 rounded-lg font-bold transition-all mt-2">
            {loading ? 'Đang xử lý...' : 'Đăng ký Tài Khoản'}
          </button>
        </form>

        <div className="mt-6 text-center text-sm text-gray-400">
          <p>Đã có tài khoản? <span onClick={() => router.push('/login')} className="text-blue-500 hover:text-blue-400 cursor-pointer font-bold transition-colors">Đăng nhập ngay</span></p>
        </div>
      </div>
    </div>
  );
}