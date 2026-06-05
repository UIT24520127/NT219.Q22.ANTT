"use client";
// app/login/page.tsx
import React, { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ShieldCheck, User, Lock, AlertCircle, Loader2 } from 'lucide-react';
import { getCurrentUser, getRoleFromPayload, getRedirectByRole } from '@/lib/auth/token';

function LoginInner() {
  const router       = useRouter();
  const searchParams = useSearchParams();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);

  // Nếu đã có cookie hợp lệ → redirect luôn
  useEffect(() => {
    getCurrentUser().then(user => {
      if (!user) return;
      const role     = getRoleFromPayload(user);
      const returnTo = searchParams.get('returnTo') || getRedirectByRole(role);
      router.replace(returnTo);
    });
  }, [router, searchParams]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res  = await fetch('/api/auth/login', {
        method:      'POST',
        headers:     { 'Content-Type': 'application/json' },
        credentials: 'include',               // ← quan trọng: nhận cookie
        body:        JSON.stringify({ username, password }),
      });

      const data = await res.json();

      if (res.ok && data.ok) {
        // Server đã set HttpOnly cookie, client chỉ cần lấy role từ response
        const returnTo = searchParams.get('returnTo') || getRedirectByRole(data.role);
        router.replace(returnTo);
      } else if (res.status === 429) {
        setError('Quá nhiều lần thử. Vui lòng đợi 1 phút rồi thử lại.');
      } else if (res.status === 401) {
        setError('Sai tên đăng nhập hoặc mật khẩu.');
      } else {
        setError(data.error || 'Đăng nhập thất bại. Vui lòng thử lại.');
      }
    } catch {
      setError('Không thể kết nối đến máy chủ. Kiểm tra kết nối mạng.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-900 text-white px-4">
      <div className="bg-gray-800 p-8 rounded-xl shadow-2xl w-full max-w-sm border border-gray-700">

        <div className="text-center mb-8">
          <div className="w-16 h-16 mx-auto mb-4 bg-emerald-950 border border-emerald-800 rounded-2xl flex items-center justify-center">
            <ShieldCheck className="w-9 h-9 text-emerald-500" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Secure Player</h1>
          <p className="text-gray-400 text-sm mt-1">UITify</p>
        </div>

        {error && (
          <div className="mb-4 flex items-start gap-2.5 p-3 bg-red-950/50 border border-red-800/60 rounded-lg text-red-300 text-sm">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form className="flex flex-col gap-4" onSubmit={handleLogin}>
          <div className="relative">
            <User className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <input
              type="text" placeholder="Tên đăng nhập" required autoComplete="username"
              value={username} disabled={loading}
              onChange={e => { setUsername(e.target.value); setError(null); }}
              className="w-full bg-gray-900 border border-gray-600 rounded-lg p-3 pl-9 text-white text-sm
                         placeholder-gray-500 focus:outline-none focus:border-emerald-500 transition-colors disabled:opacity-50"
            />
          </div>

          <div className="relative">
            <Lock className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <input
              type="password" placeholder="Mật khẩu" required autoComplete="current-password"
              value={password} disabled={loading}
              onChange={e => { setPassword(e.target.value); setError(null); }}
              className="w-full bg-gray-900 border border-gray-600 rounded-lg p-3 pl-9 text-white text-sm
                         placeholder-gray-500 focus:outline-none focus:border-emerald-500 transition-colors disabled:opacity-50"
            />
          </div>

          <button
            type="submit" disabled={loading || !username || !password}
            className="w-full flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500
                       p-3 rounded-lg font-semibold text-sm transition-all mt-1
                       disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {loading ? <><Loader2 className="w-4 h-4 animate-spin" />Đang xác thực...</> : 'Đăng nhập'}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-gray-400">
          Chưa có tài khoản?{' '}
          <button onClick={() => router.push('/register')}
            className="text-emerald-400 hover:text-emerald-300 font-semibold transition-colors">
            Đăng ký ngay
          </button>
        </p>

        <div className="mt-6 pt-4 border-t border-gray-700 flex items-center justify-center gap-1.5 text-[10px] font-mono text-gray-600">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 inline-block" />
          DPoP  · OpenBao KMS
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <React.Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-gray-900">
        <Loader2 className="w-8 h-8 text-emerald-500 animate-spin" />
      </div>
    }>
      <LoginInner />
    </React.Suspense>
  );
}