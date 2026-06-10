/// <reference types="vite/client" />

declare const __APP_VERSION__: string;
declare const __GIT_HASH__: string;

interface ImportMetaEnv {
    readonly PROD: boolean;
    readonly DEV: boolean;
    readonly MODE: string;
    readonly BASE_URL: string;
    readonly VITE_API_URL?: string;
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}
