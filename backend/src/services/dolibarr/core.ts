/**
 * Dolibarr Service - Core Module
 * 
 * Base class with authentication, HTTP helpers, and proxy functionality.
 */

import axios, { AxiosError } from 'axios';
import https from 'https';
import fs from 'fs';
import { config } from '../../config/env';
import { logger } from '../../utils/logger';

const log = logger.child('DolibarrService');
import { components } from '../../types/dolibarr.actions';

// Extract strict types from the schema
export type CreateThirdPartyModel = components['schemas']['createThirdpartiesModel'];
export type CreateInvoiceModel = components['schemas']['createInvoicesModel'];
export type AddPaymentModel = components['schemas']['invoicesAddPaymentModel'];
export type ValidateSupplierOrderModel = components['schemas']['supplierordersValidateModel'];
export type CloseProposalModel = components['schemas']['proposalsCloseModel'];
export type AddTimeSpentModel = components['schemas']['tasksAddTimeSpentModel'];

// API Key validation regex - only alphanumeric, hyphens, and underscores
const API_KEY_PATTERN = /^[a-zA-Z0-9\-_]{20,}$/;

function isValidApiKey(key: string): boolean {
    return API_KEY_PATTERN.test(key);
}

function sanitizeForSqlFilter(value: string): string {
    // Escape special SQL characters
    return value.replace(/['";\\]/g, '');
}

export class DolibarrServiceBase {
    protected baseUrl: string;
    protected apiKey: string;
    protected httpsAgent: https.Agent;
    private proxyCache = new Map<string, { data: any; status: number; timestamp: number }>();
    private readonly PROXY_CACHE_TTL = 30 * 1000; // 30 seconds

    constructor() {
        this.baseUrl = config.dolibarrUrl.endsWith('/') ? config.dolibarrUrl : `${config.dolibarrUrl}/`;
        this.apiKey = config.dolibarrKey;

        // SSL Configuration - secure by default in production
        const isProduction = process.env.NODE_ENV === 'production';
        const caCertPath = process.env.DOLIBARR_CA_CERT;

        if (isProduction) {
            // Production: Validate SSL certificates
            const agentOptions: https.AgentOptions = {
                rejectUnauthorized: true
            };

            // Support custom CA certificate for self-signed certs
            if (caCertPath && fs.existsSync(caCertPath)) {
                agentOptions.ca = fs.readFileSync(caCertPath);
                log.info('Using custom CA certificate for SSL validation');
            }

            this.httpsAgent = new https.Agent(agentOptions);
        } else {
            // Development: Allow self-signed certificates with warning
            log.warn('SSL validation disabled (development mode only)');
            this.httpsAgent = new https.Agent({
                rejectUnauthorized: false
            });
        }

        // Cleanup expired proxy cache entries every 60 seconds
        setInterval(() => {
            const now = Date.now();
            for (const [key, entry] of this.proxyCache.entries()) {
                if (now - entry.timestamp > this.PROXY_CACHE_TTL) {
                    this.proxyCache.delete(key);
                }
            }
        }, 60 * 1000).unref();
    }

    protected getHeaders(userKey?: string) {
        const headers: Record<string, string> = {
            'DOLAPIKEY': userKey || this.apiKey,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        };
        if (config.dolibarrBypassCookie) {
            headers['Cookie'] = config.dolibarrBypassCookie;
        }
        return headers;
    }

    protected sanitizePath(path: string): string {
        return path.startsWith('/') ? path.substring(1) : path;
    }

    protected handleError(error: any, context: string): never {
        let status = 500;
        let message = `Dolibarr Error during ${context}`;
        let details = null;

        if (axios.isAxiosError(error)) {
            const axiosError = error as AxiosError<any>;
            if (axiosError.response) {
                status = axiosError.response.status;
                message = axiosError.response.data?.error?.message || axiosError.message;
                details = axiosError.response.data;
            } else if (axiosError.request) {
                message = "No response received from Dolibarr";
            } else {
                message = axiosError.message;
            }
        } else if (error instanceof Error) {
            message = error.message;
        }

        log.error(`${context}: ${message}`);

        throw {
            message,
            status,
            details
        };
    }

    protected async requestWithAuth<T>(method: string, endpointUrl: string, data: any, userKey?: string): Promise<T> {
        const key = userKey;

        if (!key) {
            throw {
                message: "Authentication Required: No API Key provided.",
                status: 401,
                details: { code: 401, message: "Authentication Required" }
            };
        }

        const headers = this.getHeaders(key);
        const urlObj = new URL(endpointUrl);
        urlObj.searchParams.append('DOLAPIKEY', key);

        try {
            const response = await axios({
                method,
                url: urlObj.toString(),
                data,
                headers,
                httpsAgent: this.httpsAgent
            });
            return response.data;
        } catch (error) {
            this.handleError(error, `${method} ${endpointUrl}`);
        }
    }

    // === Authentication Methods ===

    async validateApiKey(apiKey: string): Promise<boolean> {
        try {
            const url = `${this.baseUrl}users`;
            const headers = this.getHeaders(apiKey);

            const response = await axios.get(url, {
                headers,
                params: { limit: 1, DOLAPIKEY: apiKey },
                httpsAgent: this.httpsAgent,
                validateStatus: (status) => status === 200
            });
            return response.status === 200;
        } catch (error: any) {
            log.error(`API Key Validation Error: ${error.message}`);
            return false;
        }
    }

    async login(login: string, password: string): Promise<{ token: string, entity: string, message: string }> {
        const url = `${this.baseUrl}login?login=${encodeURIComponent(login)}&password=${encodeURIComponent(password)}`;
        log.debug(`Attempting login for user: ${login}`);

        try {
            const headers: Record<string, string> = {
                'Accept': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            };
            if (config.dolibarrBypassCookie) {
                headers['Cookie'] = config.dolibarrBypassCookie;
            }

            const response = await axios.get(url, { headers, httpsAgent: this.httpsAgent });

            if (response.status === 200 && response.data && response.data.success) {
                log.info(`Login successful for ${login}`);
                return response.data.success;
            } else {
                throw new Error(response.data?.error?.message || `Falha no login (${response.status})`);
            }
        } catch (error: any) {
            log.error(`Login Exception: ${error.message}`);
            throw new Error(error.message || 'Erro de conexão com Dolibarr');
        }
    }

    async verifyAdminStatus(apiKey: string): Promise<boolean> {
        try {
            const url = `${this.baseUrl}setup/company`;
            const headers = this.getHeaders(apiKey);

            log.debug(`Verifying Admin Status for key ${apiKey.substring(0, 5)}...`);

            const response = await axios.get(url, {
                headers,
                httpsAgent: this.httpsAgent,
                validateStatus: (status) => status === 200
            });

            if (response.status === 200) {
                log.info('Admin Verified (Access to /setup/company granted)');
                return true;
            }
            return false;
        } catch (error: any) {
            if (error.response) {
                log.warn(`Admin Verification Failed. Status: ${error.response.status}`);
            } else {
                log.error(`Check Error: ${error.message}`);
            }
            return false;
        }
    }

    async getUserByKey(apiKey: string): Promise<any> {
        try {
            // Validate API key format to prevent injection
            if (!apiKey || !isValidApiKey(apiKey)) {
                log.warn('Invalid API key format rejected');
                return null;
            }

            const drivers = ['users/info', 'users/myself'];
            const headers = this.getHeaders(apiKey);

            for (const endpoint of drivers) {
                try {
                    const url = `${this.baseUrl}${endpoint}`;
                    const response = await axios.get(url, {
                        headers,
                        httpsAgent: this.httpsAgent,
                        validateStatus: (status) => status === 200
                    });

                    if (response.data && response.data.id) {
                        if (process.env.NODE_ENV !== 'production') {
                            log.debug(`User identified via /${endpoint}: ${response.data.login}`);
                        }
                        return response.data;
                    }
                } catch (ignore) {
                    // Try next
                }
            }

            // Fallback: SQL filter with sanitized input
            const url = `${this.baseUrl}users`;
            try {
                const sanitizedKey = sanitizeForSqlFilter(apiKey);
                const response = await axios.get(url, {
                    headers,
                    params: { sqlfilters: `(t.api_key:=:'${sanitizedKey}')` },
                    httpsAgent: this.httpsAgent
                });

                if (response.data && Array.isArray(response.data)) {
                    const exactMatch = response.data.find((u: any) => u.api_key === apiKey);
                    if (exactMatch) return exactMatch;
                    if (response.data.length > 0) return response.data[0];
                }
            } catch (sqlErr: any) {
                log.warn(`SQL Filter fallback failed: ${sqlErr.message}`);
            }

            return null;
        } catch (error: any) {
            log.error(`GetUserByKey Error: ${error.message}`);
            return null;
        }
    }

    // === Proxy Methods ===

    async proxyRequest(method: string, path: string, body: any, query: any, headers: any) {
        const cleanPath = path.replace(/^\//, '');
        const targetUrl = `${this.baseUrl}${cleanPath}`;

        // Check cache for GET requests
        if (method.toUpperCase() === 'GET') {
            const cacheKey = `${cleanPath}?${JSON.stringify(query || {})}`;
            const cached = this.proxyCache.get(cacheKey);
            if (cached && Date.now() - cached.timestamp < this.PROXY_CACHE_TTL) {
                log.debug(`Proxy cache HIT: ${cleanPath}`);
                return { status: cached.status, data: cached.data, headers: {} };
            }
        }

        const finalHeaders: any = {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
        };

        const incomingKey = Object.keys(headers).find(k => k.toLowerCase() === 'dolapikey');
        if (incomingKey) {
            finalHeaders['DOLAPIKEY'] = headers[incomingKey];
        } else if (query.DOLAPIKEY) {
            finalHeaders['DOLAPIKEY'] = query.DOLAPIKEY;
        }

        try {
            log.debug(`Proxy ${method} ${targetUrl}`);
            const response = await axios({
                method: method,
                url: targetUrl,
                headers: finalHeaders,
                params: query,
                data: body,
                httpsAgent: this.httpsAgent,
                validateStatus: (status) => status < 500
            });

            // Cache successful GET responses
            if (method.toUpperCase() === 'GET' && response.status === 200) {
                const cacheKey = `${cleanPath}?${JSON.stringify(query || {})}`;
                this.proxyCache.set(cacheKey, { data: response.data, status: response.status, timestamp: Date.now() });
            }

            return {
                status: response.status,
                data: response.data,
                headers: response.headers
            };
        } catch (error: any) {
            log.error(`Proxy Error: ${error.message}`);
            if (axios.isAxiosError(error) && error.response) {
                return {
                    status: error.response.status,
                    data: error.response.data,
                    headers: error.response.headers
                };
            }
            return {
                status: 500,
                data: { error: 'Internal Proxy Error', message: error.message },
                headers: {}
            };
        }
    }

    async proxyCustomSync(query: any, headers: any) {
        let rootUrl = config.dolibarrUrl;
        if (rootUrl.includes('/api/index.php')) {
            rootUrl = rootUrl.replace('/api/index.php', '');
        }
        rootUrl = rootUrl.replace(/\/$/, '');

        const targetUrl = `${rootUrl}/custom_sync.php`;

        const finalHeaders: any = {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        };
        if (config.dolibarrBypassCookie) {
            finalHeaders['Cookie'] = config.dolibarrBypassCookie;
        }

        const incomingKey = Object.keys(headers).find(k => k.toLowerCase() === 'dolapikey');
        if (incomingKey) {
            finalHeaders['DOLAPIKEY'] = headers[incomingKey];
        } else if (query.DOLAPIKEY) {
            finalHeaders['DOLAPIKEY'] = query.DOLAPIKEY;
        }

        // Ensure DOLAPIKEY is in query params for custom_sync.php (it reads from $_GET)
        if (!query.DOLAPIKEY && finalHeaders['DOLAPIKEY']) {
            query.DOLAPIKEY = finalHeaders['DOLAPIKEY'];
        }

        try {
            log.debug(`CustomSync GET ${targetUrl}?type=${query.type}&last_modified=${query.last_modified}`);
            const response = await axios.get(targetUrl, {
                headers: finalHeaders,
                params: query,
                httpsAgent: this.httpsAgent,
                validateStatus: (status) => status < 500
            });

            return {
                status: response.status,
                data: response.data,
                headers: response.headers
            };
        } catch (error: any) {
            log.error(`CustomSync Error: ${error.message}`);
            if (axios.isAxiosError(error) && error.response) {
                return {
                    status: error.response.status,
                    data: error.response.data,
                    headers: error.response.headers
                };
            }
            return {
                status: 500,
                data: { error: 'Custom Sync Proxy Error', message: error.message },
                headers: {}
            };
        }
    }
}
