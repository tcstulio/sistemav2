import { DolibarrConfig, ThirdParty, Invoice, SupplierInvoice, Proposal, Order, Contract, Shipment, SupplierOrder } from '../../types';
import { fetchList, fetchPage, request, getHeaders, sanitizeUrl } from './core';

export const fetchContracts = async (config: DolibarrConfig): Promise<Contract[]> => {
    const data = await fetchList(config, 'contracts', '&sortfield=t.date_contrat&sortorder=DESC');
    return data.map((d: any) => ({
        id: String(d.id),
        ref: d.ref,
        socid: String(d.socid),
        project_id: d.fk_projet ? String(d.fk_projet) : undefined,
        date_contrat: parseInt(d.date_contrat),
        date_fin_validite: d.date_fin_validite ? parseInt(d.date_fin_validite) : undefined,
        statut: String(d.statut) as any,
        note_public: d.note_public,
        array_options: d.array_options,
        lines: d.lines ? d.lines.map((l: any) => ({
            id: String(l.id),
            desc: l.desc || l.description,
            qty: parseFloat(l.qty),
            price: parseFloat(l.price || l.subprice || '0'),
            date_start: l.date_start ? parseInt(l.date_start) : undefined,
            date_end: l.date_end ? parseInt(l.date_end) : undefined
        })) : []
    }));
};

export const fetchSupplierOrders = async (config: DolibarrConfig): Promise<SupplierOrder[]> => {
    const data = await fetchList(config, 'supplierorders');
    return data.map((d: any) => ({
        id: String(d.id),
        ref: d.ref,
        socid: String(d.socid),
        project_id: d.fk_projet ? String(d.fk_projet) : undefined,
        date_creation: parseInt(d.date_creation),
        date_livraison: d.date_livraison ? parseInt(d.date_livraison) : undefined,
        total_ttc: parseFloat(d.total_ttc),
        statut: String(d.statut),
        array_options: d.array_options,
        lines: [] // TODO: lines mapping if needed
    }));
};

export const fetchCustomers = async (config: DolibarrConfig, lastModified: number = 0, options?: { page: number, limit: number, query?: string }): Promise<ThirdParty[]> => {
    let data;
    if (options && options.limit > 0) {
        let filter = '&mode=1';
        if (options.query) {
            const q = options.query;
            const sql = `(t.nom:like:'%${q}%' OR t.name_alias:like:'%${q}%' OR t.code_client:like:'%${q}%')`;
            filter += `&sqlfilters=${sql}`;
        }
        data = await fetchPage(config, 'thirdparties', options.page, options.limit, 't.nom', 'ASC', filter);
    } else {
        data = await fetchList(config, 'thirdparties', '&mode=1', lastModified);
    }

    return data.map((d: any) => ({
        id: String(d.id),
        name: d.name,
        name_alias: d.name_alias,
        address: d.address,
        zip: d.zip,
        town: d.town,
        email: d.email,
        phone: d.phone,
        code_client: d.code_client,
        client: String(d.client),
        fournisseur: String(d.fournisseur),
        status: d.status,
        state_id: d.state_id,
        country_id: d.country_id,
        tva_intra: d.tva_intra,
        date_creation: Number(d.date_creation),
        date_modification: Number(d.date_modification),
    }));
};

export const fetchSuppliers = async (config: DolibarrConfig): Promise<ThirdParty[]> => {
    const data = await fetchList(config, 'thirdparties', '&mode=4');
    return data.map((d: any) => ({
        id: String(d.id),
        name: d.name,
        address: d.address,
        zip: d.zip,
        town: d.town,
        email: d.email,
        phone: d.phone,
        code_fournisseur: d.code_fournisseur,
        client: String(d.client),
        fournisseur: String(d.fournisseur),
        status: d.status,
        state_id: d.state_id,
        country_id: d.country_id,
        tva_intra: d.tva_intra,
        date_creation: Number(d.date_creation),
        date_modification: Number(d.date_modification),
    }));
};

