export const config = {
    get API_BASE_URL() {
        // Use relative path to leverage Vite Proxy (avoids Mixed Content issues on HTTPS)
        // If needed for production build, we might need env vars, but for this setup:
        return window.location.origin; // e.g., https://localhost:3003
        // The Vite proxy will intercept /api calls and forward to http://localhost:3004
    },
    get WHATSAPP_API_URL() {
        // Before: http://host:3004/api/whatsapp
        // Now: https://host:3003/api/whatsapp (Proxied -> 3004)
        return `${this.API_BASE_URL}/api/whatsapp`;
    },
    get SOCKET_URL() {
        return this.API_BASE_URL;
    }
};
