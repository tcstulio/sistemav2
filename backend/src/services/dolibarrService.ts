import axios, { AxiosError } from 'axios';
import https from 'https'; // Added for custom agent
import { config } from '../config/env';
import { components } from '../types/dolibarr.actions';

// Extract strict types from the schema
export type CreateThirdPartyModel = components['schemas']['createThirdpartiesModel'];
export type CreateInvoiceModel = components['schemas']['createInvoicesModel'];
export type AddPaymentModel = components['schemas']['invoicesAddPaymentModel'];
export type ValidateSupplierOrderModel = components['schemas']['supplierordersValidateModel'];
export type CloseProposalModel = components['schemas']['proposalsCloseModel'];
export type AddTimeSpentModel = components['schemas']['tasksAddTimeSpentModel'];

export class DolibarrService {
    private baseUrl: string;
    private apiKey: string;
    private httpsAgent: https.Agent;

    constructor() {
        this.baseUrl = config.dolibarrUrl.endsWith('/') ? config.dolibarrUrl : `${config.dolibarrUrl}/`;
        // Server-side API Key (Admin) - Only use for strictly internal operations or reads if permitted
        this.apiKey = config.dolibarrKey;

        // Create an agent that ignores SSL errors (like curl -k) to prevent socket hang up
        // TODO: In production, we should import the CA cert instead of rejecting unauthorized.
        this.httpsAgent = new https.Agent({
            rejectUnauthorized: false
        });
    }

    private getHeaders(userKey?: string) {
        return {
            'DOLAPIKEY': userKey || this.apiKey,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            // Mimic a legitimate browser request to bypass firewall checks (prevents socket hang up)
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            // Bypass "Humans" security challenge
            'Cookie': config.dolibarrBypassCookie || 'humans_21909=1'
        };
    }

    private sanitizePath(path: string): string {
        return path.startsWith('/') ? path.substring(1) : path;
    }

