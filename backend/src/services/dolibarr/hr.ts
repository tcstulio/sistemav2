/**
 * Dolibarr Service - HR Module
 * 
 * Methods for users, expense reports, leave requests, candidates, and job positions.
 */

import axios from 'axios';
import { DolibarrServiceBase, buildLikeFilter } from './core';
import { createLogger } from '../../utils/logger';

const log = createLogger('DolibarrHR');

export class DolibarrHRService extends DolibarrServiceBase {

    async listUsers(search?: string): Promise<any[]> {
        try {
            const headers = this.getHeaders();
            const url = `${this.baseUrl}users`;
            let sqlfilters = undefined;
            if (search) {
                sqlfilters = `(${buildLikeFilter('t.firstname', search)}) or (${buildLikeFilter('t.lastname', search)})`;
            }
            const response = await axios.get(url, {
                headers,
                params: { sqlfilters, limit: 10 },
                httpsAgent: this.httpsAgent,
                validateStatus: (s) => s === 200
            });
            return Array.isArray(response.data) ? response.data : [];
        } catch (error) {
            log.error('listUsers Error', error);
            return [];
        }
    }

    async listExpenseReports(status?: string): Promise<any[]> {
        try {
            const headers = this.getHeaders();
            const url = `${this.baseUrl}expensereports`;
            let sqlfilters = undefined;
            if (status === 'approved') sqlfilters = '(t.fk_statut:=:5)';
            if (status === 'paid') sqlfilters = '(t.fk_statut:=:6)';

            const response = await axios.get(url, {
                headers,
                params: { sqlfilters, limit: 5, sortfield: 't.date_debut', sortorder: 'DESC' },
                httpsAgent: this.httpsAgent,
                validateStatus: (s) => s === 200
            });
            return Array.isArray(response.data) ? response.data : [];
        } catch (error) {
            log.error('listExpenseReports Error', error);
            return [];
        }
    }

    async listLeaveRequests(status?: string): Promise<any[]> {
        try {
            const headers = this.getHeaders();
            const url = `${this.baseUrl}leaves`;
            const params: any = { limit: 10 };
            if (status === 'approved') params.sqlfilters = "(t.status:=:'3')";
            if (status === 'pending') params.sqlfilters = "(t.status:=:'2')";
            const response = await axios.get(url, {
                headers,
                params,
                httpsAgent: this.httpsAgent,
                validateStatus: (s) => s === 200
            });
            return Array.isArray(response.data) ? response.data : [];
        } catch (error) {
            log.error('listLeaveRequests Error', error);
            return [];
        }
    }

    async listCandidates(search?: string): Promise<any[]> {
        try {
            const headers = this.getHeaders();
            const url = `${this.baseUrl}recruitments/candidature`;
            let sqlfilters = undefined;
            if (search) {
                sqlfilters = `(${buildLikeFilter('t.firstname', search)}) or (${buildLikeFilter('t.lastname', search)})`;
            }
            const response = await axios.get(url, {
                headers,
                params: { sqlfilters, limit: 10 },
                httpsAgent: this.httpsAgent,
                validateStatus: (s) => s === 200
            });
            return Array.isArray(response.data) ? response.data : [];
        } catch (error) {
            log.error('listCandidates Error', error);
            return [];
        }
    }

    async listJobPositions(onlyOpen: boolean = true): Promise<any[]> {
        try {
            const headers = this.getHeaders();
            const url = `${this.baseUrl}recruitments/jobposition`;
            const params: any = { limit: 50 };
            if (onlyOpen) {
                params.sqlfilters = "(t.status:=:'1')";
            }
            const response = await axios.get(url, {
                headers,
                params,
                httpsAgent: this.httpsAgent,
                validateStatus: (s) => s === 200
            });
            return Array.isArray(response.data) ? response.data : [];
        } catch (error) {
            log.error('listJobPositions Error', error);
            return [];
        }
    }
}
