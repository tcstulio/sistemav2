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

    async listInvoices(params: { status?: string, limit?: number } = {}): Promise<any[]> {
        try {
            const headers = this.getHeaders();
            const url = `${this.baseUrl}invoices`;
            let sqlfilters = '';

            if (params.status === 'unpaid') sqlfilters = '(t.paye:=:0) and (t.fk_statut:>:0)';
            if (params.status === 'paid') sqlfilters = '(t.paye:=:1)';
            if (params.status === 'draft') sqlfilters = '(t.fk_statut:=:0)';

            const response = await axios.get(url, {
                headers,
                params: {
                    sqlfilters: sqlfilters || undefined,
                    limit: params.limit || 5,
                    sortfield: 't.datef',
                    sortorder: 'DESC'
                },
                httpsAgent: this.httpsAgent,
                validateStatus: (s) => s === 200
            });

            return Array.isArray(response.data) ? response.data : [];
        } catch (error) {
            log.error('listInvoices Error', error);
            return [];
        }
    }

    async listOrders(params: { status?: string, search?: string, limit?: number } = {}): Promise<any[]> {
        try {
            const headers = this.getHeaders();
            const url = `${this.baseUrl}orders`;
            let sqlfiltersParts = [];

            if (params.status === 'draft') sqlfiltersParts.push('(t.fk_statut:=:0)');
            if (params.status === 'validated') sqlfiltersParts.push('(t.fk_statut:=:1)');
            if (params.status === 'processed') sqlfiltersParts.push('(t.fk_statut:>=:2)');

            if (params.search) {
                sqlfiltersParts.push(`((${buildLikeFilter('t.ref', params.search)}) or (${buildLikeFilter('t.ref_client', params.search)}))`);
            }

            const response = await axios.get(url, {
                headers,
                params: {
                    sqlfilters: sqlfiltersParts.length > 0 ? sqlfiltersParts.join(' and ') : undefined,
                    limit: params.limit || 5,
                    sortfield: 't.date_commande',
                    sortorder: 'DESC'
                },
                httpsAgent: this.httpsAgent,
                validateStatus: (s) => s === 200
            });

            return Array.isArray(response.data) ? response.data : [];
        } catch (error) {
            log.error('listOrders Error', error);
            return [];
        }
    }

    async listProposals(params: { status?: string, search?: string, limit?: number } = {}): Promise<any[]> {
        try {
            const headers = this.getHeaders();
            const url = `${this.baseUrl}proposals`;
            let sqlfilters = undefined;

            if (params.status === 'draft') sqlfilters = '(t.fk_statut:=:0)';
            if (params.status === 'open') sqlfilters = '(t.fk_statut:=:1)';
            if (params.status === 'signed') sqlfilters = '(t.fk_statut:=:2)';

            if (params.search) {
                const searchFilter = `((${buildLikeFilter('t.ref', params.search)}) or (${buildLikeFilter('t.ref_client', params.search)}))`;
                sqlfilters = sqlfilters ? `(${sqlfilters}) and ${searchFilter}` : searchFilter;
            }

            const response = await axios.get(url, {
                headers,
                params: {
                    sqlfilters,
                    limit: params.limit || 5,
                    sortfield: 't.datep',
                    sortorder: 'DESC'
                },
                httpsAgent: this.httpsAgent,
                validateStatus: (s) => s === 200
            });

            return Array.isArray(response.data) ? response.data : [];
        } catch (error) {
            log.error('listProposals Error', error);
            return [];
        }
    }

    async listContracts(search?: string): Promise<any[]> {
        try {
            const headers = this.getHeaders();
            const url = `${this.baseUrl}contracts`;
            let sqlfilters = undefined;
            if (search) {
                sqlfilters = `(${buildLikeFilter('t.ref', search)})`;
            }

            const response = await axios.get(url, {
                headers,
                params: { sqlfilters, limit: 5, sortfield: 't.date_contrat', sortorder: 'DESC' },
                httpsAgent: this.httpsAgent,
                validateStatus: (s) => s === 200
            });
            return Array.isArray(response.data) ? response.data : [];
        } catch (error) {
            log.error('listContracts Error', error);
            return [];
        }
    }

    async validateInvoice(invoiceId: string, userKey?: string): Promise<any> {
        const url = `${this.baseUrl}invoices/${invoiceId}/validate`;
        return this.requestWithAuth('POST', url, {}, userKey || this.apiKey);
    }

    async validateOrder(orderId: string, userKey?: string): Promise<any> {
        const url = `${this.baseUrl}orders/${orderId}/validate`;
        return this.requestWithAuth('POST', url, {}, userKey || this.apiKey);
    }

    async validateProposal(proposalId: string, userKey?: string): Promise<any> {
        const url = `${this.baseUrl}proposals/${proposalId}/validate`;
        return this.requestWithAuth('POST', url, {}, userKey || this.apiKey);
    }
}
