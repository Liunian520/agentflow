import { HelpCircle, ArrowRight } from 'lucide-react';
import { cn } from '../../../lib/utils';

interface ClarificationProps {
  message: string;
  suggestions: string[];
  onSelect: (suggestion: string) => void;
  className?: string;
}

export function Clarification({ message, suggestions, onSelect, className }: ClarificationProps) {
  return (
    <div className={cn(
      'bg-blue-50 border border-blue-200 rounded-xl p-4 shadow-sm',
      className
    )}>
      <div className="flex items-start gap-3 mb-3">
        <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center flex-shrink-0">
          <HelpCircle className="w-4 h-4 text-blue-600" />
        </div>
        <div className="text-blue-800 text-sm">{message}</div>
      </div>

      {suggestions.length > 0 && (
        <div className="space-y-2">
          {suggestions.map((suggestion, idx) => (
            <button
              key={idx}
              onClick={() => onSelect(suggestion)}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-blue-700 bg-white hover:bg-blue-50 rounded-md transition-colors active:scale-[0.98] border border-blue-100"
            >
              <ArrowRight className="w-3.5 h-3.5 text-blue-400" />
              {suggestion}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
