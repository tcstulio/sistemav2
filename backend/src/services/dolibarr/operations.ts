/**
 * Dolibarr Service - Operations Module
 * 
 * Methods for projects, tasks, tickets, shipments, events, and interventions.
 */

import axios from 'axios';
import { DolibarrServiceBase, AddTimeSpentModel } from './core';

export class DolibarrOperationsService extends DolibarrServiceBase {

    async addTimeSpent(taskId: string, data: AddTimeSpentModel, userKey?: string) {
        const url = `${this.baseUrl}tasks/${taskId}/addtimespent`;
        return this.requestWithAuth('POST', url, data, userKey);
    }

    async getTicket(id: string): Promise<any | null> {
        try {
            const headers = this.getHeaders();
            const url = `${this.baseUrl}tickets/${id}`;

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
            console.error(`[DoliService] GetTicket Error for ${id}:`, error.message);
            return null;
        }
    }

    async listProjects(search?: string): Promise<any[]> {
        try {
            const headers = this.getHeaders();
            const url = `${this.baseUrl}projects`;
            let sqlfilters = undefined;
            if (search) {
                sqlfilters = `(t.title:like:'%${search}%') or (t.ref:like:'%${search}%')`;
            }

            const response = await axios.get(url, {
                headers,
                params: {
                    sqlfilters,
                    limit: 5,
                    sortfield: 't.datec',
                    sortorder: 'DESC'
                },
                httpsAgent: this.httpsAgent,
                validateStatus: (s) => s === 200
            });

            return Array.isArray(response.data) ? response.data : [];
        } catch (error) {
            console.error("listProjects Error", error);
            return [];
        }
    }

    async listTasks(projectId?: string): Promise<any[]> {
        try {
            const headers = this.getHeaders();
            const url = `${this.baseUrl}tasks`;
            let sqlfilters = undefined;
            if (projectId) {
                sqlfilters = `(t.fk_projet:=:${projectId})`;
            }
            const response = await axios.get(url, {
                headers,
                params: { sqlfilters, limit: 10, sortfield: 't.dateo', sortorder: 'DESC' },
                httpsAgent: this.httpsAgent,
                validateStatus: (s) => s === 200
            });
            return Array.isArray(response.data) ? response.data : [];
        } catch (error) {
            console.error("listTasks Error", error);
            return [];
        }
    }

    async listTickets(params: { search?: string, limit?: number } = {}): Promise<any[]> {
        try {
            const headers = this.getHeaders();
            const url = `${this.baseUrl}tickets`;
            let sqlfilters = undefined;

            if (params.search) {
                sqlfilters = `((t.track_id:like:'%${params.search}%') or (t.subject:like:'%${params.search}%') or (t.message:like:'%${params.search}%'))`;
            }

            const response = await axios.get(url, {
                headers,
                params: {
                    sqlfilters,
                    limit: params.limit || 5,
                    sortfield: 't.datec',
                    sortorder: 'DESC'
                },
                httpsAgent: this.httpsAgent,
                validateStatus: (s) => s === 200
            });

            return Array.isArray(response.data) ? response.data : [];
        } catch (error) {
            console.error("listTickets Error", error);
            return [];
        }
    }

    async listShipments(search?: string): Promise<any[]> {
        try {
            const headers = this.getHeaders();
            const url = `${this.baseUrl}shipments`;
            let sqlfilters = undefined;
            if (search) {
                sqlfilters = `(t.ref:like:'%${search}%')`;
            }
            const response = await axios.get(url, {
                headers,
                params: { sqlfilters, limit: 5, sortfield: 't.date_creation', sortorder: 'DESC' },
                httpsAgent: this.httpsAgent,
                validateStatus: (s) => s === 200
            });
            return Array.isArray(response.data) ? response.data : [];
        } catch (error) {
            console.error("listShipments Error", error);
            return [];
        }
    }

    async listEvents(limit?: number): Promise<any[]> {
        try {
            const headers = this.getHeaders();
            const url = `${this.baseUrl}agendaevents`;
            const response = await axios.get(url, {
                headers,
                params: { limit: limit || 10, sortfield: 't.datep', sortorder: 'DESC' },
                httpsAgent: this.httpsAgent,
                validateStatus: (s) => s === 200
            });
            return Array.isArray(response.data) ? response.data : [];
        } catch (error) {
            console.error("listEvents Error", error);
            return [];
        }
    }

    async listInterventions(search?: string): Promise<any[]> {
        try {
            const headers = this.getHeaders();
            const url = `${this.baseUrl}interventions`;
            let sqlfilters = undefined;
            if (search) {
                sqlfilters = `(t.ref:like:'%${search}%')`;
            }
            const response = await axios.get(url, {
                headers,
                params: { sqlfilters, limit: 10, sortfield: 't.datec', sortorder: 'DESC' },
                httpsAgent: this.httpsAgent,
                validateStatus: (s) => s === 200
            });
            return Array.isArray(response.data) ? response.data : [];
        } catch (error) {
            console.error("listInterventions Error", error);
            return [];
        }
    }
}
