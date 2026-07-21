import { useState } from 'react';
import {
  Search,
  Star,
  Download,
  Plus,
  Check,
  Filter,
  Grid3X3,
  List,
  Sparkles,
  TrendingUp,
  Clock,
} from 'lucide-react';
import { useStore } from '../store/useStore';
import { formatNumber, cn } from '../lib/utils';
import * as Icons from 'lucide-react';

const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  Globe: Icons.Globe,
  Code2: Icons.Code2,
  GitBranch: Icons.GitBranch,
  Mail: Icons.Mail,
  Database: Icons.Database,
  Image: Icons.Image,
  MessageSquare: Icons.MessageSquare,
  FileText: Icons.FileText,
};

export function MarketplacePage() {
  const { plugins, templates, togglePlugin } = useStore();
  const [activeTab, setActiveTab] = useState<'plugins' | 'templates'>('plugins');
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [selectedCategory, setSelectedCategory] = useState('all');

  const categories = ['all', '搜索', '开发', '数据', '创意', '办公', '通讯', '文档'];

  const currentItems = activeTab === 'plugins' ? plugins : templates;

  const filteredItems = currentItems.filter((item: any) => {
    const matchesSearch =
      item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.description.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory =
      selectedCategory === 'all' || item.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  const installedCount = plugins.filter((p) => p.installed).length;

  return (
    <div className="flex-1 flex flex-col overflow-hidden overflow-x-hidden">
      <div className="bg-gradient-to-r from-violet-600 to-purple-600 text-white px-4 py-6 sm:px-6 sm:py-10">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center gap-2 mb-2">
            <Sparkles className="w-5 h-5 sm:w-6 sm:h-6" />
            <h1 className="text-xl sm:text-2xl font-bold">插件市场</h1>
          </div>
          <p className="text-white/80 mb-4 sm:mb-6 text-sm sm:text-base">
            发现和安装插件，扩展你的工作流能力
          </p>
          <div className="w-full">
            <div className="w-full max-w-xl relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-white/60" />
              <input
                type="text"
                placeholder="搜索插件或模板..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-12 pr-4 min-h-[44px] bg-white/10 backdrop-blur-sm border border-white/20 rounded-xl text-white placeholder-white/50 focus:outline-none focus:border-white/40 transition-colors active:scale-[0.98]"
              />
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white border-b border-border px-4 sm:px-6">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-2">
          <div className="flex items-center gap-0.5 sm:gap-1">
            <button
              onClick={() => setActiveTab('plugins')}
              className={cn(
                'px-2 sm:px-4 py-2.5 sm:py-3 text-xs sm:text-sm font-medium border-b-2 transition-colors min-h-[44px] active:scale-[0.98]',
                activeTab === 'plugins'
                  ? 'border-accent text-accent'
                  : 'border-transparent text-text-secondary hover:text-text-primary'
              )}
            >
              插件 ({plugins.length})
            </button>
            <button
              onClick={() => setActiveTab('templates')}
              className={cn(
                'px-2 sm:px-4 py-2.5 sm:py-3 text-xs sm:text-sm font-medium border-b-2 transition-colors min-h-[44px] active:scale-[0.98]',
                activeTab === 'templates'
                  ? 'border-accent text-accent'
                  : 'border-transparent text-text-secondary hover:text-text-primary'
              )}
            >
              模板 ({templates.length})
            </button>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            <div className="flex items-center gap-1 bg-bg-secondary rounded-md p-1">
              <button
                onClick={() => setViewMode('grid')}
                className={cn(
                  'p-1.5 rounded transition-colors min-h-[32px] min-w-[32px] flex items-center justify-center active:scale-[0.98]',
                  viewMode === 'grid'
                    ? 'bg-white text-text-primary shadow-sm'
                    : 'text-text-tertiary hover:text-text-secondary'
                )}
              >
                <Grid3X3 className="w-4 h-4" />
              </button>
              <button
                onClick={() => setViewMode('list')}
                className={cn(
                  'p-1.5 rounded transition-colors min-h-[32px] min-w-[32px] flex items-center justify-center active:scale-[0.98]',
                  viewMode === 'list'
                    ? 'bg-white text-text-primary shadow-sm'
                    : 'text-text-tertiary hover:text-text-secondary'
                )}
              >
                <List className="w-4 h-4" />
              </button>
            </div>

            <div className="relative">
              <select
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
                className="appearance-none pl-9 pr-8 min-h-[44px] text-xs sm:text-sm border border-border rounded-md focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent bg-white active:scale-[0.98]"
              >
                {categories.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat === 'all' ? '全部分类' : cat}
                  </option>
                ))}
              </select>
              <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-tertiary pointer-events-none" />
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto bg-bg-secondary px-4 sm:px-6 py-4 sm:py-6">
        <div className="max-w-7xl mx-auto">
          {activeTab === 'plugins' && (
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4 mb-6 sm:mb-8">
              <div className="bg-white rounded-xl border border-border p-3 sm:p-4 flex items-center gap-3 sm:gap-4">
                <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-violet-50 flex items-center justify-center flex-shrink-0">
                  <PlugIcon className="w-5 h-5 sm:w-6 sm:h-6 text-violet-600" />
                </div>
                <div>
                  <div className="text-lg sm:text-2xl font-semibold text-text-primary">{plugins.length}</div>
                  <div className="text-xs sm:text-sm text-text-secondary">可用插件</div>
                </div>
              </div>
              <div className="bg-white rounded-xl border border-border p-3 sm:p-4 flex items-center gap-3 sm:gap-4">
                <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-emerald-50 flex items-center justify-center flex-shrink-0">
                  <Check className="w-5 h-5 sm:w-6 sm:h-6 text-emerald-600" />
                </div>
                <div>
                  <div className="text-lg sm:text-2xl font-semibold text-text-primary">{installedCount}</div>
                  <div className="text-xs sm:text-sm text-text-secondary">已安装</div>
                </div>
              </div>
              <div className="bg-white rounded-xl border border-border p-3 sm:p-4 flex items-center gap-3 sm:gap-4 col-span-2 lg:col-span-1">
                <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-blue-50 flex items-center justify-center flex-shrink-0">
                  <TrendingUp className="w-5 h-5 sm:w-6 sm:h-6 text-blue-600" />
                </div>
                <div>
                  <div className="text-lg sm:text-2xl font-semibold text-text-primary">
                    {formatNumber(plugins.reduce((sum, p) => sum + p.downloads, 0))}
                  </div>
                  <div className="text-xs sm:text-sm text-text-secondary">总下载量</div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'plugins' && viewMode === 'grid' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
              {filteredItems.map((plugin: any) => {
                const IconComponent = iconMap[plugin.icon] || Icons.Puzzle;
                return (
                  <div
                    key={plugin.id}
                    className="bg-white rounded-xl border border-border p-3 sm:p-5 hover:shadow-lg transition-all group active:scale-[0.98]"
                  >
                    <div className="flex items-start justify-between mb-3 sm:mb-4">
                      <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-violet-50 flex items-center justify-center group-hover:scale-110 transition-transform flex-shrink-0">
                        <IconComponent className="w-5 h-5 sm:w-6 sm:h-6 text-violet-600" />
                      </div>
                      <button
                        onClick={() => togglePlugin(plugin.id)}
                        className={cn(
                          'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs sm:text-sm font-medium transition-colors min-h-[36px] sm:min-h-[44px] active:scale-[0.98]',
                          plugin.installed
                            ? 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100'
                            : 'bg-accent text-white hover:bg-accent-hover'
                        )}
                      >
                        {plugin.installed ? (
                          <>
                            <Check className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                            已安装
                          </>
                        ) : (
                          <>
                            <Plus className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                            安装
                          </>
                        )}
                      </button>
                    </div>

                    <h3 className="font-semibold text-text-primary mb-1 text-sm sm:text-base">{plugin.name}</h3>
                    <p className="text-xs sm:text-sm text-text-secondary mb-3 sm:mb-4 line-clamp-2">
                      {plugin.description}
                    </p>

                    <div className="flex items-center justify-between text-xs text-text-tertiary pt-2 sm:pt-3 border-t border-border">
                      <div className="flex items-center gap-2 sm:gap-3">
                        <span className="flex items-center gap-1">
                          <Download className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                          {formatNumber(plugin.downloads)}
                        </span>
                        <span className="flex items-center gap-1">
                          <Star className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-amber-500" />
                          {plugin.stars}
                        </span>
                      </div>
                      <span>v{plugin.version}</span>
                    </div>

                    <div className="flex flex-wrap gap-1 sm:gap-1.5 mt-2 sm:mt-3">
                      {plugin.tags.slice(0, 3).map((tag: string) => (
                        <span
                          key={tag}
                          className="px-2 py-0.5 bg-bg-secondary text-text-tertiary text-xs rounded-md"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {activeTab === 'templates' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
              {filteredItems.map((template: any) => (
                <div
                  key={template.id}
                  className="bg-white rounded-xl border border-border overflow-hidden hover:shadow-lg transition-all cursor-pointer group active:scale-[0.98]"
                >
                  <div className="aspect-video bg-bg-secondary relative overflow-hidden">
                    <img
                      src={template.thumbnail}
                      alt={template.name}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    />
                    <div className="absolute top-2 sm:top-3 left-2 sm:left-3">
                      <span className="px-2 py-1 bg-white/90 backdrop-blur-sm text-xs font-medium rounded-md text-text-secondary">
                        {template.category}
                      </span>
                    </div>
                  </div>
                  <div className="p-3 sm:p-4">
                    <h3 className="font-semibold text-text-primary mb-1 text-sm sm:text-base group-hover:text-accent transition-colors">
                      {template.name}
                    </h3>
                    <p className="text-xs sm:text-sm text-text-tertiary mb-2 sm:mb-3 line-clamp-2">
                      {template.description}
                    </p>
                    <div className="flex items-center justify-between text-xs text-text-tertiary">
                      <div className="flex items-center gap-2 sm:gap-3">
                        <span>{template.nodes} 个节点</span>
                        <span className="flex items-center gap-1">
                          <TrendingUp className="w-3 h-3" />
                          {formatNumber(template.uses)}
                        </span>
                      </div>
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        5 分钟
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1 sm:gap-1.5 mt-2 sm:mt-3">
                      {template.tags.slice(0, 3).map((tag: string) => (
                        <span
                          key={tag}
                          className="px-2 py-0.5 bg-bg-secondary text-text-tertiary text-xs rounded-md"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function PlugIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M9 2v6" />
      <path d="M15 2v6" />
      <path d="M6 8h12v5a6 6 0 0 1-12 0V8z" />
      <path d="M12 19v3" />
    </svg>
  );
}
