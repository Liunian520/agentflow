import { useState, useEffect, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { LogIn, User, Lock, Eye, EyeOff, Loader2, Sparkles, ShieldCheck } from 'lucide-react';
import { useStore } from '../store/useStore';

export function LoginPage() {
  const navigate = useNavigate();
  const { login, setupAdmin, currentUser, isFirstTime } = useStore();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // 已登录则直接跳转首页
  useEffect(() => {
    if (currentUser) {
      navigate('/workspace', { replace: true });
    }
  }, [currentUser, navigate]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (loading) return;
    if (!username.trim() || !password) {
      setError('请输入用户名和密码');
      return;
    }
    if (password.length < 6) {
      setError('密码长度至少 6 位');
      return;
    }
    setError('');
    setLoading(true);

    try {
      if (isFirstTime) {
        // 首次使用：创建管理员账号
        await setupAdmin(username.trim(), password);
        navigate('/workspace', { replace: true });
      } else {
        // 正常登录
        const ok = await login(username.trim(), password);
        if (!ok) {
          setError('用户名或密码错误，请重试');
          setLoading(false);
          return;
        }
        navigate('/workspace', { replace: true });
      }
    } catch (err: any) {
      setError(err.message || '登录失败，请重试');
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full bg-gradient-to-br from-violet-50 via-white to-blue-50 flex flex-col items-center justify-center px-4 py-8">
      <div className="w-full max-w-[400px]">
        {/* Logo & 产品名称 */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-violet-500 to-blue-500 flex items-center justify-center shadow-lg shadow-violet-200">
            <Sparkles className="w-7 h-7 text-white" />
          </div>
          <h1 className="mt-4 text-2xl font-semibold text-text-primary tracking-tight">
            AgentFlow
          </h1>
          <p className="mt-1 text-sm text-text-secondary">
            {isFirstTime ? '首次使用，请设置管理员账号' : '登录以继续到你的工作台'}
          </p>
        </div>

        {/* 首次设置提示 */}
        {isFirstTime && (
          <div className="mb-4 rounded-lg bg-blue-50 border border-blue-200 px-4 py-3 flex items-start gap-2">
            <ShieldCheck className="w-5 h-5 text-blue-500 shrink-0 mt-0.5" />
            <div className="text-sm text-blue-700">
              <p className="font-medium">安全提示</p>
              <p className="mt-0.5 text-blue-600">这是首次登录，请创建管理员账号。密码将以哈希形式存储，不会以明文保存。</p>
            </div>
          </div>
        )}

        {/* 登录卡片 */}
        <div className="bg-white rounded-2xl shadow-xl border border-border p-6 sm:p-8">
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* 用户名 */}
            <div className="space-y-1.5">
              <label htmlFor="username" className="block text-sm font-medium text-text-primary">
                {isFirstTime ? '管理员用户名' : '用户名'}
              </label>
              <div className="relative">
                <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-text-tertiary pointer-events-none">
                  <User className="w-4 h-4" />
                </span>
                <input
                  id="username"
                  type="text"
                  autoComplete="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder={isFirstTime ? '设置管理员用户名' : '请输入用户名'}
                  className="w-full pl-9 pr-3 py-2.5 text-sm text-text-primary placeholder:text-text-tertiary bg-bg-secondary border border-border rounded-lg outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/20 focus:bg-white"
                />
              </div>
            </div>

            {/* 密码 */}
            <div className="space-y-1.5">
              <label htmlFor="password" className="block text-sm font-medium text-text-primary">
                {isFirstTime ? '设置密码（至少 6 位）' : '密码'}
              </label>
              <div className="relative">
                <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-text-tertiary pointer-events-none">
                  <Lock className="w-4 h-4" />
                </span>
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete={isFirstTime ? 'new-password' : 'current-password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={isFirstTime ? '设置安全密码' : '请输入密码'}
                  className="w-full pl-9 pr-10 py-2.5 text-sm text-text-primary placeholder:text-text-tertiary bg-bg-secondary border border-border rounded-lg outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/20 focus:bg-white"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  tabIndex={-1}
                  aria-label={showPassword ? '隐藏密码' : '显示密码'}
                  className="absolute inset-y-0 right-0 flex items-center pr-3 text-text-tertiary hover:text-text-secondary transition-colors"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* 错误提示 */}
            {error && (
              <div className="rounded-lg bg-error-light border border-error/20 px-3 py-2.5 text-sm text-error">
                {error}
              </div>
            )}

            {/* 登录按钮 */}
            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 bg-accent hover:bg-accent-hover disabled:opacity-60 disabled:cursor-not-allowed text-white text-sm font-medium py-2.5 rounded-lg transition-colors"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {isFirstTime ? '创建中...' : '登录中...'}
                </>
              ) : (
                <>
                  {isFirstTime ? <ShieldCheck className="w-4 h-4" /> : <LogIn className="w-4 h-4" />}
                  {isFirstTime ? '创建管理员' : '登录'}
                </>
              )}
            </button>
          </form>
        </div>

        {/* 版权信息 */}
        <p className="mt-8 text-center text-xs text-text-tertiary">
          © 2024 AgentFlow
        </p>
      </div>
    </div>
  );
}
