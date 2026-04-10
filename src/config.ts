export const config = {
    get API_BASE_URL() {
        // [ANTIGRAVITY] Fix for Android/Capacitor
        // On mobile, window.location.origin is 'http://localhost' (the webview),
        // so relative paths fail. We must use the remote server URL.
        const isCapacitor = (window as any).Capacitor?.isNativePlatform();

        if (isCapacitor) {
            // Fallback to the known production domain
            // We derive it from the Dolibarr URL in env to avoid magic strings if possible,
            // or hardcode the known domain structure.
            // Dolibarr URL: https://sistema.coolgroove.com.br/api/index.php
            // Node Backend: https://sistema.coolgroove.com.br
            // [USER REQUEST] Use local IP for testing
            return import.meta.env.VITE_CAPACITOR_API_URL || 'http://192.168.191.210:3004';
        }

        // On Web, relative paths are fine (and preferred for proxying)
        return window.location.origin;
    },
    get WHATSAPP_API_URL() {
        return `${this.API_BASE_URL}/api/whatsapp`;
    },
    get SOCKET_URL() {
        return this.API_BASE_URL;
    }
};
