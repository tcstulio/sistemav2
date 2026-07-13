/**
 * Dolibarr Service - Commercial Module
 * 
 * Methods for invoices, proposals, orders, and contracts.
 */

import axios from 'axios';
import { DolibarrServiceBase, CreateInvoiceModel, CloseProposalModel, buildLikeFilter } from './core';
import { createLogger } from '../../utils/logger';

const log = createLogger('DolibarrCommercial');

export class DolibarrCommercialService extends DolibarrServiceBase {

    async createInvoice(data: CreateInvoiceModel, userKey?: string) {
        const url = `${this.baseUrl}invoices`;
        return this.requestWithAuth('POST', url, data, userKey);
    }

    async closeProposal(proposalId: string, data: CloseProposalModel, userKey?: string) {
        const url = `${this.baseUrl}proposals/${proposalId}/close`;
        return this.requestWithAuth('POST', url, data, userKey);
    }

    async getInvoice(id: string): Promise<any | null> {
        try {
            const headers = this.getHeaders();
            const url = `${this.baseUrl}invoices/${id}`;

            const response = await axios.get(url, {
                headers,
                httpsAgent: this.httpsAgent,
                validateStatus: (s) => s === 200 || s === 404
            });

            if (response.status === 200 && response.data) {
                return response.data;
            }
            return null;
        } catch (error: any) {
            log.error(`GetInvoice Error for ${id}`, error.message);
            return null;
        }
    }

    async getOrder(id: string): Promise<any | null> {
        try {
            const headers = this.getHeaders();
            const url = `${this.baseUrl}orders/${id}`;

            const response = await axios.get(url, {
                headers,
                httpsAgent: this.httpsAgent,
                validateStatus: (s) => s === 200 || s === 404
            });

            if (response.status === 200 && response.data) {
                return response.data;
            }
            return null;
        } catch (error: any) {
            log.error(`GetOrder Error for ${id}`, error.message);
            return null;
        }
    }

    async getProposal(id: string): Promise<any | null> {
        try {
            const headers = this.getHeaders();
            const url = `${this.baseUrl}proposals/${id}`;

            const response = await axios.get(url, {
                headers,
                httpsAgent: this.httpsAgent,
                validateStatus: (s) => s === 200 || s === 404
            });

            if (response.status === 200 && response.data) {
                return response.data;
            }
            return null;
        } catch (error: any) {
            log.error(`GetProposal Error for ${id}`, error.message);
            return null;
        }
    }

    async listInvoices(params: { status?: string, search?: string, limit?: number } = {}): Promise<any[]> {
        const headers = this.getHeaders();
        const url = `${this.baseUrl}invoices`;
        const sqlfiltersParts: string[] = [];

        if (params.status === 'unpaid') sqlfiltersParts.push('(t.paye:=:0) and (t.fk_statut:>:0)');
        if (params.status === 'paid') sqlfiltersParts.push('(t.paye:=:1)');
        if (params.status === 'draft') sqlfiltersParts.push('(t.fk_statut:=:0)');

        // #1340: sem este filtro, uma busca por texto (ex.: ref de proposta) caía num LISTAGEM
        // GLOBAL das faturas mais recentes — a tool `search` do agente as rotulava como
        // "resultado do termo", enganando o modelo. Busca por ref/ref_client (como listOrders).
        if (params.search) {
            sqlfiltersParts.push(`((${buildLikeFilter('t.ref', params.search)}) or (${buildLikeFilter('t.ref_client', params.search)}))`);
        }

        // #1349: Dolibarr devolve 404 quando não há faturas para o filtro → tratamos como []
        // legitimamente. 5xx/401/403/timeout/rede NÃO são silenciados: devem propagar para que
        // prepare_create_* não confunda "erro" com "não existe" e crie duplicatas.
        const response = await axios.get(url, {
            headers,
            params: {
                sqlfilters: sqlfiltersParts.length > 0 ? sqlfiltersParts.join(' and ') : undefined,
                limit: params.limit || 5,
                sortfield: 't.datef',
                sortorder: 'DESC'
            },
            httpsAgent: this.httpsAgent,
            validateStatus: (s) => s === 200 || s === 404
        });

        if (response.status === 404) return [];
        return Array.isArray(response.data) ? response.data : [];
    }

