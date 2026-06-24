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
     * Adiciona um usuário a um grupo (GET /users/{id}/setGroup/{group}).
     *
     * Base da automação "Habilitar acesso ao app": o Dolibarr NÃO permite setar direitos
     * por REST (não há endpoint /rights — confirmado no fonte), mas permite mover o usuário
     * para um grupo. Ao entrar num grupo que carrega o direito user->self->creer (ID 342),
     * o usuário passa a gerar a "Chave para API" automaticamente no próximo /login
     * (api_login.class.php só gera a chave p/ quem pode editar o próprio cadastro). Usa a
     * chave de SERVIÇO (admin) — setGroup exige user->user->creer ou admin. Re-adicionar a um
     * grupo que o usuário já tem é inócuo.
     */
    async setUserGroup(id: string, groupId: string, entity?: number): Promise<boolean> {
        const headers = this.getHeaders();
        const url = `${this.baseUrl}users/${encodeURIComponent(id)}/setGroup/${encodeURIComponent(groupId)}`;
        const response = await axios.get(url, {
            headers,
            params: entity ? { entity } : undefined,
            httpsAgent: this.httpsAgent,
            validateStatus: (s) => s === 200,
        });
        return response.status === 200;
    }

    /** IDs dos grupos de um usuário (GET /users/{id}/groups). Best-effort: [] em erro. */
    async getUserGroupIds(id: string): Promise<string[]> {
        try {
            const headers = this.getHeaders();
            const url = `${this.baseUrl}users/${encodeURIComponent(id)}/groups`;
            const response = await axios.get(url, {
                headers,
                httpsAgent: this.httpsAgent,
                validateStatus: (s) => s === 200,
            });
            const list = Array.isArray(response.data) ? response.data : [];
            return list.map((g: any) => String(g.id)).filter(Boolean);
        } catch (error) {
            log.error(`getUserGroupIds Error (id=${id})`, error);
            return [];
        }
    }

    /**
     * Helper das escritas de grupo/direito via custom_groups.php (admin-gated, issue dolibarr#137).
     * A REST do Dolibarr não expõe criar/editar/excluir grupo, remover de grupo, nem add/remove de
     * direito; o script chama as classes UserGroup/User. Usa a chave de SERVIÇO (admin). NÃO envia
     * `entity` → o PHP usa $conf->entity (uniforme em add+remove). Lança {message,status,details}
     * em falha (mesmo padrão de updateIntervention).
     */
    private async groupsWrite(action: string, params: Record<string, any>): Promise<any> {
        const res: any = await this.proxyCustomSync({ action, ...params }, this.getHeaders(), 'custom_groups.php');
        const ok = res?.data?.success === true;
        if (!ok) {
            const status = res?.status && res.status >= 400 ? res.status : 502;
            const message = res?.data?.error || res?.data?.message || `Falha em ${action}`;
            log.error(`groupsWrite ${action} Error`, message);
            throw { message, status, details: res?.data };
        }
        return res.data;
    }

    createGroup(data: { name: string; note?: string }) {
        return this.groupsWrite('create_group', { name: data.name, note: data.note || '' });
    }
    updateGroup(id: string, data: { name?: string; note?: string }) {
        return this.groupsWrite('update_group', { group_id: id, name: data.name, note: data.note });
    }
    deleteGroup(id: string) {
        return this.groupsWrite('delete_group', { group_id: id });
    }
    /** Adiciona usuário a grupo via custom_groups (entity = $conf->entity, simétrico ao remove). */
    addUserToGroup(groupId: string, userId: string) {
        return this.groupsWrite('add_group_user', { group_id: groupId, user_id: userId });
    }
    removeUserFromGroup(groupId: string, userId: string) {
        return this.groupsWrite('remove_group_user', { group_id: groupId, user_id: userId });
    }
    addGroupRight(groupId: string, rid: string) {
        return this.groupsWrite('add_group_right', { group_id: groupId, rid });
    }
    removeGroupRight(groupId: string, rid: string) {
        return this.groupsWrite('remove_group_right', { group_id: groupId, rid });
    }
    addUserRight(userId: string, rid: string) {
        return this.groupsWrite('add_user_right', { user_id: userId, rid });
    }
    removeUserRight(userId: string, rid: string) {
        return this.groupsWrite('remove_user_right', { user_id: userId, rid });
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
