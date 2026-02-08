/**
 * Standardized Loading States
 *
 * Consistent loading UI components for the entire application.
 */

import React from 'react';
import { Loader2 } from 'lucide-react';

interface SpinnerProps {
    size?: 'sm' | 'md' | 'lg';
    className?: string;
}

const sizeClasses = {
    sm: 'h-4 w-4',
    md: 'h-6 w-6',
    lg: 'h-8 w-8'
};

/**
 * Simple spinner for inline loading
 */
export const Spinner: React.FC<SpinnerProps> = ({ size = 'md', className = '' }) => (
    <Loader2 className={`animate-spin text-indigo-600 ${sizeClasses[size]} ${className}`} />
);

interface LoadingOverlayProps {
    message?: string;
}

/**
 * Full-screen loading overlay
 */
export const LoadingOverlay: React.FC<LoadingOverlayProps> = ({ message = 'Carregando...' }) => (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-white/80 dark:bg-slate-950/80 backdrop-blur-sm">
        <div className="flex flex-col items-center gap-4">
            <Loader2 className="h-10 w-10 animate-spin text-indigo-600" />
            <p className="text-sm font-medium text-slate-600 dark:text-slate-400 animate-pulse">
                {message}
            </p>
        </div>
    </div>
);

interface LoadingCardProps {
    message?: string;
    className?: string;
}

/**
 * Loading state for cards/containers
 */
export const LoadingCard: React.FC<LoadingCardProps> = ({
    message = 'Carregando...',
    className = ''
}) => (
    <div className={`flex flex-col items-center justify-center p-8 ${className}`}>
        <Loader2 className="h-8 w-8 animate-spin text-indigo-600 mb-3" />
        <p className="text-sm text-slate-500 dark:text-slate-400">{message}</p>
    </div>
);

interface LoadingButtonProps {
    children: React.ReactNode;
    isLoading: boolean;
    loadingText?: string;
    disabled?: boolean;
    className?: string;
    onClick?: () => void;
    type?: 'button' | 'submit' | 'reset';
}

/**
 * Button with loading state
 */
export const LoadingButton: React.FC<LoadingButtonProps> = ({
    children,
    isLoading,
    loadingText = 'Aguarde...',
    disabled = false,
    className = '',
    onClick,
    type = 'button'
}) => (
    <button
        type={type}
        onClick={onClick}
        disabled={disabled || isLoading}
        className={`inline-flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed ${className}`}
    >
        {isLoading ? (
            <>
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>{loadingText}</span>
            </>
        ) : (
            children
        )}
    </button>
);

interface SkeletonProps {
    className?: string;
}

/**
 * Skeleton loading placeholder
 */
export const Skeleton: React.FC<SkeletonProps> = ({ className = '' }) => (
    <div className={`animate-pulse bg-slate-200 dark:bg-slate-700 rounded ${className}`} />
);

/**
 * Skeleton for text lines
 */
export const SkeletonText: React.FC<{ lines?: number; className?: string }> = ({
    lines = 3,
    className = ''
}) => (
    <div className={`space-y-2 ${className}`}>
        {Array.from({ length: lines }).map((_, i) => (
            <Skeleton
                key={i}
                className={`h-4 ${i === lines - 1 ? 'w-3/4' : 'w-full'}`}
            />
        ))}
    </div>
);

/**
 * Skeleton for cards
 */
export const SkeletonCard: React.FC<{ className?: string }> = ({ className = '' }) => (
    <div className={`p-4 border border-slate-200 dark:border-slate-700 rounded-lg ${className}`}>
        <div className="flex items-center gap-3 mb-4">
            <Skeleton className="h-10 w-10 rounded-full" />
            <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-1/3" />
                <Skeleton className="h-3 w-1/2" />
            </div>
        </div>
        <SkeletonText lines={2} />
    </div>
);

/**
 * Skeleton for table rows
 */
export const SkeletonTableRow: React.FC<{ columns?: number }> = ({ columns = 5 }) => (
    <tr className="animate-pulse">
        {Array.from({ length: columns }).map((_, i) => (
            <td key={i} className="px-4 py-3">
                <Skeleton className="h-4 w-full" />
            </td>
        ))}
    </tr>
);

interface EmptyStateProps {
    icon?: React.ReactNode;
    title: string;
    description?: string;
    action?: React.ReactNode;
}

/**
 * Empty state placeholder
 */
export const EmptyState: React.FC<EmptyStateProps> = ({
    icon,
    title,
    description,
    action
}) => (
    <div className="flex flex-col items-center justify-center p-8 text-center">
        {icon && (
            <div className="mb-4 text-slate-400 dark:text-slate-500">
                {icon}
            </div>
        )}
        <h3 className="text-lg font-semibold text-slate-700 dark:text-slate-300 mb-1">
            {title}
        </h3>
        {description && (
            <p className="text-sm text-slate-500 dark:text-slate-400 mb-4 max-w-sm">
                {description}
            </p>
        )}
        {action}
    </div>
);

interface ErrorStateProps {
    title?: string;
    message: string;
    onRetry?: () => void;
}

/**
 * Error state placeholder
 */
export const ErrorState: React.FC<ErrorStateProps> = ({
    title = 'Ocorreu um erro',
    message,
    onRetry
}) => (
    <div className="flex flex-col items-center justify-center p-8 text-center">
        <div className="mb-4 p-3 bg-red-100 dark:bg-red-900/30 rounded-full">
            <svg className="h-8 w-8 text-red-600 dark:text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
        </div>
        <h3 className="text-lg font-semibold text-slate-700 dark:text-slate-300 mb-1">
            {title}
        </h3>
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-4 max-w-sm">
            {message}
        </p>
        {onRetry && (
            <button
                onClick={onRetry}
                className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors"
            >
                Tentar novamente
            </button>
        )}
    </div>
);

export default {
    Spinner,
    LoadingOverlay,
    LoadingCard,
    LoadingButton,
    Skeleton,
    SkeletonText,
    SkeletonCard,
    SkeletonTableRow,
    EmptyState,
    ErrorState
};