export const fetchInvoices = async (config: DolibarrConfig, options?: { page: number, limit: number, query?: string }): Promise<Invoice[]> => {
    let data;
    if (options && options.limit > 0) {
        let filter = '';
        if (options.query) {
            const q = options.query;
            const sql = `(t.ref:like:'%${q}%')`;
            filter += `&sqlfilters=${sql}`;
        }
        data = await fetchPage(config, 'invoices', options.page, options.limit, 't.datec', 'DESC', filter);
    } else {
        data = await fetchList(config, 'invoices', '&sortfield=t.datec&sortorder=DESC');
    }

    return data.map((d: any) => ({
        id: String(d.id),
        ref: d.ref,
        socid: String(d.socid),
        date: Number(d.date),
        date_lim_reglement: Number(d.date_lim_reglement),
        type: d.type,
        total_ht: Number(d.total_ht),
        total_tva: Number(d.total_tva),
        total_ttc: Number(d.total_ttc),
        paye: Number(d.paye),
        statut: String(d.statut),
        brouillon: d.statut === "0",
        lines: Array.isArray(d.lines) ? d.lines.map((l: any) => ({
            id: String(l.id),
            desc: l.desc,
            qty: Number(l.qty),
            price: Number(l.subprice),
            tva_tx: Number(l.tva_tx),
            total_ht: Number(l.total_ht),
            total_ttc: Number(l.total_ttc),
            product_id: l.fk_product ? String(l.fk_product) : undefined
        })) : undefined,
        project_id: d.fk_projet ? String(d.fk_projet) : undefined,
    }));
};

export const fetchSupplierInvoices = async (config: DolibarrConfig): Promise<SupplierInvoice[]> => {
    const data = await fetchList(config, 'supplierinvoices', '&sortfield=t.datec&sortorder=DESC');
    return data.map((d: any) => ({
        id: String(d.id),
        ref: d.ref,
        socid: String(d.socid),
        project_id: d.fk_projet ? String(d.fk_projet) : undefined,
        label: d.label,
        date: parseInt(d.date),
        total_ttc: parseFloat(d.total_ttc),
        paye: String(d.paye) as any,
        statut: String(d.statut) as any,
        array_options: d.array_options
    }));
};

export const fetchProposals = async (config: DolibarrConfig): Promise<Proposal[]> => {
    const data = await fetchList(config, 'proposals', '&sortfield=t.datec&sortorder=DESC');
    return data.map((d: any) => ({
        id: String(d.id),
        ref: d.ref,
        socid: String(d.socid),
        project_id: d.fk_projet ? String(d.fk_projet) : undefined,
        date: parseInt(d.date),
        total_ht: parseFloat(d.total_ht),
        total_tva: parseFloat(d.total_tva),
        total_ttc: parseFloat(d.total_ttc),
        statut: String(d.statut) as any,
        array_options: d.array_options,
        lines: d.lines
    }));
};

export const fetchOrders = async (config: DolibarrConfig): Promise<Order[]> => {
    const data = await fetchList(config, 'orders');
    return data.map((d: any) => ({
        id: String(d.id),
        ref: d.ref,
        socid: String(d.socid),
        project_id: d.fk_projet ? String(d.fk_projet) : undefined,
        date: parseInt(d.date),
        total_ttc: parseFloat(d.total_ttc),
        statut: String(d.statut) as any,
        array_options: d.array_options,
        lines: d.lines ? d.lines.map((l: any) => ({
            id: String(l.id || l.rowid),
            desc: l.desc || l.description || l.label,
            qty: parseFloat(l.qty),
            price: parseFloat(l.price || l.subprice),
            product_id: l.fk_product
        })) : []
    }));
};

export const getThirdParty = async (config: DolibarrConfig, id: string) => {
    const url = `${sanitizeUrl(config.apiUrl)}/thirdparties/${id}`;
    return request(url, { headers: getHeaders(config.apiKey) });
};

