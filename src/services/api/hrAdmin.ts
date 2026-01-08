import { DolibarrConfig, BankAccount, Contact, Invoice, SupplierInvoice, BankLine, Candidate, DolibarrUser, ExpenseReport, RecruitmentJobPosition, LeaveRequest } from '../../types';
import { fetchList, fetchPage, request, getHeaders, sanitizeUrl } from './core';

export const fetchUsers = async (config: DolibarrConfig): Promise<DolibarrUser[]> => {
    const data = await fetchList(config, 'users');
    return data.map((d: any) => ({
        id: String(d.id),
        login: d.login,
        firstname: d.firstname,
        lastname: d.lastname,
        email: d.email,
        phone_mobile: d.phone_mobile,
        photo: d.photo,
        statut: String(d.statut) as any,
        job: d.job,
        admin: d.admin,
        array_options: d.array_options,
        rights: d.rights
    }));
};

export const fetchExpenseReports = async (config: DolibarrConfig): Promise<ExpenseReport[]> => {
    const data = await fetchList(config, 'expensereports');
    return data.map((d: any) => ({
        id: String(d.id),
        ref: d.ref,
        fk_user_author: String(d.fk_user_author),
        project_id: d.fk_projet ? String(d.fk_projet) : undefined,
        date_debut: parseInt(d.date_debut),
        date_fin: parseInt(d.date_fin),
        date_paye: d.date_paye ? parseInt(d.date_paye) : undefined,
        total_ttc: parseFloat(d.total_ttc),
        statut: String(d.statut_code || d.statut),
        note_public: d.note_public,
        array_options: d.array_options,
        raw: d
    }));
};

export const fetchJobPositions = async (config: DolibarrConfig): Promise<RecruitmentJobPosition[]> => {
    // Uses V2 API endpoint without 'date_modification' support, so we use fetchPage instead of fetchList (sync)
    // to avoid the incremental sync loop that fails when sort/filter by date is missing.
    const data = await fetchPage(config, 'recruitments/jobposition', 0, 100);
    return data.map((d: any) => ({
        id: String(d.id),
        ref: d.ref,
        label: d.label,
        qty: parseInt(d.qty || '1'),
        status: String(d.status),
        date_creation: parseInt(d.date_creation),
        description: d.description,
        array_options: d.array_options
    }));
};

export const fetchCandidates = async (config: DolibarrConfig): Promise<Candidate[]> => {
    // Similarly for candidates, use fetchPage to ensure we get data without relying on 'date_modification' sync logic
    const data = await fetchPage(config, 'recruitments/candidature', 0, 100);
    return data.map((d: any) => mapCandidate(d));
};

export const fetchLeaveRequests = async (config: DolibarrConfig): Promise<LeaveRequest[]> => {
    const data = await fetchList(config, 'holiday');
    return data.map((d: any) => ({
        id: String(d.id),
        ref: d.ref,
        fk_user: String(d.fk_user),
        date_debut: parseInt(d.date_debut),
        date_fin: parseInt(d.date_fin),
        type: d.type,
        statut: String(d.statut || d.statut_code) as any,
        description: d.description,
        duration: parseFloat(d.duration)
    }));
};

export const fetchContacts = async (config: DolibarrConfig): Promise<Contact[]> => {
    const data = await fetchList(config, 'contacts');
    return data.map((d: any) => ({
        id: String(d.id),
        socid: String(d.socid),
        lastname: d.lastname,
        firstname: d.firstname,
        email: d.email,
        phone_mobile: d.phone_mobile,
        poste: d.poste,
        statut: String(d.statut) as any,
        array_options: d.array_options
    }));
};

