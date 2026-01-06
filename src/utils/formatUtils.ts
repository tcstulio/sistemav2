import { formatDateLocal } from './dateUtils';

/**
 * Formats a number as a currency string (BRL/USD/EUR aware, default to current locale or fixed)
 * Currently defaults to locale string with $ prefix or similar if needed, or just locale.
 */
export const formatCurrency = (value: number | undefined | null, currency: string = 'USD'): string => {
    if (value === undefined || value === null) return '-';

    // Simple formatter for now, can be enhanced
    return new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'BRL' // Assuming BRL based on usage context (or use USD if explicit)
    }).format(value);
};

// Re-export or alias date formatting for convenience
export const formatDate = formatDateLocal;