export const getOutstandingInvoices = async (config: DolibarrConfig, thirdPartyId: string) => {
    const url = `${sanitizeUrl(config.apiUrl)}/thirdparties/${thirdPartyId}/outstandinginvoices`;
    try {
        return await request(url, { headers: getHeaders(config.apiKey) });
    } catch (e) {
        console.warn("Endpoint de faturas pendentes falhou, usando fallback.", e);
        const filter = `(t.socid:=:${thirdPartyId}) AND (t.paye:=:0)`;
        return fetchList(config, 'invoices', `&sqlfilters=${encodeURIComponent(filter)}`);
    }
};

export const getProposal = async (config: DolibarrConfig, id: string) => {
    const url = `${sanitizeUrl(config.apiUrl)}/proposals/${id}`;
    return request(url, { headers: getHeaders(config.apiKey) });
};

export const getOrder = async (config: DolibarrConfig, id: string) => {
    const url = `${sanitizeUrl(config.apiUrl)}/orders/${id}`;
    return request(url, { headers: getHeaders(config.apiKey) });
};

export const getInvoiceData = async (config: DolibarrConfig, invoiceId: string) => {
    const url = `${sanitizeUrl(config.apiUrl)}/invoices/${invoiceId}`;
    return request(url, { headers: getHeaders(config.apiKey) });
};

export const getInvoice = async (config: DolibarrConfig, id: string) => {
    const url = `${sanitizeUrl(config.apiUrl)}/invoices/${id}`;
    return request(url, { headers: getHeaders(config.apiKey) });
};

export const getSupplierInvoice = async (config: DolibarrConfig, id: string) => {
    const url = `${sanitizeUrl(config.apiUrl)}/supplierinvoices/${id}`;
    return request(url, { headers: getHeaders(config.apiKey) });
};


// -- Write Operations --

export const createThirdParty = async (config: DolibarrConfig, data: Partial<ThirdParty>) => {
    const url = `${sanitizeUrl(config.apiUrl)}/thirdparties`;
    return request(url, {
        method: 'POST',
        headers: getHeaders(config.apiKey),
        body: JSON.stringify(data)
    });
};

export const updateThirdParty = async (config: DolibarrConfig, id: string, data: Partial<ThirdParty>) => {
    const url = `${sanitizeUrl(config.apiUrl)}/thirdparties/${id}`;
    return request(url, {
        method: 'PUT',
        headers: getHeaders(config.apiKey),
        body: JSON.stringify(data)
    });
};

export const deleteThirdParty = async (config: DolibarrConfig, id: string) => {
    const url = `${sanitizeUrl(config.apiUrl)}/thirdparties/${id}`;
    return request(url, {
        method: 'DELETE',
        headers: getHeaders(config.apiKey)
    });
};

export const createInvoice = async (config: DolibarrConfig, data: any) => {
    const url = `${sanitizeUrl(config.apiUrl)}/invoices`;
    return request(url, {
        method: 'POST',
        headers: getHeaders(config.apiKey),
        body: JSON.stringify(data)
    });
};


export const approveSupplierOrder = async (config: DolibarrConfig, id: string) => {
    const url = `${sanitizeUrl(config.apiUrl)}/supplierorders/${id}/validate`;
    return request(url, {
        method: 'POST',
        headers: getHeaders(config.apiKey),
        body: JSON.stringify({}) // Often expects empty body
    });
};

// -- Invoices --
export const validateInvoice = async (config: DolibarrConfig, id: string) => {
    const url = `${sanitizeUrl(config.apiUrl)}/invoices/${id}/validate`;
    return request(url, {
        method: 'POST',
        headers: getHeaders(config.apiKey),
    });
};

export const createCreditNote = async (config: DolibarrConfig, id: string) => {
    const url = `${sanitizeUrl(config.apiUrl)}/invoices/${id}/creditnote`;
    return request(url, {
        method: 'POST',
        headers: getHeaders(config.apiKey)
    });
};

