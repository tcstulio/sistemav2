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
        const headers = this.getHeaders();
        const url = `${this.baseUrl}supplier_invoices`;
        let sqlfilters = undefined;
        if (status === 'unpaid') sqlfilters = '(t.fk_statut:=:1)';
        if (status === 'paid') sqlfilters = '(t.fk_statut:=:2)';

        // #1352: Dolibarr devolve 404 quando não há faturas para o filtro → tratamos como []
        // legitimamente. 5xx/401/403/timeout/rede NÃO são silenciados: devem propagar para que
        // get_accounts_payable (consumidor desta função) não confunda "erro" com "não existe".
        const response = await axios.get(url, {
            headers,
            params: { sqlfilters, limit: 5, sortfield: 't.datef', sortorder: 'DESC' },
            httpsAgent: this.httpsAgent,
            validateStatus: (s) => s === 200 || s === 404
        });
        if (response.status === 404) return [];
        return Array.isArray(response.data) ? response.data : [];
    }

    async listSupplierOrders(status?: string): Promise<any[]> {
        const headers = this.getHeaders();
        const url = `${this.baseUrl}supplier_orders`;
        let sqlfilters = undefined;
        if (status === 'draft') sqlfilters = '(t.fk_statut:=:0)';
        if (status === 'validated') sqlfilters = '(t.fk_statut:=:1)';

        // #1352: idem listSupplierInvoices — 404 = "sem pedidos"; erros reais devem propagar.
        const response = await axios.get(url, {
            headers,
            params: { sqlfilters, limit: 10, sortfield: 't.date_commande', sortorder: 'DESC' },
            httpsAgent: this.httpsAgent,
            validateStatus: (s) => s === 200 || s === 404
        });
        if (response.status === 404) return [];
        return Array.isArray(response.data) ? response.data : [];
    }
}
