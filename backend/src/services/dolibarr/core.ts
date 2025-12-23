/**
 * Dolibarr Service - Core Module
 * 
 * Base class with authentication, HTTP helpers, and proxy functionality.
 */

import axios, { AxiosError } from 'axios';
import https from 'https';
import { config } from '../../config/env';
import { components } from '../../types/dolibarr.actions';

// Extract strict types from the schema
export type CreateThirdPartyModel = components['schemas']['createThirdpartiesModel'];
export type CreateInvoiceModel = components['schemas']['createInvoicesModel'];
export type AddPaymentModel = components['schemas']['invoicesAddPaymentModel'];
export type ValidateSupplierOrderModel = components['schemas']['supplierordersValidateModel'];
export type CloseProposalModel = components['schemas']['proposalsCloseModel'];
export type AddTimeSpentModel = components['schemas']['tasksAddTimeSpentModel'];

export class DolibarrServiceBase {
    protected baseUrl: string;
    protected apiKey: string;
    protected httpsAgent: https.Agent;

    constructor() {
        this.baseUrl = config.dolibarrUrl.endsWith('/') ? config.dolibarrUrl : `${config.dolibarrUrl}/`;
        this.apiKey = config.dolibarrKey;
        this.httpsAgent = new https.Agent({
            rejectUnauthorized: false
        });
    }

    protected getHeaders(userKey?: string) {
        return {
            'DOLAPIKEY': userKey || this.apiKey,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Cookie': config.dolibarrBypassCookie || 'humans_21909=1'
        };
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

        console.error(`[DolibarrService] ${context}: ${message}`);

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
            console.error('[Dolibarr] API Key Validation Error:', error.message);
            return false;
        }
    }

    async login(login: string, password: string): Promise<{ token: string, entity: string, message: string }> {
        const url = `${this.baseUrl}login?login=${encodeURIComponent(login)}&password=${encodeURIComponent(password)}`;
        console.log(`[DolibarrService] Attempting login for user: ${login}`);

        try {
            const headers = {
                'Accept': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Cookie': config.dolibarrBypassCookie || 'humans_21909=1'
            };

            const response = await axios.get(url, { headers, httpsAgent: this.httpsAgent });

            if (response.status === 200 && response.data && response.data.success) {
                console.log(`[DolibarrService] Login successful for ${login}`);
                return response.data.success;
            } else {
                throw new Error(response.data?.error?.message || `Falha no login (${response.status})`);
            }
        } catch (error: any) {
            console.error(`[DolibarrService] Login Exception:`, error.message);
            throw new Error(error.message || 'Erro de conexão com Dolibarr');
        }
    }

    async verifyAdminStatus(apiKey: string): Promise<boolean> {
        try {
            const url = `${this.baseUrl}setup/company`;
            const headers = this.getHeaders(apiKey);

            console.log(`[DoliService] Verifying Admin Status for key ${apiKey.substring(0, 5)}...`);

            const response = await axios.get(url, {
                headers,
                httpsAgent: this.httpsAgent,
                validateStatus: (status) => status === 200
            });

            if (response.status === 200) {
                console.log(`[DoliService] Admin Verified (Access to /setup/company granted).`);
                return true;
            }
            return false;
        } catch (error: any) {
            if (error.response) {
                console.warn(`[DoliService] Admin Verification Failed. Status: ${error.response.status}`);
            } else {
                console.error('[DoliService] Check Error:', error.message);
            }
            return false;
        }
    }

    async getUserByKey(apiKey: string): Promise<any> {
        try {
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
                        console.log(`[DoliService] User identified via /${endpoint}: ${response.data.login}`);
                        return response.data;
                    }
                } catch (ignore) {
                    // Try next
                }
            }

            // Fallback: SQL filter
            const url = `${this.baseUrl}users`;
            try {
                const response = await axios.get(url, {
                    headers,
                    params: { sqlfilters: `(t.api_key:=:'${apiKey}')` },
                    httpsAgent: this.httpsAgent
                });

                if (response.data && Array.isArray(response.data)) {
                    const exactMatch = response.data.find((u: any) => u.api_key === apiKey);
                    if (exactMatch) return exactMatch;
                    if (response.data.length > 0) return response.data[0];
                }
            } catch (sqlErr: any) {
                console.warn(`[DoliService] SQL Filter fallback failed: ${sqlErr.message}`);
            }

            return null;
        } catch (error: any) {
            console.error('[DolibarrService] GetUserByKey Error:', error.message);
            return null;
        }
    }

    // === Proxy Methods ===

    async proxyRequest(method: string, path: string, body: any, query: any, headers: any) {
        const cleanPath = path.replace(/^\//, '');
        const targetUrl = `${this.baseUrl}${cleanPath}`;

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
            console.log(`[DolibarrProxy] ${method} ${targetUrl}`);
            const response = await axios({
                method: method,
                url: targetUrl,
                headers: finalHeaders,
                params: query,
                data: body,
                httpsAgent: this.httpsAgent,
                validateStatus: (status) => status < 500
            });

            return {
                status: response.status,
                data: response.data,
                headers: response.headers
            };
        } catch (error: any) {
            console.error(`[DolibarrProxy] Error: ${error.message}`);
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
            'Cookie': config.dolibarrBypassCookie || 'humans_21909=1'
        };

        const incomingKey = Object.keys(headers).find(k => k.toLowerCase() === 'dolapikey');
        if (incomingKey) {
            finalHeaders['DOLAPIKEY'] = headers[incomingKey];
        } else if (query.DOLAPIKEY) {
            finalHeaders['DOLAPIKEY'] = query.DOLAPIKEY;
        }

        try {
            console.log(`[DolibarrCustomSync] GET ${targetUrl}?type=${query.type}&last_modified=${query.last_modified}`);
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
            console.error(`[DolibarrCustomSync] Error: ${error.message}`);
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
