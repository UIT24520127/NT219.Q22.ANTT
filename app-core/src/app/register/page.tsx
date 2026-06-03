"use client";
// app/register/page.tsx
import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ShieldCheck, Mail, User, Lock, AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';

function RegisterInner() {
  const router = useRouter();

  const [username, setUsername]               = useState('');
  const [email, setEmail]                     = useState('');
  const [password, setPassword]               = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading]                 = useState(false);
  const [error, setError]                     = useState<string | null>(null);
  const [success, setSuccess]                 = useState(false);

  // ── Inline validation ─────────────────────────────────────────────────────
  const passwordMismatch = confirmPassword.length > 0 && password !== confirmPassword;
  const passwordWeak     = password.length > 0 && password.length < 8;
  const canSubmit        = username && email && password && confirmPassword
                           && !passwordMismatch && !passwordWeak && !loading;

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);
    setLoading(true);

    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, email, password }),
      });

      const data = await res.json();

      if (res.ok) {
        setSuccess(true);
        // Tự chuyển sang login sau 2 giây
        setTimeout(() => router.push('/login'), 2000);
      } else if (res.status === 409) {
        setError('Tên đăng nhập hoặc email đã tồn tại.');
      } else if (res.status === 429) {
        setError('Quá nhiều yêu cầu. Vui lòng thử lại sau 1 phút.');
      } else {
        setError(data.error || 'Đăng ký thất bại. Vui lòng thử lại.');
      }
    } catch {
      setError('Không thể kết nối đến máy chủ. Kiểm tra kết nối mạng.');
    } finally {
      setLoading(false);
    }
  };

  // ── Success state ─────────────────────────────────────────────────────────
  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-900 text-white px-4">
        <div className="bg-gray-800 p-8 rounded-xl shadow-2xl w-full max-w-sm border border-emerald-800/40 text-center">
          <div className="w-16 h-16 mx-auto mb-4 bg-emerald-950 border border-emerald-700 rounded-2xl flex items-center justify-center">
            <CheckCircle2 className="w-9 h-9 text-emerald-400" />
          </div>
          <h2 className="text-xl font-bold mb-2">Đăng ký thành công!</h2>
          <p className="text-gray-400 text-sm">Đang chuyển sang trang đăng nhập...</p>
          <div className="mt-4 flex justify-center">
            <Loader2 className="w-5 h-5 text-emerald-500 animate-spin" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-900 text-white px-4">
      <div className="bg-gray-800 p-8 rounded-xl shadow-2xl w-full max-w-sm border border-gray-700">

        {/* Header */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 mx-auto mb-4 bg-blue-950 border border-blue-800 rounded-2xl flex items-center justify-center">
            <ShieldCheck className="w-9 h-9 text-blue-400" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Tạo tài khoản</h1>
        </div>

        {/* Error banner */}
        {error && (
          <div className="mb-4 flex items-start gap-2.5 p-3 bg-red-950/50 border border-red-800/60 rounded-lg text-red-300 text-sm">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Form */}
        <form className="flex flex-col gap-3" onSubmit={handleRegister}>

          {/* Username */}
          <div className="relative">
            <User className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <input
              type="text"
              placeholder="Tên đăng nhập"
              required
              autoComplete="username"
              value={username}
              onChange={e => { setUsername(e.target.value); setError(null); }}
              disabled={loading}
              className="w-full bg-gray-900 border border-gray-600 rounded-lg p-3 pl-9 text-white text-sm
                         placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors
                         disabled:opacity-50"
            />
          </div>

          {/* Email */}
          <div className="relative">
            <Mail className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <input
              type="email"
              placeholder="Email"
              required
              autoComplete="email"
              value={email}
              onChange={e => { setEmail(e.target.value); setError(null); }}
              disabled={loading}
              className="w-full bg-gray-900 border border-gray-600 rounded-lg p-3 pl-9 text-white text-sm
                         placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors
                         disabled:opacity-50"
            />
          </div>

          {/* Password */}
          <div>
            <div className="relative">
              <Lock className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
              <input
                type="password"
                placeholder="Mật khẩu (tối thiểu 8 ký tự)"
                required
                minLength={8}
                autoComplete="new-password"
                value={password}
                onChange={e => { setPassword(e.target.value); setError(null); }}
                disabled={loading}
                className={`w-full bg-gray-900 border rounded-lg p-3 pl-9 text-white text-sm
                           placeholder-gray-500 focus:outline-none transition-colors disabled:opacity-50
                           ${passwordWeak ? 'border-amber-600 focus:border-amber-500' : 'border-gray-600 focus:border-blue-500'}`}
              />
            </div>
            {passwordWeak && (
              <p className="text-amber-400 text-xs mt-1 ml-1">Mật khẩu cần ít nhất 8 ký tự.</p>
            )}
          </div>

          {/* Confirm password */}
          <div>
            <div className="relative">
              <Lock className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
              <input
                type="password"
                placeholder="Nhập lại mật khẩu"
                required
                autoComplete="new-password"
                value={confirmPassword}
                onChange={e => { setConfirmPassword(e.target.value); setError(null); }}
                disabled={loading}
                className={`w-full bg-gray-900 border rounded-lg p-3 pl-9 text-white text-sm
                           placeholder-gray-500 focus:outline-none transition-colors disabled:opacity-50
                           ${passwordMismatch ? 'border-red-600 focus:border-red-500' : 'border-gray-600 focus:border-blue-500'}`}
              />
            </div>
            {passwordMismatch && (
              <p className="text-red-400 text-xs mt-1 ml-1">Mật khẩu nhập lại không khớp.</p>
            )}
          </div>

          <button
            type="submit"
            disabled={!canSubmit}
            className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500
                       p-3 rounded-lg font-semibold text-sm transition-all mt-1
                       disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Đang tạo tài khoản...
              </>
            ) : 'Đăng ký tài khoản'}
          </button>
        </form>

        {/* Footer */}
        <p className="mt-6 text-center text-sm text-gray-400">
          Đã có tài khoản?{' '}
          <button
            onClick={() => router.push('/login')}
            className="text-blue-400 hover:text-blue-300 font-semibold transition-colors"
          >
            Đăng nhập ngay
          </button>
        </p>
      </div>
    </div>
  );
}

export default function RegisterPage() {
  return (
    <React.Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-gray-900">
        <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
      </div>
    }>
      <RegisterInner />
    </React.Suspense>
  );
}
