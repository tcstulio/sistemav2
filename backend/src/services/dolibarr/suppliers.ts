/**
 * Dolibarr Service - Suppliers Module
 * 
 * Methods for supplier invoices and orders.
 */

import axios from 'axios';
import { DolibarrServiceBase, ValidateSupplierOrderModel } from './core';

export class DolibarrSuppliersService extends DolibarrServiceBase {

    async validateSupplierOrder(orderId: string, data: ValidateSupplierOrderModel, userKey?: string) {
        const url = `${this.baseUrl}supplierorders/${orderId}/validate`;
        return this.requestWithAuth('POST', url, data, userKey);
    }

    async listSupplierInvoices(status?: string): Promise<any[]> {
        try {
            const headers = this.getHeaders();
            const url = `${this.baseUrl}supplier_invoices`;
            let sqlfilters = undefined;
            if (status === 'unpaid') sqlfilters = '(t.fk_statut:=:1)';
            if (status === 'paid') sqlfilters = '(t.fk_statut:=:2)';

            const response = await axios.get(url, {
                headers,
                params: { sqlfilters, limit: 5, sortfield: 't.datef', sortorder: 'DESC' },
                httpsAgent: this.httpsAgent,
                validateStatus: (s) => s === 200
            });
            return Array.isArray(response.data) ? response.data : [];
        } catch (error) {
            console.error("listSupplierInvoices Error", error);
            return [];
        }
    }

    async listSupplierOrders(status?: string): Promise<any[]> {
        try {
            const headers = this.getHeaders();
            const url = `${this.baseUrl}supplier_orders`;
            let sqlfilters = undefined;
            if (status === 'draft') sqlfilters = '(t.fk_statut:=:0)';
            if (status === 'validated') sqlfilters = '(t.fk_statut:=:1)';
            const response = await axios.get(url, {
                headers,
                params: { sqlfilters, limit: 10, sortfield: 't.date_commande', sortorder: 'DESC' },
                httpsAgent: this.httpsAgent,
                validateStatus: (s) => s === 200
            });
            return Array.isArray(response.data) ? response.data : [];
        } catch (error) {
            console.error("listSupplierOrders Error", error);
            return [];
        }
    }
}
