/**
 * ACRouter 路由仪表盘 — "越用越准"可视化
 *
 * 展示：
 * 1. 路由池（当前可用模型列表）
 * 2. 各模型×类别的统计卡片（样本数/胜率/均延迟/均成本/均分）
 * 3. 近期决策列表（最近 20 条 RouterRecord）
 * 4. 越用越准趋势图（样本量 vs 平均分数）
 * 5. ε 探索率指示
 */

import { useMemo } from 'react';
import { BarChart3, TrendingUp, Clock, Zap, Trash2, Info } from 'lucide-react';
import { useStore } from '../../../store/useStore';
import { getRouterStats } from '../../../lib/modelRouter';
import type { RouterRecord, ModelPerfStats, RouterCategory } from '../../../types';
import { cn } from '../../../lib/utils';

// ===== 类别中文映射 =====
const CATEGORY_LABEL: Record<RouterCategory, string> = {
  code: '代码',
  orchestration: '编排',
  multilingual: '多语言',
  creative: '创意',
  reasoning: '推理',
  chat: '闲聊',
  extraction: '提取',
  recall_select: '召回',
  dream_consolidation: '整合',
};

// ===== outcome 标签 =====
const OUTCOME_TAG: Record<string, { label: string; color: string }> = {
  success: { label: '成功', color: 'text-green-600 bg-green-50' },
  partial: { label: '部分', color: 'text-yellow-600 bg-yellow-50' },
  failure: { label: '失败', color: 'text-red-600 bg-red-50' },
};

interface RouterDashboardProps {
  className?: string;
}

