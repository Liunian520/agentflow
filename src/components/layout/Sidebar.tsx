import { useState, useEffect, useRef } from 'react';
import {
  Workflow,
  Bot,
  LayoutGrid,
  Puzzle,
  Settings,
  ChevronLeft,
  ChevronRight,
  Plus,
  Search,
  Sparkles,
  LogOut,
  Server,
  X,
} from 'lucide-react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useStore } from '../../store/useStore';
import { cn } from '../../lib/utils';

const navItems = [
  { to: '/', icon: LayoutGrid, label: '工作台' },
  { to: '/workflows', icon: Workflow, label: '工作流' },
  { to: '/agents', icon: Bot, label: 'Agent' },
  { to: '/hosts', icon: Server, label: '远程主机' },
  { to: '/marketplace', icon: Puzzle, label: '插件市场' },
  { to: '/settings', icon: Settings, label: '渠道设置' },
];

export function Sidebar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { sidebarCollapsed, toggleSidebar, workflows, currentUser, logout, channels } = useStore();
  const [showAllWorkflows, setShowAllWorkflows] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const userMenuRef = useRef<HTMLDivElement>(null);

  // 点击外部关闭用户菜单
  useEffect(() => {
    if (!showUserMenu) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setShowUserMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showUserMenu]);

  const displayedWorkflows = (showAllWorkflows ? workflows : workflows.slice(0, 5)).filter((w) =>
    w.name.toLowerCase().includes(searchQuery.toLowerCase())
  );
  const enabledChannels = channels.filter((c) => c.enabled).length;

  return (
    <div
      className={cn(
        'flex flex-col h-full bg-white border-r border-border transition-all duration-300',
        sidebarCollapsed ? 'w-16' : 'w-64 md:w-64'
      )}
    >
      <div className="flex items-center justify-between h-14 px-3 border-b border-border">
        {!sidebarCollapsed && (
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-accent flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <span className="font-semibold text-text-primary">AgentFlow</span>
          </div>
        )}
        {sidebarCollapsed && (
          <div className="w-8 h-8 rounded-lg bg-accent flex items-center justify-center mx-auto">
            <Sparkles className="w-5 h-5 text-white" />
          </div>
        )}
        <button
          onClick={toggleSidebar}
          className={cn(
            'p-1.5 rounded-md hover:bg-bg-hover text-text-secondary hover:text-text-primary transition-colors hidden md:flex',
            sidebarCollapsed && 'mx-auto'
          )}
        >
          {sidebarCollapsed ? (
            <ChevronRight className="w-4 h-4" />
          ) : (
            <ChevronLeft className="w-4 h-4" />
          )}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto py-3">
        <nav className="px-2 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive =
              item.to === '/'
                ? location.pathname === '/'
                : location.pathname.startsWith(item.to);
            return (
              <NavLink
                key={item.to}
                to={item.to}
                className={cn(
                  'flex items-center gap-3 px-3 py-2.5 sm:py-2 rounded-md text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-accent-bg text-accent'
                    : 'text-text-secondary hover:text-text-primary hover:bg-bg-hover',
                  sidebarCollapsed && 'justify-center'
                )}
              >
                <Icon className="w-5 h-5 flex-shrink-0" />
                {!sidebarCollapsed && <span>{item.label}</span>}
              </NavLink>
            );
          })}
        </nav>

        {!sidebarCollapsed && (
          <>
            <div className="mt-6 px-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-text-tertiary uppercase tracking-wider">
                  最近工作流
                </span>
                <button
                  onClick={() => navigate('/workflows?new=1')}
                  className="p-1.5 rounded hover:bg-bg-hover text-text-tertiary hover:text-text-primary transition-colors"
                  title="新建工作流"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>
              <div className="space-y-1">
                {displayedWorkflows.map((wf) => (
                  <NavLink
                    key={wf.id}
                    to={`/workflow/${wf.id}`}
                    className={cn(
                      'flex items-center gap-2 px-2 py-2 rounded-md text-sm transition-colors',
                      location.pathname === `/workflow/${wf.id}`
                        ? 'bg-accent-bg text-accent'
                        : 'text-text-secondary hover:text-text-primary hover:bg-bg-hover'
                    )}
                  >
                    <div
                      className="w-2 h-2 rounded-full flex-shrink-0"
                      style={{
                        backgroundColor:
                          wf.status === 'published'
                            ? '#10b981'
                            : wf.status === 'running'
                            ? '#3b82f6'
                            : wf.status === 'paused'
                            ? '#f59e0b'
                            : '#9ca3af',
                      }}
                    />
                    <span className="truncate">{wf.name}</span>
                  </NavLink>
                ))}
                {workflows.length > 5 && (
                  <button
                    onClick={() => setShowAllWorkflows(!showAllWorkflows)}
                    className="w-full text-left px-2 py-2 text-xs text-text-tertiary hover:text-text-secondary transition-colors"
                  >
                    {showAllWorkflows ? '收起' : `查看全部 (${workflows.length})`}
                  </button>
                )}
              </div>
            </div>

            <div className="mt-6 px-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-tertiary" />
                <input
                  type="text"
                  placeholder="搜索工作流..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-8 py-2 text-sm bg-bg-secondary border border-border rounded-md focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-bg-hover text-text-tertiary"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      <div className="border-t border-border p-3 relative" ref={userMenuRef}>
        <div
          className={cn(
            'flex items-center gap-3 p-2 rounded-md hover:bg-bg-hover cursor-pointer transition-colors',
            sidebarCollapsed && 'justify-center'
          )}
          onClick={() => !sidebarCollapsed && setShowUserMenu(!showUserMenu)}
        >
          <div className="w-9 h-9 rounded-full bg-gradient-to-br from-violet-400 to-pink-400 flex items-center justify-center text-white text-sm font-medium flex-shrink-0">
            {currentUser?.avatar || 'U'}
          </div>
          {!sidebarCollapsed && (
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-text-primary truncate">
                {currentUser?.username || '未登录'}
              </div>
              <div className="text-xs text-text-tertiary truncate">
                {currentUser?.role === 'admin' ? '超级管理员' : '用户'} · {enabledChannels} 个渠道
              </div>
            </div>
          )}
        </div>

        {showUserMenu && !sidebarCollapsed && (
          <div className="absolute bottom-16 left-3 right-3 bg-white rounded-lg shadow-xl border border-border py-1 z-50">
            <button
              onClick={() => { setShowUserMenu(false); navigate('/settings'); }}
              className="w-full flex items-center gap-2 px-4 py-2 text-sm text-text-primary hover:bg-bg-secondary transition-colors"
            >
              <Settings className="w-4 h-4" />
              渠道设置
            </button>
            <button
              onClick={() => {
                logout();
                navigate('/login', { replace: true });
              }}
              className="w-full flex items-center gap-2 px-4 py-2 text-sm text-red-500 hover:bg-red-50 transition-colors"
            >
              <LogOut className="w-4 h-4" />
              退出登录
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
