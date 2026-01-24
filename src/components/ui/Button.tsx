import React from 'react';
import { Loader2 } from 'lucide-react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    /** Button visual variant */
    variant?: 'primary' | 'secondary' | 'danger' | 'ghost' | 'outline';
    /** Button size */
    size?: 'sm' | 'md' | 'lg';
    /** Show loading spinner */
    loading?: boolean;
    /** Icon to display before text */
    icon?: React.ReactNode;
    /** Icon to display after text */
    iconRight?: React.ReactNode;
    /** Make button full width */
    fullWidth?: boolean;
}

const variantClasses = {
    primary: 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm',
    secondary: 'bg-slate-100 hover:bg-slate-200 text-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-200',
    danger: 'bg-red-600 hover:bg-red-700 text-white shadow-sm',
    ghost: 'hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300',
    outline: 'border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200'
};

const sizeClasses = {
    sm: 'px-2.5 py-1.5 text-xs gap-1.5',
    md: 'px-4 py-2 text-sm gap-2',
    lg: 'px-6 py-3 text-base gap-2'
};

/**
 * Button - Standard button component with variants and loading state.
 * 
 * @example
 * ```tsx
 * <Button variant="primary" icon={<Plus size={16} />} loading={isSubmitting}>
 *   Create New
 * </Button>
 * ```
 */
export const Button: React.FC<ButtonProps> = ({
    children,
    variant = 'primary',
    size = 'md',
    loading = false,
    icon,
    iconRight,
    fullWidth = false,
    disabled,
    className = '',
    ...props
}) => {
    const isDisabled = disabled || loading;

    return (
        <button
            disabled={isDisabled}
            className={`
                inline-flex items-center justify-center
                font-medium rounded-lg
                transition-colors duration-150
                focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 dark:focus:ring-offset-slate-900
                disabled:opacity-50 disabled:cursor-not-allowed
                ${variantClasses[variant]}
                ${sizeClasses[size]}
                ${fullWidth ? 'w-full' : ''}
                ${className}
            `.trim().replace(/\s+/g, ' ')}
            {...props}
        >
            {loading ? (
                <Loader2 className="animate-spin" size={size === 'sm' ? 14 : size === 'lg' ? 20 : 16} />
            ) : icon ? (
                icon
            ) : null}

            {children}

            {iconRight && !loading && iconRight}
        </button>
    );
};

export default Button;
