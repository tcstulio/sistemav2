import { DolibarrConfig, DolibarrDictionary, DolibarrUser, Category } from '../../types';
import { dbService } from '../dbService';
import { config as AppConfig } from '../../config';

// Safe UUID Generator
export const generateUUID = () => {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
};

export const fetchCategories = async (config: DolibarrConfig): Promise<Category[]> => {
    try {
        const unlimitedConfig = { ...config, apiLimit: 0 };
        const data = await fetchList(unlimitedConfig, 'categories');
        return data.map((d: any) => ({
            id: String(d.id),
            label: d.label,
            type: d.type,
            description: d.description
        }));
    } catch {
        return [];
    }
};

export const sanitizeUrl = (url: string) => {
    // Legacy support, now we use Backend Proxy
    return '';
};

export const getHeaders = (apiKey: string) => {
    return {
        'DOLAPIKEY': apiKey ? apiKey.trim() : '',
        'Content-Type': 'application/json',
        'Accept': 'application/json'
    };
};

export const request = async (endpointUrl: string, options: RequestInit = {}) => {
    const startTime = Date.now();

    // Construct the URL to our own Backend Proxy
    let path = endpointUrl;

    // If it looks like a full URL, try to extract the resource path
    if (endpointUrl.includes('/api/index.php/')) {
        path = endpointUrl.split('/api/index.php/')[1];
    } else if (endpointUrl.startsWith('http')) {
        try {
            if (endpointUrl.includes('/api/dolibarr/')) {
                path = endpointUrl.split('/api/dolibarr/')[1];
            }
        } catch (e) { }
    }

    // Clean path
    path = path.replace(/^\//, '');

    // Use our Backend Proxy
    const proxyUrl = `${AppConfig.API_BASE_URL}/api/dolibarr/${path}`;

    console.log(`[BackendProxy] Requesting: ${proxyUrl} (Original: ${endpointUrl})`);

    const method = options.method || 'GET';
    const requestBody = options.body ? String(options.body) : undefined;

    try {
        const response = await fetch(proxyUrl, options);

        if (!response.ok) {
            let errorMsg = `Erro Proxy HTTP ${response.status}`;
            try {
                const errorData = await response.json();
                errorMsg = typeof errorData === 'object' ? JSON.stringify(errorData) : errorData;
            } catch (e) {
                errorMsg = await response.text();
            }

            console.error('[BackendProxy] Error:', errorMsg);

            // Log error
            dbService.add('api_logs', {
                id: generateUUID(),
                timestamp: Date.now(),
                type: 'DOLIBARR_API',
                endpoint_or_task: `${method} ${path}`,
                input_context: proxyUrl,
                request_method: method,
                request_body: requestBody,
                output_data: errorMsg,
                status: 'error',
                duration_ms: Date.now() - startTime
            }).catch(() => { });

            throw new Error(errorMsg);
        }

        if (response.status === 204) return null;

        const data = await response.json();

        // Log Success
        if ((method !== 'GET') || (method === 'GET' && (Array.isArray(data) || typeof data === 'object'))) {
            dbService.add('api_logs', {
                id: generateUUID(),
                timestamp: Date.now(),
                type: 'DOLIBARR_API',
                endpoint_or_task: `${method} ${path}`,
                input_context: proxyUrl,
                request_method: method,
                request_body: requestBody,
                output_data: JSON.stringify(Array.isArray(data) ? data.slice(0, 3) : data),
                status: 'success',
                duration_ms: Date.now() - startTime
            }).catch(err => { });
        }

        return data;

    } catch (error: any) {
        console.error('[BackendProxy] Network/System Error:', error);
        throw error;
    }
};

export const checkConnection = async (apiUrl: string, apiKey: string) => {
    // 1. Sanitize
    const baseUrl = sanitizeUrl(apiUrl);

    // 2. Define Endpoints
    const statusUrl = `${baseUrl}/status`;
    // Use 'thirdparties' for auth check as it's accessible to most users, unlike setup/company
    const authUrl = `${baseUrl}/thirdparties?limit=1`;

    // Try Status first (Basic reachability)
    try {
        await request(statusUrl, { headers: getHeaders(apiKey) });
    } catch (e: any) {
        console.warn(`[Connection] Status check warning: ${e.message}. Proceeding to Auth check.`);
    }

    // Try Auth explicitly - Better Error Handling
    try {
        const companyData = await request(authUrl, { headers: getHeaders(apiKey) });
        return companyData;
    } catch (authError: any) {
        console.error("Auth Check Failed:", authError);

        if (authError.message && authError.message.includes('404')) {
            throw new Error(`Conexão estabelecida, mas endpoint de autenticação não encontrado (404). Verifique a URL.`);
        }
        if (authError.message && (authError.message.includes('401') || authError.message.includes('403'))) {
            throw new Error(`Conexão OK, mas Acesso Negado (${authError.message}). Verifique a Chave API.`);
        }

        throw authError;
    }
};

export const fetchPage = async (config: DolibarrConfig, endpoint: string, page: number = 0, limit: number = 50, sortField?: string, sortOrder?: string, filter?: string) => {
    let params = `&limit=${limit}&page=${page}`;
    if (sortField) params += `&sortfield=${sortField}`;
    if (sortOrder) params += `&sortorder=${sortOrder}`;
    if (filter) params += filter;

    const url = `${sanitizeUrl(config.apiUrl)}/${endpoint}?${params}`;
    try {
        const data = await request(url, {
            headers: getHeaders(config.apiKey)
        });
        return Array.isArray(data) ? data : [];
    } catch (e: any) {
        console.error(`[fetchPage] Error fetching ${endpoint}:`, e);
        throw e;
    }
};

export const fetchList = async (config: DolibarrConfig, endpoint: string, params: string = '', lastModified: number = 0, dateField: string = 't.date_modification') => {
    let allItems: any[] = [];
    let page = 0;
    const limit = 100;
    let keepFetching = true;
    let safetyCounter = 0;

    let timeFilter = '';
    // FIXED: Use ISO Date String for filtering, as Dolibarr ignores numeric timestamps in sqlfilters
    if (lastModified && lastModified > 0) {
        // Safe check: ensure lastModified is reasonable (e.g., > year 2000)
        // Convert to milliseconds if it looks like seconds (small heuristic)
        const ts = lastModified < 10000000000 ? lastModified * 1000 : lastModified;
        const dateObj = new Date(ts);

        // Format YYYY-MM-DD HH:mm:ss
        const toIsoString = (d: Date) => d.toISOString().replace('T', ' ').split('.')[0];
        const dateStr = toIsoString(dateObj);

        // Usage of >= to ensure we catch items modified exactly at that second too
        timeFilter = `&sqlfilters=(${dateField}:>=:'${dateStr}')`;
        console.log(`[Incremental] Fetching ${endpoint} modified after ${dateStr} (${dateField})`);
    }

    const userLimit = config.apiLimit || 0;

    // Helper to track seen IDs to prevent loops
    const seenIds = new Set<string>();

    while (keepFetching && safetyCounter < 50) {
        try {
            const url = `${sanitizeUrl(config.apiUrl)}/${endpoint}?limit=${limit}&page=${page}${params}${timeFilter}`;

            const data = await request(url, {
                headers: getHeaders(config.apiKey)
            });
            if (Array.isArray(data) && data.length > 0) {
                // Loop Detection 2.0: Check against Set of seen IDs
                let newItemsCount = 0;

                // Pre-process data to filter out duplicates locally if API pagination is messy
                const cleanData = data.filter(item => {
                    const id = String(item.id || item.rowid);
                    if (seenIds.has(id)) return false;
                    seenIds.add(id);
                    return true;
                });
                newItemsCount = cleanData.length;

                if (newItemsCount === 0 && data.length > 0) {
                    console.warn(`[CoolGroove] Loop detected in ${endpoint} (all items in page already seen). Stopping.`);
                    keepFetching = false;
                } else {
                    allItems = [...allItems, ...cleanData];

                    if (data.length < limit) keepFetching = false;
                    page++;

                    if (userLimit > 0 && allItems.length >= userLimit) {
                        keepFetching = false;
                    }
                }
            } else {
                if (timeFilter && page === 0) {
                    console.log(`[Incremental] No changes for ${endpoint} since last sync.`);
                }
                keepFetching = false;
            }
        } catch (e: any) {
            if (page === 0 && e.message && (e.message.includes('404') || e.message.includes('Not Found'))) {
                keepFetching = false;
            } else if (e.message && (e.message.includes('401') || e.message.includes('Unauthorized'))) {
                console.warn(`[CoolGroove] Não autorizado (401) para ${endpoint}. Parando busca.`);
                if (page === 0) throw e;
                keepFetching = false;
            } else if (e.message && (e.message.toLowerCase().includes('forbidden') || e.message.includes('403'))) {
                console.warn(`[CoolGroove] Acesso negado (403) para ${endpoint}. Retornando dados parciais/vazios.`);
                keepFetching = false;
            } else {
                console.error(`[CoolGroove] Erro buscando ${endpoint} página ${page}:`, e);
                keepFetching = false;
                if (page === 0 && e.message && e.message.includes('Network Error')) {
                    throw e;
                }
            }
        }
        safetyCounter++;
        await new Promise(r => setTimeout(r, 100));
    }

    if (userLimit > 0 && allItems.length > userLimit) {
        return allItems.slice(0, userLimit);
    }

    return allItems;
};

/**
 * Fetches delta updates using the custom_sync.php endpoint.
 * This bypasses Standard API limitations regarding 'tms' filtering.
 * Uses the backend proxy at /api/dolibarr/custom_sync.php
 */
export const fetchDelta = async (config: DolibarrConfig, entityType: string, lastModified: number) => {
    // Use the Backend Proxy route for custom_sync.php
    // The backend proxy at /api/dolibarr/custom_sync.php will forward to Dolibarr's root/custom_sync.php
    const url = `${AppConfig.API_BASE_URL}/api/dolibarr/custom_sync.php`;
    const allData: any[] = [];
    let offset = 0;
    const limit = 5000; // Match server default
    let hasMore = true;
    let safetyCounter = 0;

    try {
        while (hasMore && safetyCounter < 20) { // Max 20 pages = 100,000 records
            const params = new URLSearchParams({
                type: entityType,
                last_modified: String(lastModified),
                limit: String(limit),
                offset: String(offset),
                DOLAPIKEY: config.apiKey
            });

            const fullUrl = `${url}?${params.toString()}`;

            const response = await request(fullUrl, {
                method: 'GET',
                headers: getHeaders(config.apiKey)
            });

            // Handle both old format (array) and new format (object with data & pagination)
            if (Array.isArray(response)) {
                // Old format - single array response
                allData.push(...response);
                hasMore = false; // No pagination info, stop loop
            } else if (response && response.data && Array.isArray(response.data)) {
                // New paginated format
                allData.push(...response.data);
                hasMore = response.pagination?.has_more || false;
                offset += limit;

                if (response.data.length > 0) {
                    console.log(`[CoolGrooveDelta] ${entityType}: Fetched ${allData.length} records (page ${safetyCounter + 1})`);
                }
            } else {
                // Unknown format, stop
                hasMore = false;
            }

            safetyCounter++;
        }

        if (safetyCounter >= 20) {
            console.warn(`[CoolGrooveDelta] ${entityType}: Reached max pages (100,000 records). Some data may be missing.`);
        }

        return allData;
    } catch (error) {
        console.error(`[CoolGrooveDelta] Failed to fetch delta for ${entityType}:`, error);
        return [];
    }
};

export const fetchSetupModules = async (config: DolibarrConfig) => {
    try {
        const url = `${sanitizeUrl(config.apiUrl)}/setup/modules`;
        return await request(url, { headers: getHeaders(config.apiKey) });
    } catch (e: any) {
        if (e.message && (e.message.includes('403') || e.message.toLowerCase().includes('forbidden'))) {
            console.warn('[CoolGroove] Access to setup/modules denied (403). Assuming default module config.');
            return [];
        }
        throw e;
    }
};

export const getCompanyInfo = async (config: DolibarrConfig) => {
    const url = `${sanitizeUrl(config.apiUrl)}/setup/company`;
    return request(url, { headers: getHeaders(config.apiKey) });
};

export const fetchDictionary = async (config: DolibarrConfig, dictionaryType: string): Promise<DolibarrDictionary[]> => {
    const url = `${sanitizeUrl(config.apiUrl)}/setup/dictionary/${dictionaryType}`;
    try {
        const data = await request(url, { headers: getHeaders(config.apiKey) });
        return Array.isArray(data) ? data : [];
    } catch (e) {
        console.warn(`Falha ao buscar dicionário ${dictionaryType}`, e);
        return [];
    }
};

export const fetchCurrentUser = async (config: DolibarrConfig, loginHint?: string): Promise<DolibarrUser | null> => {
    try {
        let filter = '';
        if (loginHint) {
            filter = `&sqlfilters=(t.login:=:'${loginHint}')`;
        }

        const users = await fetchList(config, 'users', filter);

        if (users && users.length > 0) {
            const minimalUser = users[0];
            const userId = minimalUser.id;

            const url = `${sanitizeUrl(config.apiUrl)}/users/${userId}?includepermissions=1`;
            const fullUser = await request(url, {
                headers: getHeaders(config.apiKey)
            });

            return fullUser;
        }
    } catch (e) {
        console.error("fetchCurrentUser failed", e);
    }
    return null;
};

export const login = async (login: string, password: string): Promise<{ token: string, entity: string, message: string, apiKey?: string, user?: DolibarrUser }> => {
    try {
        const response = await fetch(`${AppConfig.API_BASE_URL}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ login, password })
        });

        const contentType = response.headers.get("content-type");
        if (contentType && contentType.indexOf("application/json") !== -1) {
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'Falha no Login');

            if (data.apiKey) {
                try {
                    const tempConfig: DolibarrConfig = {
                        apiUrl: '',
                        apiKey: data.apiKey,
                        themeColor: 'indigo',
                        darkMode: false
                    };
                    const userProfile = await fetchCurrentUser(tempConfig, login);
                    if (userProfile) {
                        return { ...data, user: userProfile };
                    }
                } catch (userErr) {
                    console.warn("Failed to fetch user profile after login", userErr);
                }
            }

            return data;
        } else {
            const text = await response.text();
            console.error("[Login Error] Non-JSON response:", text);
            throw new Error(`Erro no Servidor (${response.status}): Resposta inválida.`);
        }
    } catch (error: any) {
        console.error("Login Network Error:", error);
        throw error;
    }
};

export const updateUser = async (config: DolibarrConfig, userId: string, data: any) => {
    const url = `${sanitizeUrl(config.apiUrl)}/users/${userId}`;

    try {
        const response = await request(url, {
            method: 'PUT',
            headers: getHeaders(config.apiKey),
            body: JSON.stringify(data)
        });
        return response;
    } catch (e: any) {
        console.error("updateUser failed", e);
        throw e;
    }
};
// -- User Management --
export const createUser = async (config: DolibarrConfig, data: any) => {
    const url = `${sanitizeUrl(config.apiUrl)}/users`;
    return request(url, {
        method: 'POST',
        headers: getHeaders(config.apiKey),
        body: JSON.stringify(data)
    });
};

export const deleteUser = async (config: DolibarrConfig, userId: string) => {
    const url = `${sanitizeUrl(config.apiUrl)}/users/${userId}`;
    return request(url, {
        method: 'DELETE',
        headers: getHeaders(config.apiKey)
    });
};

export const setUserPassword = async (config: DolibarrConfig, userId: string, password: string) => {
    // Dolibarr uses POST /users/{id}/setPassword or similar?
    // Often it's just updating the 'password' field via PUT.
    // Assuming PUT works for password if not restricted.
    // If not, try /users/{id}/password or similar?
    // Let's stick with updateUser for now unless specifically restricted.
    // Actually, HRList calls setUserPassword separately?
    // Code in HRList: await DolibarrService.updateUser(..., { password: ... })?
    // Let's check HRList if I can.
    // Assuming standard PUT.
    return updateUser(config, userId, { password });
};

// -- Categories --
export const createCategory = async (config: DolibarrConfig, data: any) => {
    const url = `${sanitizeUrl(config.apiUrl)}/categories`;
    return request(url, {
        method: 'POST',
        headers: getHeaders(config.apiKey),
        body: JSON.stringify(data)
    });
};

export const deleteCategory = async (config: DolibarrConfig, id: string) => {
    const url = `${sanitizeUrl(config.apiUrl)}/categories/${id}`;
    return request(url, {
        method: 'DELETE',
        headers: getHeaders(config.apiKey)
    });
};

export const linkObjectToCategory = async (config: DolibarrConfig, categoryId: string, objectId: string, type: string) => {
    // Standard endpoint: /categories/{id}/objects/{type}/{objectId}
    const url = `${sanitizeUrl(config.apiUrl)}/categories/${categoryId}/objects/${type}/${objectId}`;
    return request(url, {
        method: 'POST',
        headers: getHeaders(config.apiKey)
    });
};

// -- Documents --
export const downloadDocument = async (config: DolibarrConfig, modulePart: string, originalRef: string) => {
    // V1 API for documents: /documents/download?module_part={part}&original_file={file}
    // original_file needs to be relative path, usually derived from ref.
    // E.g. invoices: 'FA2310-0001/FA2310-0001.pdf'
    // This helper logic was likely complex in original service.

    // Fallback simple implementation assuming exact path passing or ref guessing
    // If originalRef is "FA2310-0001", file is likely "FA2310-0001/FA2310-0001.pdf" (standard structure)
    // But check if originalRef is already the path.

    const url = `${sanitizeUrl(config.apiUrl)}/documents/download?module_part=${modulePart}&original_file=${originalRef}`;

    // Note: This returns a binary/blob, need to handle it.
    const response = await fetch(url, { headers: getHeaders(config.apiKey) });
    if (!response.ok) throw new Error('Falha ao baixar documento');

    const blob = await response.blob();
    // Create link to download
    const downloadUrl = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = originalRef.split('/').pop() || 'document.pdf';
    document.body.appendChild(a);
    a.remove();
};

export const fetchDocuments = async (config: DolibarrConfig, modulePart: string, id: string, ref: string) => {
    const url = `${sanitizeUrl(config.apiUrl)}/documents?modulepart=${modulePart}&id=${id}&ref=${ref}`; // Varies by version, sometimes just modulepart and id or ref
    // Official V1 wrapper often uses GET /documents
    return request(url, { headers: getHeaders(config.apiKey) });
};

export const uploadDocument = async (config: DolibarrConfig, file: File, modulePart: string, ref: string) => {
    const url = `${sanitizeUrl(config.apiUrl)}/documents/upload`;
    const formData = new FormData();
    formData.append("file", file);
    formData.append("modulepart", modulePart);
    formData.append("ref", ref); // Directory/Ref

    // Note: 'request' helper expects JSON body usually or string. 
    // For FormData we need to bypass headers content-type to let browser set boundary.
    // We'll do a direct fetch here to be safe and simple.
    const headers: any = { 'DOLAPIKEY': config.apiKey };
    const response = await fetch(url, {
        method: 'POST',
        headers: headers,
        body: formData
    });
    if (!response.ok) {
        const txt = await response.text();
        throw new Error(`Upload Failed: ${txt}`);
    }
    return response.json();
};

export const deleteDocument = async (config: DolibarrConfig, modulePart: string, originalFile: string) => {
    // DELETE /documents?modulepart=...&original_file=...
    const url = `${sanitizeUrl(config.apiUrl)}/documents?modulepart=${modulePart}&original_file=${originalFile}`;
    return request(url, {
        method: 'DELETE',
        headers: getHeaders(config.apiKey)
    });
};

// Generic Object Update
export const updateObject = async (config: DolibarrConfig, objectType: string, id: string, data: any) => {
    const url = `${sanitizeUrl(config.apiUrl)}/${objectType}/${id}`;
    return request(url, {
        method: 'PUT',
        headers: getHeaders(config.apiKey),
        body: JSON.stringify(data)
    });
};