// Helper function
export const mapCandidate = (raw: any): Candidate => {
    let jobId = raw.fk_recruitment_jobposition || raw.fk_job_position || raw.fk_job || '';

    if (typeof jobId === 'number') {
        jobId = String(jobId);
    }

    if (typeof jobId === 'object' && jobId !== null && jobId.id) {
        jobId = String(jobId.id);
    }

    return {
        id: String(raw.id || raw.rowid || ''),
        fk_job_position: jobId,
        firstname: raw.firstname || '',
        lastname: raw.lastname || '',
        email: raw.email || '',
        phone: raw.phone || raw.phone_mobile,
        status: raw.status_label || raw.status || 'APPLIED',
        date_c: parseInt(raw.date_creation || raw.datec || '0'),
        cv_text: raw.note_public || '',
        rating: 0,
        ai_match_score: 0,
        raw: raw
    };
};

export const fetchBankAccounts = async (config: DolibarrConfig): Promise<BankAccount[]> => {
    const data = await fetchList(config, 'bankaccounts');
    return data.map((d: any) => ({
        id: String(d.id),
        ref: d.ref,
        label: d.label,
        bank: d.bank,
        number: d.number,
        currency_code: d.currency_code,
        solde: parseFloat(d.solde || '0'),
        status: String(d.status) as any,
        array_options: d.array_options
    }));
};

export const fetchBankLines = async (config: DolibarrConfig, accountIds: string[], invoices: Invoice[], supplierInvoices: SupplierInvoice[]): Promise<BankLine[]> => {
    const lines: BankLine[] = [];
    try {
        for (const id of accountIds) {
            const data = await fetchList(config, `bankaccounts/${id}/lines`);
            if (Array.isArray(data)) {
                data.forEach((d: any) => {
                    lines.push({
                        id: String(d.id),
                        date_operation: parseInt(d.date_operation),
                        date_value: d.date_value ? parseInt(d.date_value) : undefined,
                        label: d.label,
                        amount: parseFloat(d.amount),
                        fk_bank: String(id),
                        reconciled: d.reconciled === '1',
                        fk_account: String(id)
                    });
                });
            }
        }
    } catch (e) {
        console.warn("Falha ao buscar linhas bancárias (erro de permissão?)", e);
    }
    return lines;
};

export const getContact = async (config: DolibarrConfig, id: string) => {
    const url = `${sanitizeUrl(config.apiUrl)}/contacts/${id}`;
    return request(url, { headers: getHeaders(config.apiKey) });
};

// -- Write Operations --

export const createBankAccount = async (config: DolibarrConfig, data: any) => {
    const url = `${sanitizeUrl(config.apiUrl)}/bankaccounts`;
    return request(url, {
        method: 'POST',
        headers: getHeaders(config.apiKey),
        body: JSON.stringify(data)
    });
};

export const createExpenseReport = async (config: DolibarrConfig, data: any) => {
    const url = `${sanitizeUrl(config.apiUrl)}/expensereports`;
    return request(url, {
        method: 'POST',
        headers: getHeaders(config.apiKey),
        body: JSON.stringify(data)
    });
};

export const validateExpenseReport = async (config: DolibarrConfig, id: string) => {
    // API endpoint might differ, assuming standard
    const url = `${sanitizeUrl(config.apiUrl)}/expensereports/${id}/validate`;
    return request(url, {
        method: 'POST',
        headers: getHeaders(config.apiKey),
        body: JSON.stringify({})
    });
};

export const createLeaveRequest = async (config: DolibarrConfig, data: any) => {
    // Standard V1 endpoint usually /holiday
    const url = `${sanitizeUrl(config.apiUrl)}/holiday`;
    return request(url, {
        method: 'POST',
        headers: getHeaders(config.apiKey),
        body: JSON.stringify(data)
    });
};

export const approveLeaveRequest = async (config: DolibarrConfig, id: string) => {
    const url = `${sanitizeUrl(config.apiUrl)}/holiday/${id}/approve`;
    return request(url, {
        method: 'POST',
        headers: getHeaders(config.apiKey),
        body: JSON.stringify({})
    });
};

export const validateLeaveRequest = async (config: DolibarrConfig, id: string) => {
    const url = `${sanitizeUrl(config.apiUrl)}/holiday/${id}/validate`;
    return request(url, {
        method: 'POST',
        headers: getHeaders(config.apiKey),
        body: JSON.stringify({})
    });
};

