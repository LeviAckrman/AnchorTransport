import React from 'react';

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  badge?: React.ReactNode;
  actions?: React.ReactNode;
  breadcrumbs?: { label: string; onClick?: () => void }[];
}

export const PageHeader: React.FC<PageHeaderProps> = ({
  title,
  subtitle,
  badge,
  actions,
  breadcrumbs,
}) => {
  return (
    <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
      <div>
        {breadcrumbs && breadcrumbs.length > 0 && (
          <nav className="flex items-center gap-1.5 text-xs text-slate-600 mb-1">
            {breadcrumbs.map((crumb, idx) => (
              <React.Fragment key={idx}>
                {idx > 0 && <span className="text-slate-500">/</span>}
                {crumb.onClick ? (
                  <button
                    onClick={crumb.onClick}
                    className="hover:text-indigo-600 transition-colors cursor-pointer"
                  >
                    {crumb.label}
                  </button>
                ) : (
                  <span className="text-slate-800 font-medium">{crumb.label}</span>
                )}
              </React.Fragment>
            ))}
          </nav>
        )}
        <div className="flex items-center gap-2.5">
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900">{title}</h1>
          {badge}
        </div>
        {subtitle && <p className="text-xs sm:text-sm text-slate-600 mt-1">{subtitle}</p>}
      </div>

      {actions && <div className="flex items-center gap-2.5 flex-wrap shrink-0">{actions}</div>}
    </div>
  );
};
