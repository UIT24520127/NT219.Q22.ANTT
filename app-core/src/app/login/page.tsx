"use client";
import React, { useState } from 'react';
import { Fingerprint, KeyRound, ShieldCheck, Mail, User, Lock } from 'lucide-react';

export default function LoginPage() {
  const [loginMethod, setLoginMethod] = useState<'passkey' | 'totp'>('passkey');
  const [loading, setLoading] = useState(false);
  const [isRegistering, setIsRegistering] = useState(false);
  
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const handleDummyPasskey = (e: React.MouseEvent) => {
    e.preventDefault();
    alert("Tính năng quét vân tay/Passkey sẽ được hoàn thiện sau!");
  };

  const handlePasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const REALM_NAME = "drm-realm";
    const CLIENT_ID = "frontend-client";

    try {
      const response = await fetch(`http://localhost:8080/realms/${REALM_NAME}/protocol/openid-connect/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
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
        localStorage.setItem("drm_token", data.access_token);
      } else {
        alert(`Keycloak báo lỗi: ${data.error_description || data.error}`);
      }
    } catch (error) {
      alert("Không thể kết nối đến máy chủ Keycloak!");
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirmPassword) {
      alert("Lỗi: Mật khẩu nhập lại không khớp!");
      return;
    }
    
    setLoading(true);
    try {
      // Gọi API nội bộ của Next.js
      const response = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, email, password }),
      });

      const data = await response.json();
      if (response.ok) {
        alert("🎉 Đăng ký thành công rực rỡ! Hệ thống sẽ tự chuyển về Đăng nhập.");
        setIsRegistering(false);
        setPassword('');
        setConfirmPassword('');
      } else {
        alert(`Đăng ký thất bại: ${data.error}`);
      }
    } catch (error) {
      alert("Lỗi hệ thống, không gọi được Backend!");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-900 text-white">
      <div className="bg-gray-800 p-8 rounded-xl shadow-2xl w-96 border border-gray-700 transition-all">
        <div className="text-center mb-6">
          <ShieldCheck className="w-16 h-16 mx-auto text-green-500 mb-4" />
          <h1 className="text-2xl font-bold">{isRegistering ? 'Tạo Tài Khoản Mới' : 'Secure Player'}</h1>
          <p className="text-gray-400 text-sm mt-2">Dự án DRM Streaming</p>
        </div>

        {!isRegistering ? (
          <>
            <div className="flex mb-6 bg-gray-700 rounded-lg p-1">
              <button 
                className={`flex-1 py-2 rounded-md text-sm font-semibold transition-all ${loginMethod === 'passkey' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'}`}
                onClick={() => setLoginMethod('passkey')}
              >Passkey</button>
              <button 
                className={`flex-1 py-2 rounded-md text-sm font-semibold transition-all ${loginMethod === 'totp' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'}`}
                onClick={() => setLoginMethod('totp')}
              >Password</button>
            </div>

            {loginMethod === 'passkey' ? (
              <div className="flex flex-col gap-4">
                <button onClick={handleDummyPasskey} disabled={loading} className="flex items-center justify-center gap-2 w-full bg-green-600 hover:bg-green-700 p-3 rounded-lg font-bold transition-all disabled:opacity-50">
                  <Fingerprint className="w-5 h-5" />
                  {loading ? 'Đang tải...' : 'Quét vân tay / Passkey'}
                </button>
              </div>
            ) : (
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
            )}
          </>
        ) : (
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
            <button type="submit" disabled={loading} className="w-full bg-green-600 hover:bg-green-700 p-3 rounded-lg font-bold transition-all mt-2 disabled:opacity-50">
              {loading ? 'Đang xử lý...' : 'Đăng ký Tài Khoản'}
            </button>
          </form>
        )}

        <div className="mt-6 text-center text-sm text-gray-400">
          {isRegistering ? (
            <p>Đã có tài khoản? <span onClick={() => setIsRegistering(false)} className="text-blue-500 hover:text-blue-400 cursor-pointer font-bold transition-colors">Đăng nhập ngay</span></p>
          ) : (
            <p>Chưa có tài khoản? <span onClick={() => setIsRegistering(true)} className="text-green-500 hover:text-green-400 cursor-pointer font-bold transition-colors">Đăng ký ngay</span></p>
          )}
        </div>
      </div>
    </div>
  );
}