export const refuseLeaveRequest = async (config: DolibarrConfig, id: string, reason?: string) => {
    const url = `${sanitizeUrl(config.apiUrl)}/holiday/${id}/refuse`;
    return request(url, {
        method: 'POST',
        headers: getHeaders(config.apiKey),
        body: JSON.stringify({ detail_refuse: reason })
    });
};

export const createCandidate = async (config: DolibarrConfig, data: any) => {
    const url = `${sanitizeUrl(config.apiUrl)}/recruitmentcandidates`;
    return request(url, {
        method: 'POST',
        headers: getHeaders(config.apiKey),
        body: JSON.stringify(data)
    });
};

export const createJobPosition = async (config: DolibarrConfig, data: any) => {
    const url = `${sanitizeUrl(config.apiUrl)}/recruitmentjobpositions`;
    return request(url, {
        method: 'POST',
        headers: getHeaders(config.apiKey),
        body: JSON.stringify(data)
    });
};

// -- Contacts --
export const createContact = async (config: DolibarrConfig, data: any) => {
    const url = `${sanitizeUrl(config.apiUrl)}/contacts`;
    return request(url, {
        method: 'POST',
        headers: getHeaders(config.apiKey),
        body: JSON.stringify(data)
    });
};

export const updateContact = async (config: DolibarrConfig, id: string, data: any) => {
    const url = `${sanitizeUrl(config.apiUrl)}/contacts/${id}`;
    return request(url, {
        method: 'PUT',
        headers: getHeaders(config.apiKey),
        body: JSON.stringify(data)
    });
};

// -- Deletions --
export const deleteContact = async (config: DolibarrConfig, id: string) => {
    const url = `${sanitizeUrl(config.apiUrl)}/contacts/${id}`;
    return request(url, {
        method: 'DELETE',
        headers: getHeaders(config.apiKey)
    });
};

export const deleteLeaveRequest = async (config: DolibarrConfig, id: string) => {
    const url = `${sanitizeUrl(config.apiUrl)}/holiday/${id}`;
    return request(url, {
        method: 'DELETE',
        headers: getHeaders(config.apiKey)
    });
};

export const deleteExpenseReport = async (config: DolibarrConfig, id: string) => {
    const url = `${sanitizeUrl(config.apiUrl)}/expensereports/${id}`;
    return request(url, {
        method: 'DELETE',
        headers: getHeaders(config.apiKey)
    });
};

export const deleteBankAccount = async (config: DolibarrConfig, id: string) => {
    const url = `${sanitizeUrl(config.apiUrl)}/bankaccounts/${id}`;
    return request(url, {
        method: 'DELETE',
        headers: getHeaders(config.apiKey)
    });
};

export const createPayment = async (config: DolibarrConfig, data: any) => {
    const url = `${sanitizeUrl(config.apiUrl)}/payments`;
    return request(url, {
        method: 'POST',
        headers: getHeaders(config.apiKey),
        body: JSON.stringify(data)
    });
};

export const createBankTransfer = async (config: DolibarrConfig, fromId: string, toId: string, amount: number, date: number, label: string) => {
    const url = `${sanitizeUrl(config.apiUrl)}/bankaccounts/transfer`;
    return request(url, {
        method: 'POST',
        headers: getHeaders(config.apiKey),
        body: JSON.stringify({
            bank_account_from_id: fromId,
            bank_account_to_id: toId,
            amount: amount,
            date: date,
            label: label
        })
    });
};

export const addBankLine = async (config: DolibarrConfig, accountId: string, date: number, type: string, label: string, amount: number) => {
    const url = `${sanitizeUrl(config.apiUrl)}/bankaccounts/${accountId}/lines`;
    return request(url, {
        method: 'POST',
        headers: getHeaders(config.apiKey),
        body: JSON.stringify({
            date: date,
            type: type,
            label: label,
            amount: amount
        })
    });
};

