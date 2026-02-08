/**
 * Banking API Base Service
 * 
 * Abstract base class for banking integrations.
 * Provides common functionality for:
 * - mTLS certificate handling
 * - OAuth2 authentication with token caching
 * - HTTP client setup
 * - Error handling
 * 
 * Banks should extend this class and implement abstract methods.
 */

import https from 'https';
import fs from 'fs';
import path from 'path';
import axios, { AxiosInstance, AxiosError } from 'axios';
import { logger } from '../../utils/logger';

const log = logger.child('BankingApiBase');

// ============ Common Types ============

/** Common balance interface */
export interface BankBalance {
    available: number;
    blocked?: number;
    limit?: number;
    total: number;
}

/** Common transaction interface */
export interface BankTransaction {
    id: string;
    date: Date;
    description: string;
    amount: number;
    type: 'credit' | 'debit';
    category?: string;
    counterparty?: string;
    raw?: any;
}

/** Common statement interface */
export interface BankStatement {
    startDate: Date;
    endDate: Date;
    openingBalance: number;
    closingBalance: number;
    transactions: BankTransaction[];
}

/** Common Pix charge request */
export interface PixChargeRequest {
    chave: string;
    valor: number;
    descricao?: string;
    expiracao?: number; // seconds
    devedorCpf?: string;
    devedorNome?: string;
}

/** Common Pix charge response */
export interface PixChargeResponse {
    txid: string;
    status: string;
    qrCode?: string;
    qrCodeBase64?: string;
    pixCopiaECola?: string;
    location?: string;
    valor: number;
    criacao: Date;
    expiracao?: Date;
}

/** Common boleto request */
export interface BoletoRequest {
    valor: number;
    vencimento: string; // YYYY-MM-DD
    pagadorCpfCnpj: string;
    pagadorNome: string;
    pagadorEndereco?: string;
    pagadorCidade?: string;
    pagadorUf?: string;
    pagadorCep?: string;
    descricao?: string;
    seuNumero?: string;
}

/** Common boleto response */
export interface BoletoResponse {
    nossoNumero: string;
    codigoBarras?: string;
    linhaDigitavel?: string;
    status: string;
    valor: number;
    vencimento: Date;
}

/** Service status */
export interface BankServiceStatus {
    initialized: boolean;
    hasCredentials: boolean;
    hasCertificates: boolean;
    environment: 'sandbox' | 'production';
    tokenValid: boolean;
    bankName: string;
}

// ============ Base URLs Configuration ============

export interface BankUrlConfig {
    auth: string;
    api: string;
    banking?: string;
    pix?: string;
    boleto?: string;
}

// ============ Abstract Base Class ============

export abstract class BankingApiBase {
    protected tokenCache: {
        accessToken: string | null;
        expiresAt: number;
    } = {
            accessToken: null,
            expiresAt: 0,
        };

    protected httpsAgent: https.Agent | null = null;
    protected axiosInstance: AxiosInstance | null = null;
    protected initialized = false;

    // ============ Abstract Methods ============

    /** Bank name for logging */
    protected abstract getBankName(): string;

    /** Client ID from config */
    protected abstract getClientId(): string;

    /** Client Secret from config */
    protected abstract getClientSecret(): string;

    /** Certificate path from config */
    protected abstract getCertPath(): string;

    /** Key path from config */
    protected abstract getKeyPath(): string;

    /** Whether sandbox mode is enabled */
    protected abstract isSandbox(): boolean;

    /** Get URLs based on environment */
    protected abstract getUrls(): { production: BankUrlConfig; sandbox: BankUrlConfig };

    /** Get OAuth2 scopes */
    protected abstract getScopes(): string;

    /** Map bank-specific balance response to common format */
    protected abstract mapBalance(response: any): BankBalance;

    /** Map bank-specific transaction to common format */
    protected abstract mapTransaction(raw: any): BankTransaction;

    // ============ Initialization ============

    /**
     * Initialize the service with certificates
     */
    async initialize(): Promise<boolean> {
        const bankName = this.getBankName();
        log.info(`[${bankName}] Initializing...`);

        if (!this.getClientId() || !this.getClientSecret()) {
            log.warn(`[${bankName}] Missing credentials`);
            return false;
        }

        try {
            const certPath = path.resolve(this.getCertPath());
            const keyPath = path.resolve(this.getKeyPath());

            if (!fs.existsSync(certPath)) {
                log.error(`[${bankName}] Certificate not found: ${certPath}`);
                return false;
            }

            if (!fs.existsSync(keyPath)) {
                log.error(`[${bankName}] Key not found: ${keyPath}`);
                return false;
            }

            const cert = fs.readFileSync(certPath);
            const key = fs.readFileSync(keyPath);

            this.httpsAgent = new https.Agent({
                cert,
                key,
                rejectUnauthorized: true,
            });

            const urls = this.getUrls();
            const baseURL = this.isSandbox() ? urls.sandbox.api : urls.production.api;

            this.axiosInstance = axios.create({
                baseURL,
                httpsAgent: this.httpsAgent,
                headers: {
                    'Content-Type': 'application/json',
                },
            });

            this.initialized = true;
            log.info(`[${bankName}] Initialized successfully (${this.isSandbox() ? 'SANDBOX' : 'PRODUCTION'})`);
            return true;
        } catch (error: any) {
            log.error(`[${bankName}] Initialization error`, error.message);
            return false;
        }
    }

