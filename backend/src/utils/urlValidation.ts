export function isValidExternalUrl(urlStr: string): boolean {
    try {
        const url = new URL(urlStr);
        if (!['http:', 'https:'].includes(url.protocol)) return false;
        const hostname = url.hostname.toLowerCase();
        if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0') return false;
        if (/^(10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.|169\.254\.|0\.)/.test(hostname)) return false;
        if (hostname.endsWith('.internal') || hostname.endsWith('.local')) return false;
        return true;
    } catch {
        return false;
    }
}