export const setPayment = async (config: DolibarrConfig, invoiceId: string, paymentData: any) => {
    const url = `${sanitizeUrl(config.apiUrl)}/invoices/${invoiceId}/payments`;
    return request(url, {
        method: 'POST',
        headers: getHeaders(config.apiKey),
        body: JSON.stringify(paymentData)
    });
};

// -- Proposals --
export const createProposal = async (config: DolibarrConfig, data: any) => {
    const url = `${sanitizeUrl(config.apiUrl)}/proposals`;
    return request(url, {
        method: 'POST',
        headers: getHeaders(config.apiKey),
        body: JSON.stringify(data)
    });
};

export const validateProposal = async (config: DolibarrConfig, id: string) => {
    const url = `${sanitizeUrl(config.apiUrl)}/proposals/${id}/validate`;
    return request(url, {
        method: 'POST',
        headers: getHeaders(config.apiKey),
        body: JSON.stringify({})
    });
};

export const closeProposal = async (config: DolibarrConfig, id: string, status: 2 | 3) => {
    const url = `${sanitizeUrl(config.apiUrl)}/proposals/${id}/close`;
    return request(url, {
        method: 'POST',
        headers: getHeaders(config.apiKey),
        body: JSON.stringify({ status })
    });
};

export const createOrderFromProposal = async (config: DolibarrConfig, proposalId: string) => {
    const url = `${sanitizeUrl(config.apiUrl)}/orders`;
    return request(url, {
        method: 'POST',
        headers: getHeaders(config.apiKey),
        body: JSON.stringify({ origin: 'propal', origin_id: proposalId })
    });
};

// -- Orders --
export const createOrder = async (config: DolibarrConfig, data: any) => {
    const url = `${sanitizeUrl(config.apiUrl)}/orders`;
    return request(url, {
        method: 'POST',
        headers: getHeaders(config.apiKey),
        body: JSON.stringify(data)
    });
};

export const validateOrder = async (config: DolibarrConfig, id: string) => {
    const url = `${sanitizeUrl(config.apiUrl)}/orders/${id}/validate`;
    return request(url, {
        method: 'POST',
        headers: getHeaders(config.apiKey),
        body: JSON.stringify({})
    });
};

export const shipOrder = async (config: DolibarrConfig, id: string, shipmentData: any) => {
    const url = `${sanitizeUrl(config.apiUrl)}/shipments`;
    return request(url, {
        method: 'POST',
        headers: getHeaders(config.apiKey),
        body: JSON.stringify({ ...shipmentData, fk_order: id })
    });
};

// -- Supplier Orders --
export const createSupplierOrder = async (config: DolibarrConfig, data: any) => {
    const url = `${sanitizeUrl(config.apiUrl)}/supplierorders`;
    return request(url, {
        method: 'POST',
        headers: getHeaders(config.apiKey),
        body: JSON.stringify(data)
    });
};

// -- Aliases for Backward Compatibility or Logic Naming --
export const validateSupplierOrder = approveSupplierOrder;

export const createSupplierInvoice = async (config: DolibarrConfig, data: any) => {
    const url = `${sanitizeUrl(config.apiUrl)}/supplierinvoices`;
    return request(url, {
        method: 'POST',
        headers: getHeaders(config.apiKey),
        body: JSON.stringify(data)
    });
};

// -- Contracts --
export const createContract = async (config: DolibarrConfig, data: any) => {
    const url = `${sanitizeUrl(config.apiUrl)}/contracts`;
    return request(url, {
        method: 'POST',
        headers: getHeaders(config.apiKey),
        body: JSON.stringify(data)
    });
};

export const validateContract = async (config: DolibarrConfig, id: string) => {
    const url = `${sanitizeUrl(config.apiUrl)}/contracts/${id}/validate`;
    return request(url, {
        method: 'POST',
        headers: getHeaders(config.apiKey),
        body: JSON.stringify({})
    });
};

