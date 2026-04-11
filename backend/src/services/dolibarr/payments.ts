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
}