export function RouterDashboard({ className }: RouterDashboardProps) {
  const routerMemory = useStore((s) => s.routerMemory);
  const channels = useStore((s) => s.channels);
  const clearRouterMemory = useStore((s) => s.clearRouterMemory);

  // 路由池
  const pool = useMemo(() => {
    const enabledChannels = channels.filter((c) => c.enabled && c.apiKey);
    const entries: { provider: string; modelName: string; displayName: string }[] = [];
    const seen = new Set<string>();
    for (const channel of enabledChannels) {
      for (const model of channel.models) {
        const key = `${channel.provider}:${model.name}`;
        if (seen.has(key)) continue;
        seen.add(key);
        entries.push({
          provider: channel.provider,
          modelName: model.name,
          displayName: model.displayName || model.name,
        });
      }
    }
    return entries;
  }, [channels]);

  // 聚合统计
  const stats = useMemo(() => getRouterStats(routerMemory), [routerMemory]);

  // 近期决策（最近 20 条）
  const recentRecords = useMemo(() => routerMemory.slice(-20).reverse(), [routerMemory]);

  // 趋势数据：按时间窗口（每 10 条）计算平均分
  const trend = useMemo(() => {
    if (routerMemory.length < 2) return [];
    const windowSize = Math.max(5, Math.ceil(routerMemory.length / 10));
    const points: { batch: number; avgScore: number; samples: number }[] = [];
    for (let i = 0; i < routerMemory.length; i += windowSize) {
      const batch = routerMemory.slice(i, i + windowSize);
      const avg = batch.reduce((s, r) => s + r.score, 0) / batch.length;
      points.push({ batch: i + batch.length, avgScore: avg, samples: i + batch.length });
    }
    return points;
  }, [routerMemory]);

  // ε 探索率
  const epsilon = useMemo(() => {
    const total = routerMemory.length;
    return 0.1 * (1 - Math.min(total / 200, 0.8));
  }, [routerMemory]);

  // 探索占比
  const exploreCount = useMemo(
    () => routerMemory.filter((r) => r.score < 0.3 || r.outcome === 'failure').length,
    [routerMemory],
  );

  // 总样本数
  const totalSamples = routerMemory.length;

  // ===== 渲染 =====

  return (
    <div className={cn('space-y-4', className)}>
      {/* ===== 标题栏 ===== */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-5 h-5 text-accent" />
          <h2 className="text-lg font-semibold text-text-primary">ACRouter 路由仪表盘</h2>
          <span className="text-xs text-text-tertiary">越用越准 · 自进化模型路由</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-text-tertiary">
            {totalSamples} 条记录 · ε={epsilon.toFixed(3)}
          </span>
          {totalSamples > 0 && (
            <button
              onClick={clearRouterMemory}
              className="flex items-center gap-1 px-2 py-1 text-xs text-red-500 hover:bg-red-50 rounded-md transition-colors"
              title="清除所有路由记录（重置路由经验）"
            >
              <Trash2 className="w-3 h-3" />
              重置
            </button>
          )}
        </div>
      </div>

      {/* ===== 路由池概览 ===== */}
      <div className="bg-white border border-border rounded-xl p-3">
        <div className="flex items-center gap-2 mb-2">
          <Zap className="w-4 h-4 text-accent" />
          <span className="text-sm font-medium text-text-primary">路由池 · 可用模型</span>
          <span className="text-xs text-text-tertiary">{pool.length} 个候选</span>
        </div>
        {pool.length === 0 ? (
          <div className="text-sm text-text-tertiary py-2">
            未配置渠道 — 请在「设置」中添加 LLM 渠道和 API Key
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {pool.map((entry) => (
              <div
                key={`${entry.provider}:${entry.modelName}`}
                className="flex items-center gap-1.5 px-2.5 py-1.5 bg-accent-bg text-accent text-xs rounded-lg font-medium"
              >
                <span className="opacity-60">{entry.provider}</span>
                <span className="font-semibold">{entry.displayName}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ===== 越用越准趋势 ===== */}
      {trend.length > 1 && (
        <div className="bg-white border border-border rounded-xl p-3">
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp className="w-4 h-4 text-green-500" />
            <span className="text-sm font-medium text-text-primary">越用越准趋势</span>
          </div>
          <div className="flex items-end gap-1 h-20">
            {trend.map((pt, idx) => {
              const barH = Math.max(8, pt.avgScore * 80);
              const isLast = idx === trend.length - 1;
              const prevScore = idx > 0 ? trend[idx - 1].avgScore : pt.avgScore;
              const improved = pt.avgScore >= prevScore;
              return (
                <div key={idx} className="flex flex-col items-center gap-0.5 flex-1 min-w-[24px]">
                  <span className="text-xs text-text-tertiary">{pt.avgScore.toFixed(2)}</span>
                  <div
                    className={cn(
                      'w-full rounded-t-md transition-all duration-300',
                      isLast ? 'bg-accent' : improved ? 'bg-green-400' : 'bg-yellow-400',
                    )}
                    style={{ height: `${barH}px` }}
                  />
                  <span className="text-xs text-text-tertiary">{pt.samples}</span>
                </div>
              );
            })}
          </div>
          <div className="mt-1 flex items-center gap-1 text-xs text-text-tertiary">
            <Info className="w-3 h-3" />
            横轴=累积样本量 · 纵轴=平均路由评分 · 绿色=分数提升 · 黄色=回落
          </div>
        </div>
      )}

      {/* ===== 各模型统计卡片 ===== */}
      {stats.length > 0 && (
        <div className="bg-white border border-border rounded-xl p-3">
          <div className="flex items-center gap-2 mb-2">
            <BarChart3 className="w-4 h-4 text-violet-500" />
            <span className="text-sm font-medium text-text-primary">模型×类别统计</span>
            <span className="text-xs text-text-tertiary">{stats.length} 组</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {stats
              .sort((a, b) => b.samples - a.samples)
              .map((st) => (
                <ModelStatCard key={`${st.modelKey}::${st.category}`} stats={st} />
              ))}
          </div>
        </div>
      )}

      {/* ===== ε-greedy 探索率指示 ===== */}
      {totalSamples > 0 && (
        <div className="bg-white border border-border rounded-xl p-3">
          <div className="flex items-center gap-2 mb-2">
            <Zap className="w-4 h-4 text-orange-500" />
            <span className="text-sm font-medium text-text-primary">探索策略</span>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <div className="flex items-center justify-between text-xs text-text-tertiary mb-1">
                <span>ε 探索率</span>
                <span>{epsilon.toFixed(3)}（{(epsilon * 100).toFixed(1)}% 概率选非最优）</span>
              </div>
              <div className="w-full h-3 bg-bg-secondary rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-orange-400 to-yellow-400 rounded-full transition-all duration-500"
                  style={{ width: `${Math.min(epsilon * 100 * 10, 100)}%` }}
                />
              </div>
            </div>
            <div className="text-xs text-text-tertiary">
              <div>探索采集: {exploreCount} 条</div>
              <div>总样本: {totalSamples}</div>
            </div>
          </div>
          <div className="mt-1 text-xs text-text-tertiary">
            ε 随样本量衰减：ε = 0.1 × (1 − min(N/200, 0.8))，样本越多越少探索，更多依赖统计先验
          </div>
        </div>
      )}

      {/* ===== 近期决策列表 ===== */}
      {recentRecords.length > 0 && (
        <div className="bg-white border border-border rounded-xl p-3">
          <div className="flex items-center gap-2 mb-2">
            <Clock className="w-4 h-4 text-blue-500" />
            <span className="text-sm font-medium text-text-primary">近期决策</span>
            <span className="text-xs text-text-tertiary">最近 {recentRecords.length} 条</span>
          </div>
          <div className="space-y-1.5 max-h-60 overflow-y-auto">
            {recentRecords.map((r) => (
              <RecordRow key={r.id} record={r} />
            ))}
          </div>
        </div>
      )}

      {/* ===== 空态 ===== */}
      {totalSamples === 0 && (
        <div className="bg-white border border-border rounded-xl p-6 text-center">
          <BarChart3 className="w-10 h-10 text-text-tertiary mx-auto mb-3" />
          <div className="text-sm text-text-secondary mb-1">暂无路由记录</div>
          <div className="text-xs text-text-tertiary mb-3">
            开始对话后，每次 LLM 调用都会自动采集反馈信号并回写 Memory，路由会随使用逐渐变准
          </div>
          <div className="inline-flex items-center gap-1.5 text-xs text-text-tertiary bg-bg-secondary rounded-lg px-3 py-2">
            <span className="font-medium text-accent">Context</span>
            <span>→</span>
            <span className="font-medium text-violet-600">Action</span>
            <span>→</span>
            <span className="font-medium text-green-600">Feedback</span>
            <span>→ 回写 Memory → 越用越准</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ===== 模型统计卡片 =====

function ModelStatCard({ stats }: { stats: ModelPerfStats }) {
  const provider = stats.modelKey.split(':')[0] || '';
  const modelName = stats.modelKey.split(':').slice(1).join(':') || '';

  const scoreColor = stats.avgScore >= 0.7
    ? 'text-green-600'
    : stats.avgScore >= 0.4
      ? 'text-yellow-600'
      : 'text-red-600';

  const scoreBg = stats.avgScore >= 0.7
    ? 'bg-green-50'
    : stats.avgScore >= 0.4
      ? 'bg-yellow-50'
      : 'bg-red-50';

  return (
    <div className="border border-border rounded-lg p-2.5 hover:shadow-sm transition-shadow">
      <div className="flex items-center gap-1.5 mb-1.5">
        <span className="text-sm font-semibold text-text-primary truncate">{modelName}</span>
        <span className="text-xs text-text-tertiary">{provider}</span>
        <span className="px-1.5 py-0.5 text-xs bg-violet-50 text-violet-600 rounded-full font-medium">
          {CATEGORY_LABEL[stats.category]}
        </span>
      </div>
      <div className="flex items-center gap-3">
        <div className={cn('px-2 py-1 rounded-md text-sm font-bold', scoreColor, scoreBg)}>
          {stats.avgScore.toFixed(2)}
        </div>
        <div className="flex-1 grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs text-text-tertiary">
          <div>样本: <span className="text-text-secondary font-medium">{stats.samples}</span></div>
          <div>胜率: <span className={stats.successRate >= 0.7 ? 'text-green-600' : stats.successRate >= 0.4 ? 'text-yellow-600' : 'text-red-600'}>
            {(stats.successRate * 100).toFixed(0)}%
          </span></div>
          <div>延迟: <span className="text-text-secondary font-medium">{(stats.avgLatency / 1000).toFixed(1)}s</span></div>
          <div>成本: <span className="text-text-secondary font-medium">{Math.round(stats.avgCost)}tok</span></div>
        </div>
      </div>
    </div>
  );
}

// ===== 决策行 =====

function RecordRow({ record }: { record: RouterRecord }) {
  const tag = OUTCOME_TAG[record.outcome] || OUTCOME_TAG.failure;
  const timeStr = new Date(record.timestamp).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  return (
    <div className="flex items-center gap-2 py-1.5 px-2 bg-bg-secondary rounded-lg text-xs hover:bg-bg-hover transition-colors">
      <span className="text-text-tertiary w-14">{timeStr}</span>
      <span className={cn('px-1.5 py-0.5 rounded-full font-medium', tag.color)}>
        {tag.label}
      </span>
      <span className="font-medium text-text-primary truncate max-w-[140px]">
        {record.modelName}
      </span>
      <span className="px-1.5 py-0.5 bg-violet-50 text-violet-600 rounded-full text-xs">
        {CATEGORY_LABEL[record.taskFeatures.category]}
      </span>
      <span className="text-text-tertiary">{(record.latencyMs / 1000).toFixed(1)}s</span>
      <span className="text-text-tertiary">{Math.round(record.estTokens)}tok</span>
      <span className={cn(
        'font-bold ml-auto',
        record.score >= 0.7 ? 'text-green-600' : record.score >= 0.4 ? 'text-yellow-600' : 'text-red-600',
      )}>
        {record.score.toFixed(2)}
      </span>
    </div>
  );
}
