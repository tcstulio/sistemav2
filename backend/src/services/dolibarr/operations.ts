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
        const url = `${this.baseUrl}tasks`;
        const sqlfilters = projectId ? `(${buildSqlFilter('t.fk_projet', ':=', projectId)})` : undefined;
        // Dolibarr devolve 404 quando NÃO há tarefas (não é erro) → tratamos como vazio.
        const attempt = async (params: any): Promise<any[]> => {
            const response = await axios.get(url, {
                headers: this.getHeaders(),
                params,
                httpsAgent: this.httpsAgent,
                validateStatus: (s) => s === 200 || s === 404,
            });
            if (response.status === 404) return [];
            return Array.isArray(response.data) ? response.data : [];
        };
        try {
            return await attempt({ sqlfilters, limit: 10, sortfield: 't.dateo', sortorder: 'DESC' });
        } catch (error: any) {
            // Alguns campos de ordenação dão 400 no /tasks → tenta de novo SEM sort antes de desistir.
            try {
                return await attempt({ sqlfilters, limit: 10 });
            } catch (error2: any) {
                log.warn('listTasks falhou (com e sem sort)', error2?.message || error?.message);
                return [];
            }
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

    /**
     * Durabilidade da delegação (#293): espelha o estado do ciclo no extrafield
     * options_delegation_state da tarefa, via REST nativa (PUT /tasks/{id}). `stateJson` já vem
     * serializado. Best-effort — se o extrafield ainda não existe no Dolibarr (setup do
     * custom_delegation.php não rodou), retorna false sem quebrar o fluxo (cai no store local).
     */
    async setTaskDelegationState(taskId: string, stateJson: string): Promise<boolean> {
        try {
            const url = `${this.baseUrl}tasks/${taskId}`;
            // O PUT REST do Dolibarr sanitiza extrafields desconhecidos com 'alphanohtml', que
            // REMOVE todas as aspas duplas (e mangla < > & \) — destruiria o JSON. Gravamos em
            // base64 (A-Za-z0-9+/=), cujo alfabeto passa intacto pela sanitização; decodificado
            // de volta em listDelegationStates. (#293)
            const encoded = Buffer.from(stateJson, 'utf8').toString('base64');
            await axios.put(url, { array_options: { options_delegation_state: encoded } }, {
                headers: this.getHeaders(),
                httpsAgent: this.httpsAgent,
                validateStatus: (s) => s === 200,
            });
            return true;
        } catch (error: any) {
            log.warn(`setTaskDelegationState task=${taskId} falhou (extrafield criado?): ${error?.message || error}`);
            return false;
        }
    }

    /**
     * Lê os estados de delegação persistidos no Dolibarr (custom_delegation.php?action=list) para
     * reidratar o cache local. Decodifica o base64 gravado por setTaskDelegationState e devolve o
     * JSON cru. Best-effort: [] se o script não estiver deployado. (#293)
     */
    async listDelegationStates(): Promise<Array<{ taskId: string; state: string }>> {
        try {
            const res = await this.proxyCustomSync({ action: 'list' }, this.getHeaders(), 'custom_delegation.php');
            return this.extractSyncRows(res)
                .filter((r: any) => r && r.task_id != null && r.delegation_state)
                .map((r: any) => ({ taskId: String(r.task_id), state: Buffer.from(String(r.delegation_state), 'base64').toString('utf8') }))
                .filter((x) => !!x.state);
        } catch (error: any) {
            log.warn(`listDelegationStates falhou: ${error?.message || error}`);
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

    /**
     * Atualiza uma intervenção (fichinter). A REST padrão do Dolibarr NÃO expõe
     * PUT /interventions/{id} (issue #656), então gravamos via custom_sync.php
     * (action=update_intervention), no mesmo padrão do setTaskContact. Ao contrário
     * dos outros writes best-effort, este PROPAGA um erro ({message,status,details})
     * quando a gravação falha — para que o handler da rota responda com status HTTP
     * apropriado (critério de aceite do #656).
     */
    async updateIntervention(
        id: string,
        payload: { socid?: string | number; date?: string | number; fk_project?: string | number; description?: string }
    ): Promise<{ success: true }> {
        const res: any = await this.proxyCustomSync(
            {
                action: 'update_intervention',
                intervention_id: id,
                socid: payload.socid,
                date: payload.date,
                fk_project: payload.fk_project,
                description: payload.description,
            },
            this.getHeaders()
        );

        const ok = res?.data?.success === true;
        if (!ok) {
            const status = res?.status && res.status >= 400 ? res.status : 502;
            const message = res?.data?.error || res?.data?.message || 'Falha ao atualizar a intervenção no Dolibarr';
            log.error(`updateIntervention Error intervention=${id}`, message);
            throw { message, status, details: res?.data };
        }
        return { success: true };
    }
}
