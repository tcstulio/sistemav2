/**
 * Dolibarr Service - Operations Module
 * 
 * Methods for projects, tasks, tickets, shipments, events, and interventions.
 */

import axios from 'axios';
import { DolibarrServiceBase, AddTimeSpentModel, buildLikeFilter, buildSqlFilter } from './core';
import { createLogger } from '../../utils/logger';

const log = createLogger('DolibarrOperations');

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
            log.error(`GetTicket Error for ${id}`, error.message);
            return null;
        }
    }

    async listProjects(params?: { search?: string; socid?: string }): Promise<any[]> {
        try {
            const headers = this.getHeaders();
            const url = `${this.baseUrl}projects`;
            const parts: string[] = [];
            if (params?.search) {
                parts.push(`(${buildLikeFilter('t.title', params.search)}) or (${buildLikeFilter('t.ref', params.search)})`);
            }
            if (params?.socid) {
                parts.push(`${buildSqlFilter('t.fk_soc', ':=', params.socid)}`);
            }

            const response = await axios.get(url, {
                headers,
                params: {
                    sqlfilters: parts.length > 0 ? parts.join(' and ') : undefined,
                    limit: 20,
                    sortfield: 't.datec',
                    sortorder: 'DESC'
                },
                httpsAgent: this.httpsAgent,
                validateStatus: (s) => s === 200
            });

            return Array.isArray(response.data) ? response.data : [];
        } catch (error) {
            log.error('listProjects Error', error);
            return [];
        }
    }

    async listTasks(projectId?: string): Promise<any[]> {
        try {
            const headers = this.getHeaders();
            const url = `${this.baseUrl}tasks`;
            let sqlfilters = undefined;
            if (projectId) {
                sqlfilters = `(${buildSqlFilter('t.fk_projet', ':=', projectId)})`;
            }
            const response = await axios.get(url, {
                headers,
                params: { sqlfilters, limit: 10, sortfield: 't.dateo', sortorder: 'DESC' },
                httpsAgent: this.httpsAgent,
                validateStatus: (s) => s === 200
            });
            return Array.isArray(response.data) ? response.data : [];
        } catch (error) {
            log.error('listTasks Error', error);
            return [];
        }
    }

    // custom_sync.php responde { data: [...], pagination }; tolera array direto por segurança.
    private extractSyncRows(res: any): any[] {
        const payload = res?.data;
        if (Array.isArray(payload?.data)) return payload.data;
        return Array.isArray(payload) ? payload : [];
    }

    async listUserTasks(userId: string): Promise<any[]> {
        try {
            const uid = String(userId);
            // A API REST padrão do Dolibarr NÃO expõe "tarefas de um usuário" (só /tasks,
            // /tasks/{id}/roles, /projects/{id}/tasks; users/{id}/tasks não existe → 404).
            // Usamos o custom_sync.php em duas fontes:
            //  - type=tasks: projeta projet_task.fk_user_valid como fk_user_assign (responsável);
            //  - type=task_contacts: atribuições via element_contact (task_id + user_id).
            const [tasksRes, contactsRes] = await Promise.all([
                this.proxyCustomSync({ type: 'tasks', last_modified: 0, limit: 5000 }, this.getHeaders()),
                this.proxyCustomSync({ type: 'task_contacts', last_modified: 0, limit: 5000 }, this.getHeaders()),
            ]);
            const tasks = this.extractSyncRows(tasksRes);
            const assignedTaskIds = new Set(
                this.extractSyncRows(contactsRes)
                    .filter((c) => String(c.user_id) === uid)
                    .map((c) => String(c.task_id))
            );
            // Entra se a pessoa é o responsável (fk_user_assign) OU está atribuída via contato.
            return tasks.filter((t) => String(t.fk_user_assign) === uid || assignedTaskIds.has(String(t.id)));
        } catch (error: any) {
            log.error(`listUserTasks Error for ${userId}`, error?.message || error);
            return [];
        }
    }

    /** Todas as tarefas via custom_sync (type=tasks): traz fk_user_creat, date_end, progress, budget, etc. */
    async listTasksFull(): Promise<any[]> {
        try {
            const res = await this.proxyCustomSync({ type: 'tasks', last_modified: 0, limit: 5000 }, this.getHeaders());
            return this.extractSyncRows(res);
        } catch (error: any) {
            log.error('listTasksFull Error', error?.message || error);
            return [];
        }
    }

    /** Todos os vínculos de contato de tarefas (type=task_contacts): [{id, task_id, user_id, type_id}]. */
    async getAllTaskContacts(): Promise<any[]> {
        try {
            const res = await this.proxyCustomSync({ type: 'task_contacts', last_modified: 0, limit: 5000 }, this.getHeaders());
            return this.extractSyncRows(res);
        } catch (error: any) {
            log.error('getAllTaskContacts Error', error?.message || error);
            return [];
        }
    }

    /** Contatos (pessoas) de UMA tarefa: [{id, task_id, user_id, type_id}]. */
    async getTaskContacts(taskId: string): Promise<any[]> {
        return (await this.getAllTaskContacts()).filter((c) => String(c.task_id) === String(taskId));
    }

    /** Define contato da tarefa (TASKEXECUTIVE=Responsável | TASKCONTRIBUTOR=Interveniente) via custom_sync (issue #72). */
    async setTaskContact(taskId: string, userId: string, typeCode: 'TASKEXECUTIVE' | 'TASKCONTRIBUTOR' = 'TASKEXECUTIVE'): Promise<boolean> {
        try {
            const res = await this.proxyCustomSync(
                { action: 'set_task_contact', task_id: taskId, user_id: userId, type_code: typeCode, source: 'internal' },
                this.getHeaders()
            );
            return (res as any)?.data?.success === true;
        } catch (error: any) {
            log.error(`setTaskContact Error task=${taskId} user=${userId}`, error?.message || error);
            return false;
        }
    }

    /** Remove um vínculo de contato da tarefa (rowid de element_contact). */
    async removeTaskContact(taskId: string, contactRowid: string): Promise<boolean> {
        try {
            const res = await this.proxyCustomSync(
                { action: 'remove_task_contact', task_id: taskId, contact_rowid: contactRowid },
                this.getHeaders()
            );
            return (res as any)?.data?.success === true;
        } catch (error: any) {
            log.error(`removeTaskContact Error task=${taskId} contact=${contactRowid}`, error?.message || error);
            return false;
        }
    }

    async listTickets(params: { search?: string, limit?: number } = {}): Promise<any[]> {
        try {
            const headers = this.getHeaders();
            const url = `${this.baseUrl}tickets`;
            let sqlfilters = undefined;

            if (params.search) {
                sqlfilters = `((${buildLikeFilter('t.track_id', params.search)}) or (${buildLikeFilter('t.subject', params.search)}) or (${buildLikeFilter('t.message', params.search)}))`;
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
            log.error('listTickets Error', error);
            return [];
        }
    }

    async listShipments(search?: string): Promise<any[]> {
        try {
            const headers = this.getHeaders();
            const url = `${this.baseUrl}shipments`;
            let sqlfilters = undefined;
            if (search) {
                sqlfilters = `(${buildLikeFilter('t.ref', search)})`;
            }
            const response = await axios.get(url, {
                headers,
                params: { sqlfilters, limit: 5, sortfield: 't.date_creation', sortorder: 'DESC' },
                httpsAgent: this.httpsAgent,
                validateStatus: (s) => s === 200
            });
            return Array.isArray(response.data) ? response.data : [];
        } catch (error) {
            log.error('listShipments Error', error);
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
            log.error('listEvents Error', error);
            return [];
        }
    }

    /** Cria um evento de agenda (actioncomm) — usado p/ espelhar a trilha da delegação no Dolibarr. */
    async createAgendaEvent(data: {
        label: string;
        note?: string;
        type_code?: string;
        datep?: number;        // unix (segundos)
        fk_element?: string | number;
        elementtype?: string;  // ex.: 'project_task'
        userownerid?: string | number;
    }, userKey?: string): Promise<any> {
        const url = `${this.baseUrl}agendaevents`;
        const payload: any = {
            type_code: data.type_code || 'AC_OTH',
            label: data.label,
            note_private: data.note || '',
            datep: data.datep || Math.floor(Date.now() / 1000),
            percentage: 100,
            userownerid: data.userownerid ? Number(data.userownerid) : 1,
        };
        if (data.fk_element) { payload.fk_element = Number(data.fk_element); payload.elementtype = data.elementtype || 'project_task'; }
        return this.requestWithAuth('POST', url, payload, userKey);
    }

    async listInterventions(search?: string): Promise<any[]> {
        try {
            const headers = this.getHeaders();
            const url = `${this.baseUrl}interventions`;
            let sqlfilters = undefined;
            if (search) {
                sqlfilters = `(${buildLikeFilter('t.ref', search)})`;
            }
            const response = await axios.get(url, {
                headers,
                params: { sqlfilters, limit: 10, sortfield: 't.datec', sortorder: 'DESC' },
                httpsAgent: this.httpsAgent,
                validateStatus: (s) => s === 200
            });
            return Array.isArray(response.data) ? response.data : [];
        } catch (error) {
            log.error('listInterventions Error', error);
            return [];
        }
    }
}
