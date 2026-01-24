import React, { forwardRef } from 'react';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
    /** Label text */
    label?: string;
    /** Helper/hint text below input */
    hint?: string;
    /** Error message (shows error state) */
    error?: string;
    /** Icon to display on the left */
    icon?: React.ReactNode;
    /** Icon to display on the right */
    iconRight?: React.ReactNode;
    /** Full width mode */
    fullWidth?: boolean;
}

/**
 * Input - Standard input component with label and error states.
 * 
 * @example
 * ```tsx
 * <Input 
 *   label="Email" 
 *   type="email" 
 *   icon={<Mail size={16} />}
 *   error={errors.email}
 * />
 * ```
 */
export const Input = forwardRef<HTMLInputElement, InputProps>(({
    label,
    hint,
    error,
    icon,
    iconRight,
    fullWidth = true,
    className = '',
    id,
    ...props
}, ref) => {
    const inputId = id || `input-${Math.random().toString(36).substr(2, 9)}`;
    const hasError = Boolean(error);

    return (
        <div className={`${fullWidth ? 'w-full' : ''}`}>
            {label && (
                <label
                    htmlFor={inputId}
                    className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1"
                >
                    {label}
                </label>
            )}

            <div className="relative">
                {icon && (
                    <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">
                        {icon}
                    </div>
                )}

                <input
                    ref={ref}
                    id={inputId}
                    className={`
                        w-full p-2 
                        text-sm
                        bg-white dark:bg-slate-800
                        border rounded-lg
                        text-slate-900 dark:text-white
                        placeholder:text-slate-400 dark:placeholder:text-slate-500
                        transition-colors duration-150
                        focus:outline-none focus:ring-2 focus:ring-offset-0
                        disabled:opacity-50 disabled:cursor-not-allowed
                        ${hasError
                            ? 'border-red-500 focus:ring-red-500/20 focus:border-red-500'
                            : 'border-slate-300 dark:border-slate-700 focus:ring-indigo-500/20 focus:border-indigo-500'
                        }
                        ${icon ? 'pl-10' : ''}
                        ${iconRight ? 'pr-10' : ''}
                        ${className}
                    `.trim().replace(/\s+/g, ' ')}
                    aria-invalid={hasError}
                    aria-describedby={error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined}
                    {...props}
                />

                {iconRight && (
                    <div className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">
                        {iconRight}
                    </div>
                )}
            </div>

            {hint && !error && (
                <p id={`${inputId}-hint`} className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    {hint}
                </p>
            )}

            {error && (
                <p id={`${inputId}-error`} className="mt-1 text-xs text-red-600 dark:text-red-400">
                    {error}
                </p>
            )}
        </div>
    );
});

Input.displayName = 'Input';

export default Input;
