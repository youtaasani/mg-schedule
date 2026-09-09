'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';

export default function LoginPage() {
  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage('');
    setIsLoading(true);

    try {
      // 1. 小文字・アンダースコアのカラム名で users テーブルを検索
      const { data: user, error } = await supabase
        .from('users')
        .select('*')
        .eq('login_id', loginId)
        .eq('ronridelflg', '0')
        .single();

      if (error || !user) {
        setErrorMessage('ログインIDまたはパスワードが正しくありません。');
        setIsLoading(false);
        return;
      }

      // 2. パスワード照合
      if (user.password_hash !== password) {
        setErrorMessage('ログインIDまたはパスワードが正しくありません。');
        setIsLoading(false);
        return;
      }

      // 3. ログイン情報を保存
      localStorage.setItem(
        'user',
        JSON.stringify({
          id: user.id,
          name: user.name,
          role: user.role,
        })
      );

      // 4. トップページへリダイレクト
      router.push('/');
    } catch (err) {
      console.error('Login Error:', err);
      setErrorMessage('エラーが発生しました。時間をおいて再度お試しください。');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-100 p-4">
      <div className="w-full max-w-md rounded-lg bg-white p-8 shadow-md">
        <h1 className="mb-6 text-center text-2xl font-bold text-gray-800">
          出欠管理システム ログイン
        </h1>

        {errorMessage && (
          <div className="mb-4 rounded bg-red-100 p-3 text-sm text-red-700">
            {errorMessage}
          </div>
        )}

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              ログインID
            </label>
            <input
              type="text"
              required
              value={loginId}
              onChange={(e) => setLoginId(e.target.value)}
              className="w-full rounded border border-gray-300 p-2 text-black focus:border-blue-500 focus:outline-none"
              placeholder="例: login id"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              パスワード
            </label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded border border-gray-300 p-2 text-black focus:border-blue-500 focus:outline-none"
              placeholder="••••••••"
            />
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full rounded bg-blue-600 py-2 text-white transition hover:bg-blue-700 disabled:bg-blue-300"
          >
            {isLoading ? 'ログイン処理中...' : 'ログイン'}
          </button>
        </form>
      </div>
    </div>
  );
}