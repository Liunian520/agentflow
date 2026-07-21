import {
  Workflow,
  Play,
  Clock,
  TrendingUp,
  Zap,
  ArrowRight,
  Plus,
  Bot,
  Puzzle,
  Sparkles,
} from 'lucide-react';
import { useStore } from '../store/useStore';
import { formatDate, formatNumber, cn } from '../lib/utils';
import { useNavigate } from 'react-router-dom';

export function DashboardPage() {
  const navigate = useNavigate();
  const { workflows, agents, templates } = useStore();

  const totalRuns = workflows.reduce((sum, w) => sum + w.runs, 0);
  const publishedWorkflows = workflows.filter((w) => w.status === 'published').length;

  const stats = [
    {
      label: '工作流总数',
      value: workflows.length,
      icon: Workflow,
      change: '+12%',
      color: 'bg-violet-50 text-violet-600',
    },
    {
      label: '已发布',
      value: publishedWorkflows,
      icon: Zap,
      change: '+8%',
      color: 'bg-emerald-50 text-emerald-600',
    },
    {
      label: '总运行次数',
      value: formatNumber(totalRuns),
      icon: Play,
      change: '+25%',
      color: 'bg-blue-50 text-blue-600',
    },
    {
      label: 'Agent 数量',
      value: agents.length,
      icon: Bot,
      change: '+3',
      color: 'bg-amber-50 text-amber-600',
    },
  ];

  const quickActions = [
    {
      label: '创建新工作流',
      icon: Plus,
      color: 'bg-violet-50 text-violet-600',
      onClick: () => navigate('/workflows'),
    },
    {
      label: '管理 Agent',
      icon: Bot,
      color: 'bg-blue-50 text-blue-600',
      onClick: () => navigate('/agents'),
    },
    {
      label: '发现插件',
      icon: Puzzle,
      color: 'bg-emerald-50 text-emerald-600',
      onClick: () => navigate('/marketplace'),
    },
  ];

  return (
    <div className="flex-1 overflow-y-auto overflow-x-hidden">
      <div className="px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        <div className="mb-6 sm:mb-8">
          <h1 className="text-xl sm:text-2xl font-semibold text-text-primary mb-1 sm:mb-2">
            欢迎回来 👋
          </h1>
          <p className="text-sm sm:text-base text-text-secondary">
            今天要构建什么自动化工作流？
          </p>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6 sm:mb-8">
          {stats.map((stat, index) => {
            const Icon = stat.icon;
            return (
              <div
                key={index}
                className="bg-white rounded-xl border border-border p-3 sm:p-5 hover:shadow-md transition-shadow"
              >
                <div className="flex items-start justify-between mb-2 sm:mb-4">
                  <div className={cn('p-2 sm:p-2.5 rounded-lg', stat.color)}>
                    <Icon className="w-4 h-4 sm:w-5 sm:h-5" />
                  </div>
                  <span className="text-[10px] sm:text-xs font-medium text-emerald-600 bg-emerald-50 px-1.5 sm:px-2 py-0.5 sm:py-1 rounded-full">
                    {stat.change}
                  </span>
                </div>
                <div className="text-lg sm:text-2xl font-semibold text-text-primary mb-0.5 sm:mb-1">
                  {stat.value}
                </div>
                <div className="text-xs sm:text-sm text-text-secondary">{stat.label}</div>
              </div>
            );
          })}
        </div>

        <div className="space-y-4 sm:space-y-0 sm:grid sm:grid-cols-1 sm:lg:grid-cols-3 gap-6 mb-6 sm:mb-8">
          <div className="lg:col-span-2 order-2 sm:order-1">
            <div className="bg-white rounded-xl border border-border p-4 sm:p-6">
              <div className="flex items-center justify-between mb-4 sm:mb-6">
                <h2 className="text-base sm:text-lg font-semibold text-text-primary">
                  最近的工作流
                </h2>
                <button
                  onClick={() => navigate('/workflows')}
                  className="text-sm text-accent hover:text-accent-hover font-medium flex items-center gap-1"
                >
                  查看全部 <ArrowRight className="w-4 h-4" />
                </button>
              </div>
              <div className="space-y-2 sm:space-y-3">
                {workflows.slice(0, 4).map((wf) => (
                  <div
                    key={wf.id}
                    onClick={() => navigate(`/workflow/${wf.id}`)}
                    className="flex items-center gap-3 sm:gap-4 p-2.5 sm:p-3 rounded-lg hover:bg-bg-secondary cursor-pointer transition-colors group active:scale-[0.98]"
                  >
                    <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-lg bg-accent-bg flex items-center justify-center flex-shrink-0">
                      <Workflow className="w-4 h-4 sm:w-5 sm:h-5 text-accent" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-text-primary text-sm sm:text-base mb-0.5 truncate">
                        {wf.name}
                      </div>
                      <div className="text-xs sm:text-sm text-text-tertiary truncate">
                        {wf.description}
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0 hidden sm:block">
                      <div className="text-sm text-text-secondary mb-1">
                        {formatNumber(wf.runs)} 次运行
                      </div>
                      <div className="text-xs text-text-tertiary flex items-center gap-1 justify-end">
                        <Clock className="w-3 h-3" />
                        {formatDate(wf.updatedAt)}
                      </div>
                    </div>
                    <ArrowRight className="w-4 h-4 text-text-tertiary sm:hidden flex-shrink-0" />
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="space-y-4 sm:space-y-6 order-1 sm:order-2">
            <div className="bg-gradient-to-br from-accent to-violet-600 rounded-xl p-5 sm:p-6 text-white">
              <div className="flex items-center gap-2 mb-2 sm:mb-3">
                <Sparkles className="w-5 h-5" />
                <span className="font-medium text-sm sm:text-base">快速开始</span>
              </div>
              <h3 className="text-lg sm:text-xl font-semibold mb-1 sm:mb-2">从模板开始</h3>
              <p className="text-white/80 text-sm mb-3 sm:mb-4">
                使用预设模板快速创建你的第一个工作流
              </p>
              <button
                onClick={() => navigate('/marketplace')}
                className="w-full py-2.5 sm:py-2 bg-white/20 hover:bg-white/30 active:bg-white/40 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2 min-h-[44px]"
              >
                浏览模板 <ArrowRight className="w-4 h-4" />
              </button>
            </div>

            <div className="bg-white rounded-xl border border-border p-4 sm:p-6">
              <h3 className="text-base sm:text-lg font-semibold text-text-primary mb-3 sm:mb-4">
                快捷操作
              </h3>
              <div className="space-y-2">
                {quickActions.map((action, index) => {
                  const Icon = action.icon;
                  return (
                    <button
                      key={index}
                      onClick={action.onClick}
                      className="w-full flex items-center gap-3 p-2.5 sm:p-3 rounded-lg hover:bg-bg-secondary active:bg-bg-tertiary text-left transition-colors min-h-[48px]"
                    >
                      <div
                        className={cn(
                          'w-9 h-9 sm:w-10 sm:h-10 rounded-lg flex items-center justify-center flex-shrink-0',
                          action.color
                        )}
                      >
                        <Icon className="w-4 h-4 sm:w-5 sm:h-5" />
                      </div>
                      <span className="text-sm sm:text-base font-medium text-text-primary">
                        {action.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-4 sm:mb-6">
            <h2 className="text-base sm:text-lg font-semibold text-text-primary">热门模板</h2>
            <button
              onClick={() => navigate('/marketplace')}
              className="text-sm text-accent hover:text-accent-hover font-medium flex items-center gap-1"
            >
              查看更多 <ArrowRight className="w-4 h-4" />
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
            {templates.slice(0, 3).map((tpl) => (
              <div
                key={tpl.id}
                onClick={() => navigate('/marketplace')}
                className="bg-white rounded-xl border border-border overflow-hidden hover:shadow-lg transition-shadow cursor-pointer group active:scale-[0.98]"
              >
                <div className="aspect-video bg-bg-secondary relative overflow-hidden">
                  <img
                    src={tpl.thumbnail}
                    alt={tpl.name}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                  />
                  <div className="absolute top-2 sm:top-3 left-2 sm:left-3">
                    <span className="px-2 py-0.5 sm:py-1 bg-white/90 backdrop-blur-sm text-xs font-medium rounded-md text-text-secondary">
                      {tpl.category}
                    </span>
                  </div>
                </div>
                <div className="p-3 sm:p-4">
                  <h3 className="font-medium text-text-primary text-sm sm:text-base mb-0.5 sm:mb-1 truncate">
                    {tpl.name}
                  </h3>
                  <p className="text-xs sm:text-sm text-text-tertiary mb-2 sm:mb-3 line-clamp-2">
                    {tpl.description}
                  </p>
                  <div className="flex items-center justify-between text-xs text-text-tertiary">
                    <span>{tpl.nodes} 个节点</span>
                    <span className="flex items-center gap-1">
                      <TrendingUp className="w-3 h-3" />
                      {formatNumber(tpl.uses)}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
