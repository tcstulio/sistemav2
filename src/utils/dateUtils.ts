/**
 * Date Utility Functions for Dolibarr Sync
 * 
 * Dolibarr returns all dates as Unix Timestamps (seconds).
 * However, we must treat them differently based on semnatics:
 * 
 * 1. Point-in-Time (e.g. Created At): Show in Local Time.
 * 2. Strict Date (e.g. Invoice Date): Show as Date Only (UTC-fixed) to avoid timezone shifts.
 */

// Formats a timestamp as DD/MM/YYYY HH:mm (Local Time)
// Use for: tms, date_creation, logs, events
export const formatDateTime = (timestamp: number | string | null | undefined): string => {
    if (!timestamp) return '-';

    let ts: number;
    if (typeof timestamp === 'string') {
        const parsed = Date.parse(timestamp);
        if (isNaN(parsed)) return '-';
        ts = parsed;
    } else {
        // Handle if timestamp is accidentally in ms (13 digits)
        ts = timestamp > 10000000000 ? timestamp : timestamp * 1000;
    }

    return new Date(ts).toLocaleString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
};

// Formats a timestamp as DD/MM/YYYY (Strict Date - UTC)
// Use for: Invoice Date, Order Date, Deadlines
// Forces UTC interpretation to prevent "previous day" errors
export const formatDateOnly = (timestamp: number | string | null | undefined): string => {
    if (!timestamp) return '-';

    let ts: number;
    if (typeof timestamp === 'string') {
        const parsed = Date.parse(timestamp);
        if (isNaN(parsed)) return '-';
        ts = parsed;
    } else {
        ts = timestamp > 10000000000 ? timestamp : timestamp * 1000;
    }

    const date = new Date(ts);

    // Use UTC methods to ensure we stick to the server's intended "Day"
    // This assumes the timestamp represents 00:00:00 UTC for that day
    return date.toLocaleDateString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        timeZone: 'UTC'
    });
};

// Formats a timestamp as DD/MM/YYYY (Local Time)
// Use for: Event grouping, Created At (when time is omitted), Last Message Date
// Respects the user's timezone (e.g. 22:00 stays 22:00 today, not 01:00 tomorrow)
export const formatDateLocal = (timestamp: number | string | null | undefined): string => {
    if (!timestamp) return '-';

    let ts: number;
    if (typeof timestamp === 'string') {
        const parsed = Date.parse(timestamp);
        if (isNaN(parsed)) return '-';
        ts = parsed;
    } else {
        ts = timestamp > 10000000000 ? timestamp : timestamp * 1000;
    }

    return new Date(ts).toLocaleDateString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
    });
};

// Formats a timestamp as Long Date (e.g. "Monday, 25 October 2023") - Local Time
export const formatDateLong = (timestamp: number | string | null | undefined): string => {
    if (!timestamp) return '-';

    let ts: number;
    if (typeof timestamp === 'string') {
        const parsed = Date.parse(timestamp);
        if (isNaN(parsed)) return '-';
        ts = parsed;
    } else {
        ts = timestamp > 10000000000 ? timestamp : timestamp * 1000;
    }

    return new Date(ts).toLocaleDateString('pt-BR', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });
};

// Returns a relative time string (e.g. "2 hours ago")
export const formatRelativeTime = (timestamp: number | string | null | undefined): string => {
    if (!timestamp) return '-';

    let ts: number;
    if (typeof timestamp === 'string') {
        const parsed = Date.parse(timestamp);
        if (isNaN(parsed)) return '-';
        ts = parsed;
    } else {
        ts = timestamp > 10000000000 ? timestamp : timestamp * 1000;
    }

    const now = Date.now();
    const diff = now - ts;

    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (minutes < 1) return 'Agora';
    if (minutes < 60) return `${minutes} min atrás`;
    if (hours < 24) return `${hours} h atrás`;
    if (days === 1) return 'Ontem';
    if (days < 7) return `${days} dias atrás`;

    return formatDateLocal(timestamp);
};

// Formats a timestamp as HH:mm (Time Only)
export const formatTime = (timestamp: number | string | null | undefined): string => {
    if (!timestamp) return '-';

    let ts: number;
    if (typeof timestamp === 'string') {
        const parsed = Date.parse(timestamp);
        if (isNaN(parsed)) return '-';
        ts = parsed;
    } else {
        ts = timestamp > 10000000000 ? timestamp : timestamp * 1000;
    }

    return new Date(ts).toLocaleTimeString('pt-BR', {
        hour: '2-digit',
        minute: '2-digit'
    });
};
