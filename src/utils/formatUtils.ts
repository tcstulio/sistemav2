import { formatDateLocal } from './dateUtils';

/**
 * Formats a number as a currency string (BRL/USD/EUR aware, default 'BRL').
 * Respects the `currency` argument (ISO 4217 code); null/undefined values
 * render as '-' instead of "R$ NaN".
 */
export const formatCurrency = (value: number | undefined | null, currency: string = 'BRL'): string => {
    if (value === undefined || value === null) return '-';

    try {
        return new Intl.NumberFormat('pt-BR', {
            style: 'currency',
            currency,
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
        }).format(value);
    } catch {
        return new Intl.NumberFormat('pt-BR', {
            style: 'currency',
            currency: 'BRL',
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
        }).format(value);
    }
};

// Re-export or alias date formatting for convenience
export const formatDate = formatDateLocal;
