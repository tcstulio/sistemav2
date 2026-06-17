/// <reference types="vite/client" />

declare module 'virtual:app-version' {
    export const APP_VERSION: string;
    export const GIT_HASH: string;
}

interface ImportMetaEnv {
    readonly PROD: boolean;
    readonly DEV: boolean;
    readonly MODE: string;
    readonly BASE_URL: string;
    readonly VITE_API_URL?: string;
    readonly VITE_SENTRY_DSN?: string;
    readonly VITE_APP_VERSION?: string;
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}
