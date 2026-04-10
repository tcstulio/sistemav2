/**
 * Dolibarr Service - Products Module
 * 
 * Methods for products, warehouses, and stock movements.
 */

import axios from 'axios';
import { DolibarrServiceBase, buildLikeFilter, buildSqlFilter } from './core';
import { logger } from '../../utils/logger';

const log = logger.child('DolibarrProducts');

export class DolibarrProductsService extends DolibarrServiceBase {

    async listProducts(search?: string): Promise<any[]> {
        try {
            const headers = this.getHeaders();
            const url = `${this.baseUrl}products`;
            let sqlfilters = undefined;

            if (search) {
                sqlfilters = `((${buildLikeFilter('t.ref', search)}) or (${buildLikeFilter('t.label', search)}))`;
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
            log.error('listProducts Error', error);
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
            log.error('listWarehouses Error', error);
            return [];
        }
    }

    async listStockMovements(productId?: string): Promise<any[]> {
        try {
            const headers = this.getHeaders();
            const url = `${this.baseUrl}stockmovements`;
            let sqlfilters = undefined;
            if (productId) {
                sqlfilters = `(${buildSqlFilter('t.fk_product', ':=', productId)})`;
            }
            const response = await axios.get(url, {
                headers,
                params: { sqlfilters, limit: 20, sortfield: 't.datem', sortorder: 'DESC' },
                httpsAgent: this.httpsAgent,
                validateStatus: (s) => s === 200
            });
            return Array.isArray(response.data) ? response.data : [];
        } catch (error) {
            log.error('listStockMovements Error', error);
            return [];
        }
    }
}
