/**
 * Dolibarr Service - HR Module
 * 
 * Methods for users, expense reports, leave requests, candidates, and job positions.
 */

import axios from 'axios';
import { DolibarrServiceBase, buildLikeFilter, buildSqlFilter } from './core';
import { createLogger } from '../../utils/logger';

const log = createLogger('DolibarrHR');

export class DolibarrHRService extends DolibarrServiceBase {

    async getUserById(id: string): Promise<any | null> {
        try {
            const headers = this.getHeaders();
            const url = `${this.baseUrl}users/${id}`;
            const response = await axios.get(url, {
                headers,
                httpsAgent: this.httpsAgent,
                validateStatus: (s) => s === 200
            });
            return response.data || null;
        } catch (error) {
            log.error(`getUserById Error (id=${id})`, error);
            return null;
        }
    }

    /**
     * Atualiza campos de um usuário no Dolibarr (PUT /users/:id). Aceita payload parcial;
     * para extrafields use { array_options: { options_xxx: ... } }.
     */
    async updateUser(id: string, payload: Record<string, any>): Promise<any> {
        const headers = this.getHeaders();
        const url = `${this.baseUrl}users/${id}`;
        const response = await axios.put(url, payload, {
            headers,
            httpsAgent: this.httpsAgent,
            validateStatus: (s) => s === 200,
        });
        return response.data;
    }

    /** Persiste o perfil de permissões do agente no extrafield options_entrevista_inicial (JSON). */
    async setUserPermissionProfile(id: string, profile: unknown): Promise<any> {
        return this.updateUser(id, {
            array_options: { options_entrevista_inicial: JSON.stringify(profile) },
        });
    }

    /**
     * Acha um usuário pelo login (ou e-mail) — usado p/ resolver o ID Dolibarr do
     * usuário logado quando o perfil não traz o id explícito. Best-effort: tenta login
     * exato, depois e-mail exato; confirma o match no resultado. (#300)
     */
    async findUserByLoginOrEmail(loginOrEmail: string): Promise<any | null> {
        const term = (loginOrEmail || '').trim();
        if (!term) return null;
        const headers = this.getHeaders();
        const url = `${this.baseUrl}users`;
        const lower = term.toLowerCase();

        const tryFilter = async (sqlfilters: string): Promise<any | null> => {
            try {
                const response = await axios.get(url, {
                    headers,
                    params: { sqlfilters, limit: 5 },
                    httpsAgent: this.httpsAgent,
                    validateStatus: (s) => s === 200,
                });
                const list = Array.isArray(response.data) ? response.data : [];
                const exact = list.find((u: any) =>
                    String(u.login || '').toLowerCase() === lower ||
                    String(u.email || '').toLowerCase() === lower
                );
                return exact || (list.length === 1 ? list[0] : null);
            } catch (error) {
                log.error('findUserByLoginOrEmail filter error', error);
                return null;
            }
        };

        return (await tryFilter(`(${buildSqlFilter('t.login', ':=', term)})`))
            || (await tryFilter(`(${buildSqlFilter('t.email', ':=', term)})`));
    }

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
            const url = `${this.baseUrl}holidays`;
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
