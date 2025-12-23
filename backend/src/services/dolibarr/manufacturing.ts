/**
 * Dolibarr Service - Manufacturing Module
 * 
 * Methods for BOMs and manufacturing orders.
 */

import axios from 'axios';
import { DolibarrServiceBase } from './core';

export class DolibarrManufacturingService extends DolibarrServiceBase {

    async listBOMs(search?: string): Promise<any[]> {
        try {
            const headers = this.getHeaders();
            const url = `${this.baseUrl}boms`;
            let sqlfilters = undefined;
            if (search) {
                sqlfilters = `(t.ref:like:'%${search}%')`;
            }
            const response = await axios.get(url, {
                headers,
                params: { sqlfilters, limit: 10 },
                httpsAgent: this.httpsAgent,
                validateStatus: (s) => s === 200
            });
            return Array.isArray(response.data) ? response.data : [];
        } catch (error) {
            console.error("listBOMs Error", error);
            return [];
        }
    }

    async listManufacturingOrders(status?: string): Promise<any[]> {
        try {
            const headers = this.getHeaders();
            const url = `${this.baseUrl}mos`;
            let sqlfilters = undefined;
            if (status === 'draft') sqlfilters = '(t.status:=:0)';
            if (status === 'validated') sqlfilters = '(t.status:=:1)';
            if (status === 'inprogress') sqlfilters = '(t.status:=:2)';
            const response = await axios.get(url, {
                headers,
                params: { sqlfilters, limit: 10, sortfield: 't.date_start_planned', sortorder: 'DESC' },
                httpsAgent: this.httpsAgent,
                validateStatus: (s) => s === 200
            });
            return Array.isArray(response.data) ? response.data : [];
        } catch (error) {
            console.error("listManufacturingOrders Error", error);
            return [];
        }
    }
}