    /**
     * Check if service is ready
     */
    isReady(): boolean {
        return this.initialized && this.axiosInstance !== null;
    }

    /**
     * Get service status
     */
    async getStatus(): Promise<BankServiceStatus> {
        const certExists = fs.existsSync(path.resolve(this.getCertPath()));
        const keyExists = fs.existsSync(path.resolve(this.getKeyPath()));

        const tokenValid = !!(
            this.tokenCache.accessToken &&
            this.tokenCache.expiresAt > Date.now()
        );

        return {
            initialized: this.initialized,
            hasCredentials: !!(this.getClientId() && this.getClientSecret()),
            hasCertificates: certExists && keyExists,
            environment: this.isSandbox() ? 'sandbox' : 'production',
            tokenValid,
            bankName: this.getBankName(),
        };
    }

    // ============ Authentication ============

    /**
     * Get OAuth2 access token (with cache)
     */
    async getAccessToken(): Promise<string> {
        // Check cache
        if (this.tokenCache.accessToken && this.tokenCache.expiresAt > Date.now() + 60000) {
            return this.tokenCache.accessToken;
        }

        const bankName = this.getBankName();
        log.info(`[${bankName}] Fetching new access token...`);

        const urls = this.getUrls();
        const authUrl = this.isSandbox() ? urls.sandbox.auth : urls.production.auth;

        try {
            const params = new URLSearchParams();
            params.append('client_id', this.getClientId());
            params.append('client_secret', this.getClientSecret());
            params.append('grant_type', 'client_credentials');
            params.append('scope', this.getScopes());

            const response = await axios.post(authUrl, params, {
                httpsAgent: this.httpsAgent!,
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
            });

            const { access_token, expires_in } = response.data;

            // Cache token (subtract 1 minute for safety)
            this.tokenCache = {
                accessToken: access_token,
                expiresAt: Date.now() + (expires_in - 60) * 1000,
            };

            log.info(`[${bankName}] Token obtained, expires in ${expires_in}s`);
            return access_token;
        } catch (error: any) {
            log.error(`[${bankName}] Token error`, error.response?.data || error.message);
            throw new Error(`Falha na autenticação com ${bankName}: ${error.message}`);
        }
    }

    // ============ HTTP Request Helper ============

    /**
     * Make authenticated API request
     */
    protected async request<T>(
        method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
        endpoint: string,
        data?: any,
        params?: any,
        customHeaders?: Record<string, string>
    ): Promise<T> {
        if (!this.isReady()) {
            await this.initialize();
        }

        if (!this.isReady()) {
            throw new Error(`${this.getBankName()} API not initialized. Check certificates and credentials.`);
        }

        const token = await this.getAccessToken();
        const bankName = this.getBankName();

        try {
            const response = await this.axiosInstance!.request<T>({
                method,
                url: endpoint,
                data,
                params,
                headers: {
                    Authorization: `Bearer ${token}`,
                    ...customHeaders,
                },
            });

            return response.data;
        } catch (error: any) {
            const axiosError = error as AxiosError;
            const apiError = axiosError.response?.data as any;

            log.error(`[${bankName}] API Error on ${method} ${endpoint}`, {
                status: axiosError.response?.status,
                error: apiError,
            });

            if (apiError?.title || apiError?.message) {
                throw new Error(`${apiError.title || 'Error'}: ${apiError.detail || apiError.message || 'Erro desconhecido'}`);
            }

            throw error;
        }
    }

    /**
     * Make request with binary response (PDF, etc.)
     */
    protected async requestBinary(
        method: 'GET' | 'POST',
        endpoint: string,
        acceptType: string = 'application/pdf'
    ): Promise<Buffer> {
        if (!this.isReady()) {
            await this.initialize();
        }

        const token = await this.getAccessToken();

        const response = await this.axiosInstance!.request({
            method,
            url: endpoint,
            headers: {
                Authorization: `Bearer ${token}`,
                Accept: acceptType,
            },
            responseType: 'arraybuffer',
        });

        return Buffer.from(response.data);
    }

    // ============ Common Banking Methods ============

    /**
     * Get account balance (normalized)
     */
    abstract getBalance(): Promise<BankBalance>;

    /**
     * Get account statement (normalized)
     */
    abstract getStatement(startDate: string, endDate: string): Promise<BankStatement>;

    // ============ Utility Methods ============

    /**
     * Format date for API (YYYY-MM-DD)
     */
    formatDate(date: Date): string {
        return date.toISOString().split('T')[0];
    }

    /**
     * Format datetime for API (ISO 8601)
     */
    formatDateTime(date: Date): string {
        return date.toISOString();
    }

    /**
     * Generate unique transaction ID
     */
    generateTxId(length: number = 26): string {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        let result = '';
        for (let i = 0; i < length; i++) {
            result += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return result;
    }

    /**
     * Parse money value (string) to number
     */
    parseValor(valor: string | number): number {
        if (typeof valor === 'number') return valor;
        return parseFloat(valor.replace(',', '.'));
    }

    /**
     * Format number to money value (string with 2 decimals)
     */
    formatValor(valor: number): string {
        return valor.toFixed(2);
    }
}
