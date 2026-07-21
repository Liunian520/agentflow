import { useState, useEffect, useRef } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Menu, LogOut, User as UserIcon } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useStore } from '../../store/useStore';

export function Layout() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const { currentUser, logout } = useStore();
  const userMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);

  // 点击外部关闭用户菜单
  useEffect(() => {
    if (!userMenuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [userMenuOpen]);

  const handleLogout = () => {
    logout();
    navigate('/login', { replace: true });
  };

  return (
    <div className="flex h-screen bg-bg-secondary overflow-hidden">
      <div className="hidden md:block">
        <Sidebar />
      </div>

      <div
        className={cn(
          'fixed inset-0 z-50 md:hidden transition-opacity duration-300',
          mobileMenuOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        )}
      >
        <div
          className="absolute inset-0 bg-black/50"
          onClick={() => setMobileMenuOpen(false)}
        />
        <div
          className={cn(
            'absolute left-0 top-0 h-full w-72 bg-white shadow-xl transition-transform duration-300',
            mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
          )}
        >
          <Sidebar />
        </div>
      </div>

      <main className="flex-1 flex flex-col overflow-hidden relative">
        <div className="md:hidden h-14 bg-white border-b border-border flex items-center px-4 flex-shrink-0">
          <button
            onClick={() => setMobileMenuOpen(true)}
            className="p-2 -ml-2 text-text-secondary hover:text-text-primary hover:bg-bg-hover rounded-md transition-colors"
          >
            <Menu className="w-5 h-5" />
          </button>
          <div className="flex-1 text-center">
            <span className="font-semibold text-text-primary">AgentFlow</span>
          </div>
          <div className="relative" ref={userMenuRef}>
            <button
              onClick={() => setUserMenuOpen(!userMenuOpen)}
              className="w-8 h-8 rounded-full bg-gradient-to-br from-violet-400 to-pink-400 flex items-center justify-center text-sm font-medium text-white"
            >
              {currentUser?.avatar || 'U'}
            </button>
            {userMenuOpen && (
              <div className="absolute right-0 top-10 bg-white rounded-lg shadow-xl border border-border py-1 min-w-[160px] z-50">
                <div className="px-4 py-2 border-b border-border">
                  <div className="text-sm font-medium text-text-primary">{currentUser?.username}</div>
                  <div className="text-xs text-text-tertiary">{currentUser?.role === 'admin' ? '超级管理员' : '用户'}</div>
                </div>
                <button
                  onClick={() => { setUserMenuOpen(false); navigate('/settings'); }}
                  className="w-full flex items-center gap-2 px-4 py-2 text-sm text-text-primary hover:bg-bg-secondary transition-colors"
                >
                  <UserIcon className="w-4 h-4" />
                  渠道设置
                </button>
                <button
                  onClick={handleLogout}
                  className="w-full flex items-center gap-2 px-4 py-2 text-sm text-red-500 hover:bg-red-50 transition-colors"
                >
                  <LogOut className="w-4 h-4" />
                  退出登录
                </button>
              </div>
            )}
          </div>
        </div>
        <div className="flex-1 overflow-hidden flex flex-col">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