    async listOrders(params: { status?: string, search?: string, limit?: number } = {}): Promise<any[]> {
        const headers = this.getHeaders();
        const url = `${this.baseUrl}orders`;
        const sqlfiltersParts: string[] = [];

        if (params.status === 'draft') sqlfiltersParts.push('(t.fk_statut:=:0)');
        if (params.status === 'validated') sqlfiltersParts.push('(t.fk_statut:=:1)');
        if (params.status === 'processed') sqlfiltersParts.push('(t.fk_statut:>=:2)');

        if (params.search) {
            sqlfiltersParts.push(`((${buildLikeFilter('t.ref', params.search)}) or (${buildLikeFilter('t.ref_client', params.search)}))`);
        }

        // #1349: idem listInvoices — 404 = "sem pedidos"; erros reais devem propagar.
        const response = await axios.get(url, {
            headers,
            params: {
                sqlfilters: sqlfiltersParts.length > 0 ? sqlfiltersParts.join(' and ') : undefined,
                limit: params.limit || 5,
                sortfield: 't.date_commande',
                sortorder: 'DESC'
            },
            httpsAgent: this.httpsAgent,
            validateStatus: (s) => s === 200 || s === 404
        });

        if (response.status === 404) return [];
        return Array.isArray(response.data) ? response.data : [];
    }

    async listProposals(params: { status?: string, search?: string, limit?: number } = {}): Promise<any[]> {
        const headers = this.getHeaders();
        const url = `${this.baseUrl}proposals`;
        let sqlfilters: string | undefined = undefined;

        if (params.status === 'draft') sqlfilters = '(t.fk_statut:=:0)';
        if (params.status === 'open') sqlfilters = '(t.fk_statut:=:1)';
        if (params.status === 'signed') sqlfilters = '(t.fk_statut:=:2)';

        if (params.search) {
            const searchFilter = `((${buildLikeFilter('t.ref', params.search)}) or (${buildLikeFilter('t.ref_client', params.search)}))`;
            sqlfilters = sqlfilters ? `(${sqlfilters}) and ${searchFilter}` : searchFilter;
        }

        // #1349: idem listInvoices. Atenção especial: listProposals alimenta prepare_create_*
        // → erro real NÃO pode virar "vazio" silencioso (risco de duplicata).
        const response = await axios.get(url, {
            headers,
            params: {
                sqlfilters,
                limit: params.limit || 5,
                sortfield: 't.datep',
                sortorder: 'DESC'
            },
            httpsAgent: this.httpsAgent,
            validateStatus: (s) => s === 200 || s === 404
        });

        if (response.status === 404) return [];
        return Array.isArray(response.data) ? response.data : [];
    }

    async listContracts(search?: string): Promise<any[]> {
        const headers = this.getHeaders();
        const url = `${this.baseUrl}contracts`;
        let sqlfilters: string | undefined = undefined;
        if (search) {
            sqlfilters = `(${buildLikeFilter('t.ref', search)})`;
        }

        // #1349: idem listInvoices — 404 = "sem contratos"; erros reais devem propagar.
        const response = await axios.get(url, {
            headers,
            params: { sqlfilters, limit: 5, sortfield: 't.date_contrat', sortorder: 'DESC' },
            httpsAgent: this.httpsAgent,
            validateStatus: (s) => s === 200 || s === 404
        });
        if (response.status === 404) return [];
        return Array.isArray(response.data) ? response.data : [];
    }

    // #1358: o endpoint /validate do Dolibarr EXIGE `notrigger` (integer) no body — sem ele,
    // retorna 400 "Invalid value specified for `notrigger`. Expecting integer value" e a
    // validação falha (confirmado ao vivo). notrigger=0 = dispara os triggers normais do ERP.
    async validateInvoice(invoiceId: string, userKey?: string): Promise<any> {
        const url = `${this.baseUrl}invoices/${invoiceId}/validate`;
        return this.requestWithAuth('POST', url, { notrigger: 0 }, userKey || this.apiKey);
    }

    async validateOrder(orderId: string, userKey?: string): Promise<any> {
        const url = `${this.baseUrl}orders/${orderId}/validate`;
        return this.requestWithAuth('POST', url, { notrigger: 0 }, userKey || this.apiKey);
    }

    async validateProposal(proposalId: string, userKey?: string): Promise<any> {
        const url = `${this.baseUrl}proposals/${proposalId}/validate`;
        return this.requestWithAuth('POST', url, { notrigger: 0 }, userKey || this.apiKey);
    }

    // Exclui uma proposta. IRREVERSÍVEL — o Dolibarr NÃO trava a exclusão de uma proposta
    // validada (verificado: DELETE de status=1 retorna 200 "deleted"). A trava de "só rascunho"
    // é responsabilidade do chamador (agentActionConfirm.delete_proposal). Roda com a chave do
    // usuário que confirma (RBAC decide se ele pode excluir).
    async deleteProposal(proposalId: string, userKey?: string): Promise<any> {
        const url = `${this.baseUrl}proposals/${proposalId}`;
        return this.requestWithAuth('DELETE', url, undefined, userKey || this.apiKey);
    }
}
