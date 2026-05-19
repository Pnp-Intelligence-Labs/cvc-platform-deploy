import React from 'react';
import { Check, X, TrendingUp, TrendingDown } from 'lucide-react';

interface ScoreSuggestion {
  id: string;
  field_name: string;
  current_value: number;
  suggested_value: number;
  reason: string;
  created_at: string;
}

interface Props {
  suggestion: ScoreSuggestion;
  onAccept: (id: string) => void;
  onDismiss: (id: string) => void;
}

const fieldLabels: Record<string, string> = {
  score_composite: 'Composite Score',
  score_commercial: 'Commercial',
  score_technical: 'Technical',
  score_market_timing: 'Market Timing',
  score_partner_fit: 'Partner Fit',
  score_capital_eff: 'Capital Efficiency',
  score_irs: 'IRS',
  score_sri: 'SRI',
  score_tdf: 'TDF'
};

export const ScoreSuggestionCard: React.FC<Props> = ({ suggestion, onAccept, onDismiss }) => {
  const diff = suggestion.suggested_value - suggestion.current_value;
  const isPositive = diff > 0;

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-full ${isPositive ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
            {isPositive ? <TrendingUp size={18} /> : <TrendingDown size={18} />}
          </div>
          <div>
            <h4 className="font-semibold text-[#253B49] text-sm">
              {fieldLabels[suggestion.field_name] || suggestion.field_name}
            </h4>
            <p className="text-xs text-gray-500 mt-0.5">
              {suggestion.current_value} → {suggestion.suggested_value}
              <span className={`ml-2 font-semibold ${isPositive ? 'text-green-600' : 'text-red-600'}`}>
                ({diff > 0 ? '+' : ''}{diff.toFixed(1)})
              </span>
            </p>
          </div>
        </div>
      </div>
      
      <p className="text-sm text-gray-700 mb-4 bg-gray-50 p-3 rounded leading-relaxed">
        {suggestion.reason}
      </p>
      
      <div className="flex gap-2 justify-end">
        <button
          onClick={() => onDismiss(suggestion.id)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-md transition-colors"
        >
          <X size={14} />
          Dismiss
        </button>
        <button
          onClick={() => onAccept(suggestion.id)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-[#253B49] hover:bg-[#1a2d38] rounded-md transition-colors"
        >
          <Check size={14} />
          Accept
        </button>
      </div>
    </div>
  );
};