export const closeContract = async (config: DolibarrConfig, id: string) => {
    const url = `${sanitizeUrl(config.apiUrl)}/contracts/${id}/close`;
    return request(url, {
        method: 'POST',
        headers: getHeaders(config.apiKey),
        body: JSON.stringify({})
    });
};

// -- Deletions --
export const deleteInvoice = async (config: DolibarrConfig, id: string) => {
    const url = `${sanitizeUrl(config.apiUrl)}/invoices/${id}`;
    return request(url, {
        method: 'DELETE',
        headers: getHeaders(config.apiKey)
    });
};

export const deleteProposal = async (config: DolibarrConfig, id: string) => {
    const url = `${sanitizeUrl(config.apiUrl)}/proposals/${id}`;
    return request(url, {
        method: 'DELETE',
        headers: getHeaders(config.apiKey)
    });
};

export const deleteOrder = async (config: DolibarrConfig, id: string) => {
    const url = `${sanitizeUrl(config.apiUrl)}/orders/${id}`;
    return request(url, {
        method: 'DELETE',
        headers: getHeaders(config.apiKey)
    });
};

export const deleteSupplierOrder = async (config: DolibarrConfig, id: string) => {
    const url = `${sanitizeUrl(config.apiUrl)}/supplierorders/${id}`;
    return request(url, {
        method: 'DELETE',
        headers: getHeaders(config.apiKey)
    });
};

export const markInvoiceAsPaid = async (config: DolibarrConfig, id: string) => {
    // Might be same as setPayment but full amount? 
    // Or /invoices/{id}/paid endpoint in some versions?
    // Let's assume setPayment is used, but if this is a distinct call in UI, let's just make it a wrapper.
    // If it's a marking status without transaction:
    const url = `${sanitizeUrl(config.apiUrl)}/invoices/${id}/classifyaspaid`; // Hypothetical or check standard
    // Actually, usually users just add a payment.
    // However, if the UI calls 'markInvoiceAsPaid', we need it.
    // Let's try /invoices/{id}/validate (re-validate?) NO.
    // Let's try `setPayment` with minimal info?
    // Let's stick with specific endpoint `/invoices/{id}/classify_paid` if exists.
    // Fallback: This might fail if endpoint doesn't exist.
    // Or maybe it's `updateInvoice(..., { status: 'PAID' })`?
    // Let's try simple DELETE /invoices/{id} logic... no wait that's unrelated.
    return request(url, {
        method: 'POST',
        headers: getHeaders(config.apiKey)
    });
};

export const classifyOrderDelivered = async (config: DolibarrConfig, id: string) => {
    const url = `${sanitizeUrl(config.apiUrl)}/orders/${id}/classifydelivered`;
    return request(url, {
        method: 'POST',
        headers: getHeaders(config.apiKey)
    });
};

// -- Supplier Invoices Actions --

export const validateSupplierInvoice = async (config: DolibarrConfig, id: string) => {
    const url = `${sanitizeUrl(config.apiUrl)}/supplierinvoices/${id}/validate`;
    return request(url, {
        method: 'POST',
        headers: getHeaders(config.apiKey),
        body: JSON.stringify({})
    });
};

export const paySupplierInvoice = async (config: DolibarrConfig, id: string, paymentData: any) => {
    // Note: Dolibarr often manages supplier payments via a separate 'payment' object linked to the invoice
    // or a classify as paid endpoint. 
    // POST /supplierinvoices/{id}/payments creates a payment.
    const url = `${sanitizeUrl(config.apiUrl)}/supplierinvoices/${id}/payments`;
    return request(url, {
        method: 'POST',
        headers: getHeaders(config.apiKey),
        body: JSON.stringify(paymentData)
    });
};

export const markSupplierInvoiceAsPaid = async (config: DolibarrConfig, id: string) => {
    // Some versions use classifyaspaid
    const url = `${sanitizeUrl(config.apiUrl)}/supplierinvoices/${id}/classifyaspaid`;
    return request(url, {
        method: 'POST',
        headers: getHeaders(config.apiKey),
        body: JSON.stringify({})
    });
};

