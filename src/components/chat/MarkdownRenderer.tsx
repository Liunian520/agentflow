/**
 * Markdown 渲染 — 对标所有成熟产品的 Markdown + 代码块
 * 替代纯文本 whitespace-pre-wrap，支持代码高亮、加粗、链接等
 */

import { Copy, Check } from 'lucide-react';
import { useState } from 'react';
import { cn } from '../../lib/utils';

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

export function MarkdownRenderer({ content, className }: MarkdownRendererProps) {
  const lines = content.split('\n');

  return (
    <div className={cn('text-sm leading-relaxed', className)}>
      {lines.map((line, idx) => {
        // 代码块检测
        if (line.startsWith('```')) {
          const lang = line.slice(3).trim();
          // 收集代码块内容直到遇到结束 ```
          const codeLines: string[] = [];
          let endIdx = idx + 1;
          while (endIdx < lines.length && !lines[endIdx].startsWith('```')) {
            codeLines.push(lines[endIdx]);
            endIdx++;
          }
          if (endIdx < lines.length) {
            return <CodeBlock key={idx} language={lang} code={codeLines.join('\n')} />;
          }
          return null;
        }

        // 在代码块内跳过
        let inCodeBlock = false;
        for (let i = idx - 1; i >= 0; i--) {
          if (lines[i].startsWith('```')) {
            inCodeBlock = true;
            break;
          }
          if (lines[i].startsWith('```') && i < idx) {
            inCodeBlock = false;
            break;
          }
        }
        if (inCodeBlock) return null;

        // 渲染单行 Markdown
        return <MarkdownLine key={idx} line={line} />;
      })}
    </div>
  );
}

function MarkdownLine({ line }: { line: string }) {
  if (!line.trim()) return <div className="h-2" />;

  // 标题
  if (line.startsWith('### ')) {
    return <h3 className="font-semibold text-text-primary mt-2 mb-1">{renderInline(line.slice(4))}</h3>;
  }
  if (line.startsWith('## ')) {
    return <h2 className="font-semibold text-text-primary text-base mt-3 mb-1">{renderInline(line.slice(3))}</h2>;
  }

  // 列表项
  if (line.match(/^- /) || line.match(/^\* /)) {
    return <div className="flex items-start gap-2 my-0.5"><span className="text-accent mt-0.5">•</span><span className="flex-1">{renderInline(line.slice(2))}</span></div>;
  }
  if (line.match(/^\d+\. /)) {
    const num = line.match(/^(\d+)\. /)?.[1] || '1';
    return <div className="flex items-start gap-2 my-0.5"><span className="text-accent font-medium mt-0.5">{num}.</span><span className="flex-1">{renderInline(line.replace(/^\d+\. /, ''))}</span></div>;
  }

  // 普通文本
  return <div className="my-0.5">{renderInline(line)}</div>;
}

function renderInline(text: string): React.ReactNode {
  // 拆分处理 bold 和 code
  const parts: React.ReactNode[] = [];
  let remaining = text;
  let key = 0;

  while (remaining.length > 0) {
    // Bold: **text**
    const boldMatch = remaining.match(/\*\*(.+?)\*\*/);
    // Inline code: `text`
    const codeMatch = remaining.match(/`([^`]+)`/);

    let firstMatch = boldMatch || codeMatch;
    if (!firstMatch) {
      parts.push(remaining);
      break;
    }

    // 找最早的匹配
    if (boldMatch && codeMatch) {
      const boldIdx = remaining.indexOf('**');
      const codeIdx = remaining.indexOf('`');
      firstMatch = boldIdx < codeIdx ? boldMatch : codeMatch;
    }

    const matchIdx = remaining.indexOf(firstMatch[0]);
    if (matchIdx > 0) {
      parts.push(remaining.slice(0, matchIdx));
    }

    if (firstMatch === boldMatch) {
      parts.push(<strong key={key++} className="font-semibold text-text-primary">{boldMatch![1]}</strong>);
    } else {
      parts.push(
        <code key={key++} className="px-1.5 py-0.5 bg-bg-secondary text-accent rounded text-xs font-mono">
          {codeMatch![1]}
        </code>
      );
    }

    remaining = remaining.slice(matchIdx + firstMatch[0].length);
  }

  return parts.length === 1 ? parts[0] : <span>{parts}</span>;
}

function CodeBlock({ language, code }: { language: string; code: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="my-2 bg-gray-900 rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1.5 bg-gray-800">
        <span className="text-xs text-gray-400 font-mono">{language || 'code'}</span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 px-2 py-0.5 text-xs text-gray-400 hover:text-gray-200 rounded transition-colors"
        >
          {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
          {copied ? '已复制' : '复制'}
        </button>
      </div>
      <pre className="px-3 py-3 text-sm font-mono text-gray-100 overflow-x-auto">
        <code>{code}</code>
      </pre>
    </div>
  );
}