export const approveExpenseReport = async (config: DolibarrConfig, id: string) => {
    const url = `${sanitizeUrl(config.apiUrl)}/expensereports/${id}/approve`;
    return request(url, {
        method: 'POST',
        headers: getHeaders(config.apiKey),
        body: JSON.stringify({})
    });
};

export const markExpenseReportAsPaid = async (config: DolibarrConfig, id: string) => {
    const url = `${sanitizeUrl(config.apiUrl)}/expensereports/${id}/paid`;
    return request(url, {
        method: 'POST',
        headers: getHeaders(config.apiKey),
        body: JSON.stringify({})
    });
};

/* --- GROUPS --- */

export const createGroup = async (config: DolibarrConfig, data: any) => {
    // Endpoint usually /users/groups
    const url = `${sanitizeUrl(config.apiUrl)}/users/groups`;
    return request(url, {
        method: 'POST',
        headers: getHeaders(config.apiKey),
        body: JSON.stringify(data)
    });
};

export const updateGroup = async (config: DolibarrConfig, id: string, data: any) => {
    const url = `${sanitizeUrl(config.apiUrl)}/users/groups/${id}`;
    return request(url, {
        method: 'PUT',
        headers: getHeaders(config.apiKey),
        body: JSON.stringify(data)
    });
};

export const deleteGroup = async (config: DolibarrConfig, id: string) => {
    const url = `${sanitizeUrl(config.apiUrl)}/users/groups/${id}`;
    return request(url, {
        method: 'DELETE',
        headers: getHeaders(config.apiKey)
    });
};

export const addUserToGroup = async (config: DolibarrConfig, groupId: string, userId: string) => {
    const url = `${sanitizeUrl(config.apiUrl)}/users/groups/${groupId}/users/${userId}`;
    return request(url, {
        method: 'POST',
        headers: getHeaders(config.apiKey)
    });
};

export const removeUserFromGroup = async (config: DolibarrConfig, groupId: string, userId: string) => {
    const url = `${sanitizeUrl(config.apiUrl)}/users/groups/${groupId}/users/${userId}`;
    return request(url, {
        method: 'DELETE',
        headers: getHeaders(config.apiKey)
    });
};

/* --- PERMISSIONS --- */

// Add Permission (to User or Group)
// For User: POST /users/{id}/rights/{rightId} (or rightsdef id?)
// For Group: POST /users/groups/{id}/rights/{rightId}
// Note: Standard API is tricky with rights. Often requires module trigger.
// Checking common format: POST /users/{id}/rights is used to add. But often needs body with right ID or module.
// Assume endpoint /users/{id}/rights/{right_id} logic works if right_id is passed.

export const addPermissionToUser = async (config: DolibarrConfig, userId: string, rightId: string) => {
    const url = `${sanitizeUrl(config.apiUrl)}/users/${userId}/rights/${rightId}`;
    return request(url, {
        method: 'POST',
        headers: getHeaders(config.apiKey)
    });
};

export const removePermissionFromUser = async (config: DolibarrConfig, userId: string, rightId: string) => {
    const url = `${sanitizeUrl(config.apiUrl)}/users/${userId}/rights/${rightId}`;
    return request(url, {
        method: 'DELETE',
        headers: getHeaders(config.apiKey)
    });
};

export const addPermissionToGroup = async (config: DolibarrConfig, groupId: string, rightId: string) => {
    const url = `${sanitizeUrl(config.apiUrl)}/users/groups/${groupId}/rights/${rightId}`;
    return request(url, {
        method: 'POST',
        headers: getHeaders(config.apiKey)
    });
};

export const removePermissionFromGroup = async (config: DolibarrConfig, groupId: string, rightId: string) => {
    const url = `${sanitizeUrl(config.apiUrl)}/users/groups/${groupId}/rights/${rightId}`;
    return request(url, {
        method: 'DELETE',
        headers: getHeaders(config.apiKey)
    });
};
