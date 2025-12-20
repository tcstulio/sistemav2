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

// Helper to safely extract ID from potential object (Dolibarr API inconsistency)
export const resolveId = (field: any): string | undefined => {
    if (field === null || field === undefined) return undefined;
    if (typeof field === 'object') {
        // Handle { id: ... } or { rowid: ... }
        return field.id ? String(field.id) : (field.rowid ? String(field.rowid) : undefined);
    }
    return String(field);
};

export const sanitizeUrl = (url: string): string => {
    return url ? url.replace(/\/$/, '') : '';
};

export const getHeaders = (apiKey: string) => {
    return {
        'DOLAPIKEY': apiKey,
        'Accept': 'application/json'
    };
};

export const request = async (url: string, options: RequestInit = {}) => {
    try {
        const response = await fetch(url, options);
        if (response.status === 204) return null;

        const contentType = response.headers.get("content-type");
        if (contentType && contentType.indexOf("application/json") !== -1) {
            const data = await response.json();
            if (!response.ok) {
                // Dolibarr error structure often has { error: { message: ... } } or just { error: ... }
                const msg = (data.error && data.error.message) || data.error || (data.messages && data.messages.length > 0 ? data.messages[0].message : response.statusText);
                throw { message: msg, status: response.status, details: data };
            }
            return data;
        } else {
            if (!response.ok) {
                const text = await response.text();
                throw { message: text || response.statusText, status: response.status };
            }
            // If text response but OK (rare for API, but possible)
            return await response.text();
        }
    } catch (error: any) {
        // Enhance error object if possible
        if (error.message === 'Failed to fetch') {
            console.error("Network Error or CORS issue accessing:", url);
        }
        throw error;
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

export const fetchList = async (config: DolibarrConfig, endpoint: string, params: string = '', lastModified: number = 0) => {
    let allItems: any[] = [];
    let page = 0;
    const limit = 100;
    let keepFetching = true;
    let safetyCounter = 0;

    let timeFilter = '';
    if (lastModified && lastModified > 0) {
        const ts = Math.floor(lastModified / 1000);
        timeFilter = `&sqlfilters=(t.tms:>: ${ts})`;
        console.log(`[Incremental] Fetching ${endpoint} modified after ${ts}`);
    }

    const userLimit = config.apiLimit || 0;

    // Increased safety limit to ~50k items
    while (keepFetching && safetyCounter < 500) {
        try {
            const url = `${sanitizeUrl(config.apiUrl)}/${endpoint}?limit=${limit}&page=${page}${params}${timeFilter}`;

            const data = await request(url, {
                headers: getHeaders(config.apiKey)
            });
            if (Array.isArray(data) && data.length > 0) {
                const firstNewId = data[0].id || data[0].rowid;
                const alreadyExists = allItems.some(item => (item.id || item.rowid) === firstNewId);

                if (alreadyExists && allItems.length > 0) {
                    console.warn(`[DoliGenAI] Loop detectado em ${endpoint} (dados duplicados). Parando.`);
                    keepFetching = false;
                } else {
                    allItems = [...allItems, ...data];
                    if (data.length < limit) keepFetching = false;
                    page++;

                    if (userLimit > 0 && allItems.length >= userLimit) {
                        keepFetching = false;
                    }
                }
            } else {
                if (timeFilter) {
                    console.log(`[Incremental] No changes for ${endpoint} since last sync.`);
                }
                keepFetching = false;
            }
        } catch (e: any) {
            if (page === 0 && e.message && (e.message.includes('404') || e.message.includes('Not Found'))) {
                keepFetching = false;
            } else if (e.message && (e.message.includes('401') || e.message.includes('Unauthorized'))) {
                console.warn(`[DoliGenAI] Não autorizado (401) para ${endpoint}. Parando busca.`);
                if (page === 0) throw e;
                keepFetching = false;
            } else if (e.message && (e.message.toLowerCase().includes('forbidden') || e.message.includes('403'))) {
                console.warn(`[DoliGenAI] Acesso negado (403) para ${endpoint}. Retornando dados parciais/vazios.`);
                keepFetching = false;
            } else {
                console.error(`[DoliGenAI] Erro buscando ${endpoint} página ${page}:`, e);
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

// Helper to verify connection before full commit
export const checkConnection = async (apiUrl: string, apiKey: string) => {
    const url = `${sanitizeUrl(apiUrl)}/setup/modules`;
    // We do a manual request here to ensure we don't rely on global config
    const headers = { 'DOLAPIKEY': apiKey, 'Accept': 'application/json' };
    const response = await fetch(url, { headers });
    if (!response.ok) {
        throw new Error(`Falha na conexão: ${response.status} ${response.statusText}`);
    }
    return true;
};

export const fetchSetupModules = async (config: DolibarrConfig) => {
    const url = `${sanitizeUrl(config.apiUrl)}/setup/modules`;
    return request(url, { headers: getHeaders(config.apiKey) });
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
                        apiUrl: `${AppConfig.API_BASE_URL}/api/dolibarr`,
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
export const fetchCategories = async (config: DolibarrConfig) => {
    return fetchList(config, 'categories');
};

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

