import React from 'react';
import { Loader2 } from 'lucide-react';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline' | 'danger' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
}

export const Button: React.FC<ButtonProps> = ({
  children,
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled,
  className = '',
  ...props
}) => {
  const baseClasses =
    'inline-flex items-center justify-center font-semibold rounded-xl transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500/20 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer shadow-xs';

  const sizeClasses = {
    sm: 'text-xs px-3 py-1.5 gap-1.5',
    md: 'text-xs sm:text-sm px-4 py-2 gap-2',
    lg: 'text-sm sm:text-base px-5 py-2.5 gap-2.5',
  }[size];

  const variantClasses = {
    primary: 'bg-indigo-600 hover:bg-indigo-700 text-white border border-transparent shadow-xs',
    secondary: 'bg-slate-900 hover:bg-slate-800 text-white border border-transparent shadow-xs',
    outline: 'bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 shadow-xs',
    danger: 'bg-rose-600 hover:bg-rose-700 text-white border border-transparent shadow-xs',
    ghost: 'bg-transparent hover:bg-slate-100 text-slate-700 shadow-none',
  }[variant];

  return (
    <button
      disabled={disabled || loading}
      className={`${baseClasses} ${sizeClasses} ${variantClasses} ${className}`}
      {...props}
    >
      {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
      {children}
    </button>
  );
};
