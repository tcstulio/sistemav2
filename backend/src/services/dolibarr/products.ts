/**
 * Dolibarr Service - Products Module
 * 
 * Methods for products, warehouses, and stock movements.
 */

import axios from 'axios';
import { DolibarrServiceBase } from './core';

export class DolibarrProductsService extends DolibarrServiceBase {

    async listProducts(search?: string): Promise<any[]> {
        try {
            const headers = this.getHeaders();
            const url = `${this.baseUrl}products`;
            let sqlfilters = undefined;

            if (search) {
                sqlfilters = `((t.ref:like:'%${search}%') or (t.label:like:'%${search}%'))`;
            }

            const response = await axios.get(url, {
                headers,
                params: {
                    sqlfilters,
                    limit: 5,
                    sortfield: 't.label',
                    sortorder: 'ASC'
                },
                httpsAgent: this.httpsAgent,
                validateStatus: (s) => s === 200
            });

            return Array.isArray(response.data) ? response.data : [];
        } catch (error) {
            console.error("listProducts Error", error);
            return [];
        }
    }

    async listWarehouses(): Promise<any[]> {
        try {
            const headers = this.getHeaders();
            const url = `${this.baseUrl}warehouses`;
            const response = await axios.get(url, {
                headers,
                params: { limit: 10 },
                httpsAgent: this.httpsAgent,
                validateStatus: (s) => s === 200
            });
            return Array.isArray(response.data) ? response.data : [];
        } catch (error) {
            console.error("listWarehouses Error", error);
            return [];
        }
    }

    async listStockMovements(productId?: string): Promise<any[]> {
        try {
            const headers = this.getHeaders();
            const url = `${this.baseUrl}stockmovements`;
            let sqlfilters = undefined;
            if (productId) {
                sqlfilters = `(t.fk_product:=:${productId})`;
            }
            const response = await axios.get(url, {
                headers,
                params: { sqlfilters, limit: 20, sortfield: 't.datem', sortorder: 'DESC' },
                httpsAgent: this.httpsAgent,
                validateStatus: (s) => s === 200
            });
            return Array.isArray(response.data) ? response.data : [];
        } catch (error) {
            console.error("listStockMovements Error", error);
            return [];
        }
    }
}