    private handleError(error: any, context: string): never {
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
            status, // Custom property for our error handler
            details
        };
    }

    // --- Helper for Robust Auth (Header + Query Fallback) ---
    private async requestWithAuth<T>(method: string, endpointUrl: string, data: any, userKey?: string): Promise<T> {
        // SECURITY FIX: Require explicit key. Do NOT fallback to server admin key implicitly for writes.
        // This prevents unauthenticated external requests from acting as Admin.
        const key = userKey;

        if (!key) {
            throw {
                message: "Authentication Required: No API Key provided.",
                status: 401,
                details: { code: 401, message: "Authentication Required" }
            };
        }

        const headers = this.getHeaders(key);

        // Add DOLAPIKEY to Query Params as fallback for stripped headers
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

    // --- Strict Write Methods ---

    async createThirdParty(data: CreateThirdPartyModel, userKey?: string) {
        const url = `${this.baseUrl}thirdparties`;
        return this.requestWithAuth('POST', url, data, userKey);
    }

    async createInvoice(data: CreateInvoiceModel, userKey?: string) {
        const url = `${this.baseUrl}invoices`;
        return this.requestWithAuth('POST', url, data, userKey);
    }

    /**
     * Validates an API Key by making a lightweight request to Dolibarr.
     */
    async validateApiKey(apiKey: string): Promise<boolean> {
        try {
            const url = `${this.baseUrl}users`;
            const headers = this.getHeaders(apiKey);

            const response = await axios.get(url, {
                headers,
                params: {
                    limit: 1,
                    DOLAPIKEY: apiKey // Fallback
                },
                httpsAgent: this.httpsAgent,
                validateStatus: (status) => status === 200
            });
            return response.status === 200;
        } catch (error: any) {
            console.error('[Dolibarr] API Key Validation Error:', error.message);
            return false;
        }
    }

    async addPayment(invoiceId: string, data: AddPaymentModel, userKey?: string) {
        const url = `${this.baseUrl}invoices/${invoiceId}/payments`;
        return this.requestWithAuth('POST', url, data, userKey);
    }

    async validateSupplierOrder(orderId: string, data: ValidateSupplierOrderModel, userKey?: string) {
        const url = `${this.baseUrl}supplierorders/${orderId}/validate`;
        return this.requestWithAuth('POST', url, data, userKey);
    }

    async closeProposal(proposalId: string, data: CloseProposalModel, userKey?: string) {
        const url = `${this.baseUrl}proposals/${proposalId}/close`;
        return this.requestWithAuth('POST', url, data, userKey);
    }

    async addTimeSpent(taskId: string, data: AddTimeSpentModel, userKey?: string) {
        const url = `${this.baseUrl}tasks/${taskId}/addtimespent`;
        return this.requestWithAuth('POST', url, data, userKey);
    }



    /**
     * Proxies a generic request to Dolibarr
     * Used by the wildcard route in dolibarrRoutes.ts
     */
    async proxyRequest(method: string, path: string, body: any, query: any, headers: any) {
        // 1. Construct Target URL
        // Incoming path (from req.path) is like "/invoices", "/users/1", etc.
        // It does NOT contain "/api/dolibarr".
        const cleanPath = path.replace(/^\//, '');
        const targetUrl = `${this.baseUrl}${cleanPath}`;

        // 2. Prepare Headers
        // We forward the DOLAPIKEY if present in headers.
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

        // 3. Prepare Query Params
        // Remove DOLAPIKEY from query if we put it in headers, strictly speaking unnecessary but clean.
        // But axios params will just append them.

        try {
            console.log(`[DolibarrProxy] ${method} ${targetUrl}`);
            const response = await axios({
                method: method,
                url: targetUrl,
                headers: finalHeaders,
                params: query,
                data: body,
                httpsAgent: this.httpsAgent,
                validateStatus: (status) => status < 500 // Let frontend handle 4xx
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

    /**
     * Proxies requests to custom_sync.php for delta synchronization.
     * This endpoint is at the Dolibarr ROOT, not under /api/index.php.
     */
    async proxyCustomSync(query: any, headers: any) {
        // 1. Construct Target URL - custom_sync.php is at root, not API path
        // config.dolibarrUrl typically ends with /api/index.php
        // We need to go up to the root: remove /api/index.php part
        let rootUrl = config.dolibarrUrl;
        if (rootUrl.includes('/api/index.php')) {
            rootUrl = rootUrl.replace('/api/index.php', '');
        }
        rootUrl = rootUrl.replace(/\/$/, ''); // Remove trailing slash

        const targetUrl = `${rootUrl}/custom_sync.php`;

        // 2. Prepare Headers
        const finalHeaders: any = {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Cookie': config.dolibarrBypassCookie || 'humans_21909=1'
        };

        // Forward API Key from incoming headers
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


    /**
     * Authenticate User and Retrieve API Key
     * Uses the "Unsecured" GET login method found in older Dolibarr versions/Configurations.
     */
    async login(login: string, password: string): Promise<{ token: string, entity: string, message: string }> {
        const url = `${this.baseUrl}login?login=${encodeURIComponent(login)}&password=${encodeURIComponent(password)}`;

        console.log(`[DolibarrService] Attempting login for user: ${login}`);

        try {
            const headers = {
                'Accept': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Cookie': config.dolibarrBypassCookie || 'humans_21909=1'
            };

            const response = await axios.get(url, {
                headers,
                httpsAgent: this.httpsAgent
            });

            if (response.status === 200 && response.data && response.data.success) {
                console.log(`[DolibarrService] Login successful for ${login}`);
                return response.data.success;
            } else {
                console.warn(`[DolibarrService] Login failed for ${login}. Status: ${response.status}`, response.data);
                throw new Error(response.data?.error?.message || `Falha no login (${response.status})`);
            }
        } catch (error: any) {
            console.error(`[DolibarrService] Login Exception:`, error.message);
            throw new Error(error.message || 'Erro de conexão com Dolibarr');
        }
    }

    /**
     * Verifies if the API Key belongs to an Admin user.
     * Strategy: Try to access a strictly Admin-only endpoint (/setup/company or /setup/dictionary).
     */
    async verifyAdminStatus(apiKey: string): Promise<boolean> {
        try {
            // Try to access Company Setup - only Admins can read this.
            const url = `${this.baseUrl}setup/company`;
            const headers = this.getHeaders(apiKey); // Use the USER'S key

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
            // If 403, it means Key is valid but NOT Admin.
            // If 401, Key is invalid.
            if (error.response) {
                console.warn(`[DoliService] Admin Verification Failed. Status: ${error.response.status}`);
            } else {
                console.error('[DoliService] Check Error:', error.message);
            }
            return false;
        }
    }

    /**
     * Get User details by API Key
     */
    /**
     * Get User details by API Key
     * Uses /users/info to identify the current user associated with the key.
     */
    async getUserByKey(apiKey: string): Promise<any> {
        try {
            const drivers = ['users/info', 'users/myself'];
            const headers = this.getHeaders(apiKey);

            // Strategy 1: "Who Am I" endpoints
            // /users/info is standard in many versions to get current user profile
            for (const endpoint of drivers) {
                try {
                    const url = `${this.baseUrl}${endpoint}`;
                    const response = await axios.get(url, {
                        headers,
                        httpsAgent: this.httpsAgent,
                        validateStatus: (status) => status === 200
                    });

                    if (response.data && response.data.id) {
                        console.log(`[DoliService] User identified via /${endpoint}: ${response.data.login} (Firstname: ${response.data.firstname})`);
                        return response.data;
                    }
                } catch (ignore) {
                    // Try next
                }
            }

            // Strategy 2: SQL Filter (Fallback)
            // Note: t.api_key might not be queryable or sqlfilters might be disabled/restricted.
            // Only try this if "info" endpoints fail.
            const url = `${this.baseUrl}users`;
            try {
                const response = await axios.get(url, {
                    headers,
                    params: {
                        sqlfilters: `(t.api_key:=:'${apiKey}')`
                    },
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

            console.log(`[DoliService] User not found for key (All strategies failed)`);
            return null;
        } catch (error: any) {
            console.error('[DolibarrService] GetUserByKey Error:', error.message);
            return null;
        }
    }
    async getThirdPartyByPhone(phoneNumber: string): Promise<any | null> {
        try {
            // Clean phone: remove non-digits, take last 8 or 9 digits to be safe against formatting
            // E.g. 5511999998888 -> 999998888
            const clean = phoneNumber.replace(/\D/g, '');
            const search = clean.length > 8 ? clean.substring(clean.length - 8) : clean;

            const headers = this.getHeaders(null as any); // Read-only, use Admin/Default key
            const url = `${this.baseUrl}thirdparties`;

            // Using sqlfilters (ensure enable_sql_filters = 1 in Dolibarr API config)
            const sqlfilters = `(t.phone:like:'%${search}%') or (t.phone_mobile:like:'%${search}%')`;

            const response = await axios.get(url, {
                headers,
                params: {
                    sqlfilters,
                    limit: 1
                },
                httpsAgent: this.httpsAgent,
                validateStatus: (s) => s === 200 || s === 404
            });

            if (response.status === 200 && Array.isArray(response.data) && response.data.length > 0) {
                const found = response.data[0];
                console.log(`[DoliService] Phone match found: ${found.name} (ID: ${found.id})`);
                return found;
            }
            return null;
        } catch (error: any) {
            console.error(`[DoliService] Phone Search Error for ${phoneNumber}:`, error.message);
            return null;
        }
    }

    async getCustomerContext(thirdPartyId: string): Promise<string> {
        if (!thirdPartyId) return "Dados do cliente não identificados.";

        try {
            const headers = this.getHeaders(null as any);

            // 1. Open Invoices
            const invoicesUrl = `${this.baseUrl}invoices`;
            const invPromise = axios.get(invoicesUrl, {
                headers,
                params: {
                    sqlfilters: `(t.fk_soc:=:${thirdPartyId}) and (t.paye:=:0) and (t.fk_statut:>:0)`, // Not paid, validated
                    limit: 5,
                    sortfield: 't.datef',
                    sortorder: 'DESC'
                },
                httpsAgent: this.httpsAgent,
                validateStatus: (s) => s < 500
            });

            // 2. Projects (Modified)
            const projectsUrl = `${this.baseUrl}projects`;
            const projPromise = axios.get(projectsUrl, {
                headers,
                params: {
                    sqlfilters: `(t.fk_soc:=:${thirdPartyId})`,
                    limit: 3,
                    sortfield: 't.datec',
                    sortorder: 'DESC'
                },
                httpsAgent: this.httpsAgent,
                validateStatus: (s) => s < 500
            });

            // 3. Agenda/Events (Modified)
            const agendaUrl = `${this.baseUrl}agenda/events`;
            const agendaPromise = axios.get(agendaUrl, {
                headers,
                params: {
                    sqlfilters: `(t.fk_soc:=:${thirdPartyId})`,
                    limit: 3,
                    sortfield: 't.datep', // Date planned
                    sortorder: 'DESC'
                },
                httpsAgent: this.httpsAgent,
                validateStatus: (s) => s < 500
            });

            const [invRes, projRes, agendaRes] = await Promise.all([invPromise, projPromise, agendaPromise]);

            let context = `CLIENTE ID: ${thirdPartyId}\n`;

            // Process Invoices
            context += "\nFATURAS EM ABERTO:\n";
            if (invRes.status === 200 && Array.isArray(invRes.data) && invRes.data.length > 0) {
                invRes.data.forEach((inv: any) => {
                    context += `- Ref: ${inv.ref}, Total: R$ ${parseFloat(inv.total_ttc || 0).toFixed(2)}, Data: ${new Date(inv.date * 1000).toLocaleDateString()}\n`;
                });
            } else {
                context += "(Nenhuma fatura pendente encontrada)\n";
            }

            // Process Projects
            context += "\nPROJETOS RECENTES:\n";
            if (projRes.status === 200 && Array.isArray(projRes.data) && projRes.data.length > 0) {
                projRes.data.forEach((p: any) => {
                    context += `- [${p.ref}] ${p.title} (Status: ${p.statut === 1 ? 'Aberto' : 'Fechado'})\n`;
                });
            } else {
                context += "(Nenhum projeto recente)\n";
            }

            // Process Agenda
            context += "\nPRÓXIMOS EVENTOS/AGENDA:\n";
            if (agendaRes.status === 200 && Array.isArray(agendaRes.data) && agendaRes.data.length > 0) {
                agendaRes.data.forEach((ev: any) => {
                    // ev.datep is timestamp
                    const date = ev.datep ? new Date(ev.datep * 1000).toLocaleDateString() : 'N/A';
                    context += `- ${date}: ${ev.label} (${ev.type_code || 'Geral'})\n`;
                });
            } else {
                context += "(Nenhum evento na agenda)\n";
            }

            return context;
        } catch (error) {
            console.error('[DoliService] Context Fetch Error:', error);
            return "Erro ao buscar dados detalhados do cliente no CRM.";
        }
    }
}

export const dolibarrService = new DolibarrService();
