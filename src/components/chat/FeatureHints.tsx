import { useState, useEffect } from 'react';
import { X, Puzzle, Brain, Bot, Workflow } from 'lucide-react';

/**
 * 渐进式能力提示
 *
 * 功能被使用后，在侧边栏轻量展示相关高级能力引导。
 * 提示规则：仅当用户实际使用过某功能后才展示关联提示，避免信息过载。
 * 使用 localStorage 跟踪功能使用情况与已关闭的提示。
 */

const STORAGE_KEY = 'lnagent_feature_usage';
const DISMISSED_KEY = 'lnagent_feature_hints_dismissed';

type FeatureKey = 'builtin_tool' | 'memory' | 'agent_created' | 'workflow_created';

interface HintDef {
  key: string;
  trigger: FeatureKey;
  icon: typeof Puzzle;
  iconBg: string;
  title: string;
  desc: string;
  action?: { label: string; href: string };
}

const hintDefs: HintDef[] = [
  {
    key: 'hint_mcp_after_tool',
    trigger: 'builtin_tool',
    icon: Puzzle,
    iconBg: 'bg-sky-100 text-sky-600',
    title: '扩展更多工具',
    desc: '已用过内置工具，可在插件市场接入 MCP 服务（GitHub、文件系统、数据库等）',
    action: { label: '前往插件市场', href: '/marketplace' },
  },
  {
    key: 'hint_memory_manage',
    trigger: 'memory',
    icon: Brain,
    iconBg: 'bg-violet-100 text-violet-600',
    title: '记忆已启用',
    desc: '偏好和决策会自动跨会话保留，展开左侧「记忆」面板可查看和管理',
  },
  {
    key: 'hint_workflow_after_agent',
    trigger: 'agent_created',
    icon: Workflow,
    iconBg: 'bg-emerald-100 text-emerald-600',
    title: '试试工作流编排',
    desc: '已创建 Agent，可在技能库中串联多个 Agent 节点，实现复杂任务自动化',
    action: { label: '打开技能库', href: '/workflows' },
  },
  {
    key: 'hint_orchestrator_after_workflow',
    trigger: 'workflow_created',
    icon: Bot,
    iconBg: 'bg-amber-100 text-amber-600',
    title: '多任务并行模式',
    desc: '已创建工作流，切换到 orchestrator 模式可让多个子任务并行执行',
  },
];

function readUsedFeatures(): Set<FeatureKey> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as FeatureKey[];
    return new Set(arr);
  } catch {
    return new Set();
  }
}

function readDismissed(): Set<string> {
  try {
    const raw = localStorage.getItem(DISMISSED_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as string[];
    return new Set(arr);
  } catch {
    return new Set();
  }
}

/** 标记某功能已被使用（供其他模块调用） */
export function trackFeatureUsed(feature: FeatureKey) {
  try {
    const set = readUsedFeatures();
    if (set.has(feature)) return;
    set.add(feature);
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...set]));
    // 触发事件，让正在挂载的 FeatureHints 刷新
    window.dispatchEvent(new Event('lnagent:feature-used'));
  } catch {
    // 静默失败
  }
}

export function FeatureHints() {
  const [usedFeatures, setUsedFeatures] = useState<Set<FeatureKey>>(() => readUsedFeatures());
  const [dismissed, setDismissed] = useState<Set<string>>(() => readDismissed());

  useEffect(() => {
    const refresh = () => {
      setUsedFeatures(readUsedFeatures());
    };
    window.addEventListener('lnagent:feature-used', refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener('lnagent:feature-used', refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);

  const handleDismiss = (key: string) => {
    const next = new Set(dismissed);
    next.add(key);
    setDismissed(next);
    try {
      localStorage.setItem(DISMISSED_KEY, JSON.stringify([...next]));
    } catch {
      // 静默失败
    }
  };

  // 筛选需要展示的提示：功能已使用 + 提示未被关闭
  const visibleHints = hintDefs.filter(
    (h) => usedFeatures.has(h.trigger) && !dismissed.has(h.key)
  );

  if (visibleHints.length === 0) return null;

  return (
    <div className="mt-4 px-3 space-y-2">
      <span className="text-xs font-medium text-text-tertiary uppercase tracking-wider">
        能力进阶
      </span>
      {visibleHints.map((hint) => {
        const Icon = hint.icon;
        return (
          <div
            key={hint.key}
            className="relative p-2.5 rounded-lg border border-border bg-gradient-to-br from-white to-slate-50/50 hover:shadow-sm transition-shadow"
          >
            <button
              onClick={() => handleDismiss(hint.key)}
              className="absolute top-1.5 right-1.5 p-0.5 rounded text-text-tertiary hover:text-text-primary hover:bg-bg-hover"
              title="不再提示"
            >
              <X className="w-3 h-3" />
            </button>
            <div className="flex items-start gap-2">
              <div className={`w-7 h-7 rounded-md flex items-center justify-center shrink-0 ${hint.iconBg}`}>
                <Icon className="w-3.5 h-3.5" />
              </div>
              <div className="flex-1 min-w-0 pr-3">
                <p className="text-xs font-medium text-text-primary mb-0.5">{hint.title}</p>
                <p className="text-[11px] text-text-secondary leading-snug">{hint.desc}</p>
                {hint.action && (
                  <a
                    href={hint.action.href}
                    className="inline-block mt-1 text-[11px] text-accent hover:underline"
                  >
                    {hint.action.label} →
                  </a>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
