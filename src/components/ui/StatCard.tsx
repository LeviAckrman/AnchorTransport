import React from 'react';
import { LucideIcon } from 'lucide-react';

interface StatCardProps {
  title: string;
  value: string;
  subtitle?: string;
  icon: LucideIcon;
  trend?: {
    value: string;
    isPositive?: boolean;
    label?: string;
  };
  accentColor?: 'indigo' | 'emerald' | 'amber' | 'rose' | 'blue' | 'slate';
  badge?: React.ReactNode;
  onClick?: () => void;
}

export const StatCard: React.FC<StatCardProps> = ({
  title,
  value,
  subtitle,
  icon: Icon,
  trend,
  accentColor = 'indigo',
  badge,
  onClick,
}) => {
  const colorMap = {
    indigo: {
      bg: 'bg-indigo-50/70 text-indigo-700',
      border: 'hover:border-indigo-300',
    },
    emerald: {
      bg: 'bg-emerald-50/70 text-emerald-700',
      border: 'hover:border-emerald-300',
    },
    amber: {
      bg: 'bg-amber-50/70 text-amber-700',
      border: 'hover:border-amber-300',
    },
    rose: {
      bg: 'bg-rose-50/70 text-rose-700',
      border: 'hover:border-rose-300',
    },
    blue: {
      bg: 'bg-blue-50/70 text-blue-700',
      border: 'hover:border-blue-300',
    },
    slate: {
      bg: 'bg-slate-100 text-slate-700',
      border: 'hover:border-slate-300',
    },
  };

  const style = colorMap[accentColor];

  return (
    <div
      onClick={onClick}
      className={`bg-white rounded-xl border border-slate-200/90 p-5 shadow-xs transition-all ${
        onClick ? `cursor-pointer ${style.border} hover:shadow-md` : ''
      }`}
    >
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-700">{title}</p>
          <div className="flex items-baseline gap-2">
            <h3 className="text-2xl font-bold tracking-tight text-slate-900">{value}</h3>
            {badge}
          </div>
        </div>
        <div className={`p-2.5 rounded-lg ${style.bg}`}>
          <Icon className="w-5 h-5" />
        </div>
      </div>

      {(subtitle || trend) && (
        <div className="mt-3.5 pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
          {subtitle && <span className="text-slate-500 font-medium">{subtitle}</span>}
          {trend && (
            <div className="flex items-center gap-1 ml-auto">
              <span
                className={`font-semibold ${
                  trend.isPositive ? 'text-emerald-700' : 'text-rose-700'
                }`}
              >
                {trend.value}
              </span>
              {trend.label && <span className="text-slate-600">{trend.label}</span>}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
