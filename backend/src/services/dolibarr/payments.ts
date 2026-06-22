/**
 * Dolibarr Service - Payments Module
 * 
 * Methods for payments and bank accounts.
 */

import axios from 'axios';
import { DolibarrServiceBase, AddPaymentModel } from './core';
import { createLogger } from '../../utils/logger';

const log = createLogger('DolibarrPayments');

export class DolibarrPaymentsService extends DolibarrServiceBase {

    async addPayment(invoiceId: string, data: AddPaymentModel, userKey?: string) {
        const url = `${this.baseUrl}invoices/${invoiceId}/payments`;
        return this.requestWithAuth('POST', url, data, userKey);
    }

    async listPayments(limit?: number): Promise<any[]> {
        try {
            const headers = this.getHeaders();
            const url = `${this.baseUrl}invoices/payments`;
            const response = await axios.get(url, {
                headers,
                params: { limit: limit || 10 },
                httpsAgent: this.httpsAgent,
                validateStatus: (s) => s === 200
            });
            return Array.isArray(response.data) ? response.data : [];
        } catch (error) {
            log.error('listPayments Error', error);
            return [];
        }
    }

    async listBankAccounts(): Promise<any[]> {
        try {
            const headers = this.getHeaders();
            const url = `${this.baseUrl}bankaccounts`;

            const response = await axios.get(url, {
                headers,
                params: { limit: 10 },
                httpsAgent: this.httpsAgent,
                validateStatus: (s) => s === 200
            });

            return Array.isArray(response.data) ? response.data : [];
        } catch (error) {
            log.error('listBankAccounts Error', error);
            return [];
        }
    }

    async listBankLines(accountId: string, limit?: number): Promise<any[]> {
        try {
            const headers = this.getHeaders();
            const url = `${this.baseUrl}bankaccounts/${accountId}/lines`;
            const response = await axios.get(url, {
                headers,
                params: { limit: limit || 20 },
                httpsAgent: this.httpsAgent,
                validateStatus: (s) => s === 200
            });
            return Array.isArray(response.data) ? response.data : [];
        } catch (error) {
            log.error('listBankLines Error', error);
            return [];
        }
    }

    /**
     * Persist reconciliation state of a bank line via Dolibarr REST API.
     * Uses PUT bankaccounts/{accountId}/lines/{lineId} with num_releve to mark
     * the line as reconciled (num_releve='OUI') or unreconciled (num_releve='').
     */
    async reconcileBankLine(accountId: string, lineId: string, reconciled: boolean, userKey?: string): Promise<boolean> {
        try {
            const url = `${this.baseUrl}bankaccounts/${accountId}/lines/${lineId}`;
            const data = { num_releve: reconciled ? 'OUI' : '' };
            const headers = this.getHeaders(userKey);
            const response = await axios.put(url, data, {
                headers,
                httpsAgent: this.httpsAgent,
                validateStatus: (s) => s < 300
            });
            log.info(`Bank line ${lineId} reconciled=${reconciled}`, { status: response.status });
            return true;
        } catch (error: any) {
            log.error('reconcileBankLine Error', { accountId, lineId, reconciled, message: error?.message });
            return false;
        }
    }
}
