import { DolibarrConfig, Ticket } from '../../types';
import { fetchList, request, getHeaders, sanitizeUrl } from './core';

/**
 * Operations Module (Cleaned)
 * 
 * This module now contains ONLY write operations (create, update, delete).
 * All read operations have been migrated to use local IndexedDB via custom_sync.php.
 */

// -- Write Operations --

export const createTicket = async (config: DolibarrConfig, data: Partial<Ticket>) => {
    const url = `${sanitizeUrl(config.apiUrl)}/tickets`;
    return request(url, {
        method: 'POST',
        headers: getHeaders(config.apiKey),
        body: JSON.stringify(data)
    });
};

export const updateTicket = async (config: DolibarrConfig, id: string, data: Partial<Ticket>) => {
    const url = `${sanitizeUrl(config.apiUrl)}/tickets/${id}`;
    return request(url, {
        method: 'PUT',
        headers: getHeaders(config.apiKey),
        body: JSON.stringify(data)
    });
};

/**
 * Add a message/reply to an existing ticket.
 *
 * Dolibarr REST: POST /tickets/newmessage
 * Body fields (mandatory): track_id, message
 * The ticket is identified by track_id in the body (NOT by path param).
 * Reference: ticket/class/api_tickets.class.php:346 (postNewMessage)
 *
 * @param trackId - The ticket's track_id string (e.g. "TIC-0000001-xxxxxxxx").
 *                  If the ticket has no track_id, the call is rejected (null/undefined)
 *                  to avoid silently sending an invalid request.
 */
export const addTicketMessage = async (config: DolibarrConfig, trackId: string | undefined | null, message: string) => {
    if (!trackId) {
        throw new Error('addTicketMessage: track_id é obrigatório. O chamado não possui track_id.');
    }
    const url = `${sanitizeUrl(config.apiUrl)}/tickets/newmessage`;
    return request(url, {
        method: 'POST',
        headers: getHeaders(config.apiKey),
        body: JSON.stringify({ track_id: trackId, message })
    });
};

export const createIntervention = async (config: DolibarrConfig, data: Record<string, unknown>) => {
    const url = `${sanitizeUrl(config.apiUrl)}/interventions`;
    return request(url, {
        method: 'POST',
        headers: getHeaders(config.apiKey),
        body: JSON.stringify(data)
    });
};

export interface InterventionUpdatePayload {
    socid?: string;
    date?: string | number;
    fk_project?: string;
    description?: string;
}

export const updateIntervention = async (
    config: DolibarrConfig,
    id: string,
    payload: InterventionUpdatePayload
) => {
    const url = `${sanitizeUrl(config.apiUrl)}/interventions/${id}`;
    return request(url, {
        method: 'PUT',
        headers: getHeaders(config.apiKey),
        body: JSON.stringify(payload)
    });
};

export interface InterventionLinePayload {
    desc: string;
    duration: number; // seconds
    date?: number;    // unix timestamp (optional)
}

export const addInterventionLine = async (
    config: DolibarrConfig,
    interventionId: string,
    payload: InterventionLinePayload
) => {
    const url = `${sanitizeUrl(config.apiUrl)}/interventions/${interventionId}/lines`;
    return request(url, {
        method: 'POST',
        headers: getHeaders(config.apiKey),
        body: JSON.stringify(payload)
    });
};

export const deleteInterventionLine = async (
    config: DolibarrConfig,
    interventionId: string,
    lineId: string
) => {
    const url = `${sanitizeUrl(config.apiUrl)}/interventions/${interventionId}/lines/${lineId}`;
    return request(url, {
        method: 'DELETE',
        headers: getHeaders(config.apiKey)
    });
};

export const fetchTicketEvents = async (config: DolibarrConfig, ticketId: string) => {
    // Fetches linked events/logs for the ticket
    // Uses agendaevents generic endpoint with filter for elementtype 'ticket'
    const filter = `(t.elementtype:=:'ticket') AND (t.fk_element:=:${ticketId})`;
    return fetchList(config, 'agendaevents', `&sortfield=t.datec&sortorder=ASC&sqlfilters=${encodeURIComponent(filter)}`);
};


// -- Projects --
export const createProject = async (config: DolibarrConfig, data: Record<string, unknown>) => {
    const url = `${sanitizeUrl(config.apiUrl)}/projects`;
    return request(url, {
        method: 'POST',
        headers: getHeaders(config.apiKey),
        body: JSON.stringify(data)
    });
};

export const updateProject = async (config: DolibarrConfig, id: string, data: Record<string, unknown>) => {
    const url = `${sanitizeUrl(config.apiUrl)}/projects/${id}`;
    return request(url, {
        method: 'PUT',
        headers: getHeaders(config.apiKey),
        body: JSON.stringify(data)
    });
};

// -- Tasks --
export const createTask = async (config: DolibarrConfig, data: Record<string, unknown>) => {
    const url = `${sanitizeUrl(config.apiUrl)}/tasks`;
    return request(url, {
        method: 'POST',
        headers: getHeaders(config.apiKey),
        body: JSON.stringify(data)
    });
};

export const updateTask = async (config: DolibarrConfig, id: string, data: Record<string, unknown>) => {
    const url = `${sanitizeUrl(config.apiUrl)}/tasks/${id}`;
    return request(url, {
        method: 'PUT',
        headers: getHeaders(config.apiKey),
        body: JSON.stringify(data)
    });
};

export const addTaskTimeLog = async (config: DolibarrConfig, taskId: string, duration: number, date?: number, note?: string, user_id?: string) => {
    // Standard endpoint usually is /tasks/{id}/addtimespent
    const url = `${sanitizeUrl(config.apiUrl)}/tasks/${taskId}/addtimespent`;
    const payload: Record<string, unknown> = {
        duration: duration,
        date: date || Math.floor(Date.now() / 1000),
        note: note
    };
    if (user_id) payload.fk_user = user_id;

    return request(url, {
        method: 'POST',
        headers: getHeaders(config.apiKey),
        body: JSON.stringify(payload)
    });
};

// -- Events --
export const createEvent = async (config: DolibarrConfig, data: Record<string, unknown>) => {
    const url = `${sanitizeUrl(config.apiUrl)}/agendaevents`;
    return request(url, {
        method: 'POST',
        headers: getHeaders(config.apiKey),
        body: JSON.stringify(data)
    });
};

export const updateEvent = async (config: DolibarrConfig, id: string, data: Record<string, unknown>) => {
    const url = `${sanitizeUrl(config.apiUrl)}/agendaevents/${id}`;
    return request(url, {
        method: 'PUT',
        headers: getHeaders(config.apiKey),
        body: JSON.stringify(data)
    });
};

export const deleteEvent = async (config: DolibarrConfig, id: string) => {
    const url = `${sanitizeUrl(config.apiUrl)}/agendaevents/${id}`;
    return request(url, {
        method: 'DELETE',
        headers: getHeaders(config.apiKey)
    });
};

// -- Deletions --
export const deleteProject = async (config: DolibarrConfig, id: string) => {
    const url = `${sanitizeUrl(config.apiUrl)}/projects/${id}`;
    return request(url, {
        method: 'DELETE',
        headers: getHeaders(config.apiKey)
    });
};

export const deleteTask = async (config: DolibarrConfig, id: string) => {
    const url = `${sanitizeUrl(config.apiUrl)}/tasks/${id}`;
    return request(url, {
        method: 'DELETE',
        headers: getHeaders(config.apiKey)
    });
};

export const deleteTicket = async (config: DolibarrConfig, id: string) => {
    const url = `${sanitizeUrl(config.apiUrl)}/tickets/${id}`;
    return request(url, {
        method: 'DELETE',
        headers: getHeaders(config.apiKey)
    });
};

export const deleteIntervention = async (config: DolibarrConfig, id: string) => {
    const url = `${sanitizeUrl(config.apiUrl)}/interventions/${id}`;
    return request(url, {
        method: 'DELETE',
        headers: getHeaders(config.apiKey)
    });
};

export const addProjectParticipant = async (config: DolibarrConfig, projectId: string, userId: string) => {
    const url = `${sanitizeUrl(config.apiUrl)}/projects/${projectId}/participants`;
    return request(url, {
        method: 'POST',
        headers: getHeaders(config.apiKey),
        body: JSON.stringify({ id: userId })
    });
};

export const validateIntervention = async (config: DolibarrConfig, id: string) => {
    const url = `${sanitizeUrl(config.apiUrl)}/interventions/${id}/validate`;
    return request(url, {
        method: 'POST',
        headers: getHeaders(config.apiKey),
        body: JSON.stringify({})
    });
};

export type TaskContactType = 'TASKEXECUTIVE' | 'TASKCONTRIBUTOR';

// Atribui Responsável (TASKEXECUTIVE) ou Interveniente (TASKCONTRIBUTOR) à tarefa.
// Usa a rota backend /tasks/{id}/contacts → custom_sync (issue #72), o único canal
// que de fato grava o vínculo (a REST padrão não tem /participants e não persiste o responsável).
export const setTaskContact = async (
    config: DolibarrConfig,
    taskId: string,
    userId: string,
    typeCode: TaskContactType = 'TASKEXECUTIVE'
) => {
    const url = `${sanitizeUrl(config.apiUrl)}/tasks/${taskId}/contacts`;
    return request(url, {
        method: 'POST',
        headers: getHeaders(config.apiKey),
        body: JSON.stringify({ userId, typeCode })
    });
};

// Lista os contatos (papéis) de uma tarefa: [{ id, task_id, user_id, type_id }]
export const getTaskContacts = async (config: DolibarrConfig, taskId: string) => {
    const url = `${sanitizeUrl(config.apiUrl)}/tasks/${taskId}/contacts`;
    return request(url, { method: 'GET', headers: getHeaders(config.apiKey) });
};

// Remove um vínculo de contato (rowid de element_contact)
export const removeTaskContact = async (config: DolibarrConfig, taskId: string, rowid: string) => {
    const url = `${sanitizeUrl(config.apiUrl)}/tasks/${taskId}/contacts/${rowid}`;
    return request(url, { method: 'DELETE', headers: getHeaders(config.apiKey) });
};

// -- Delegação: ciclo de vida (aceite) --
// Subconjunto da tarefa que o backend usa para notificar (resolve solicitante/responsável).
const taskRefFields = (task: any) => ({
    id: task?.id,
    fk_user_creat: task?.fk_user_creat,
    label: task?.label,
    ref: task?.ref,
    date_end: task?.date_end,
    progress: task?.progress,
});

export const getDelegation = async (config: DolibarrConfig, taskId: string) => {
    const url = `${sanitizeUrl(config.apiUrl)}/tasks/${taskId}/delegation`;
    return request(url, { method: 'GET', headers: getHeaders(config.apiKey) });
};

export const requestDelegationAcceptance = async (config: DolibarrConfig, taskId: string, task: any, prazoDeAceiteDays?: number, by?: string) => {
    const url = `${sanitizeUrl(config.apiUrl)}/tasks/${taskId}/delegation/request-acceptance`;
    return request(url, { method: 'POST', headers: getHeaders(config.apiKey), body: JSON.stringify({ task: taskRefFields(task), prazoDeAceiteDays, by }) });
};

export const acceptDelegation = async (config: DolibarrConfig, taskId: string, by: string) => {
    const url = `${sanitizeUrl(config.apiUrl)}/tasks/${taskId}/delegation/accept`;
    return request(url, { method: 'POST', headers: getHeaders(config.apiKey), body: JSON.stringify({ by }) });
};

export const declineDelegation = async (config: DolibarrConfig, taskId: string, by: string, reason: string, task: any) => {
    const url = `${sanitizeUrl(config.apiUrl)}/tasks/${taskId}/delegation/decline`;
    return request(url, { method: 'POST', headers: getHeaders(config.apiKey), body: JSON.stringify({ by, reason, task: taskRefFields(task) }) });
};

// Documentação oficial da delegação (objetivo + critério de pronto)
export const setDelegationDoc = async (config: DolibarrConfig, taskId: string, doc: { objetivo?: string; criterio?: string }) => {
    const url = `${sanitizeUrl(config.apiUrl)}/tasks/${taskId}/delegation/doc`;
    return request(url, { method: 'PUT', headers: getHeaders(config.apiKey), body: JSON.stringify(doc) });
};

// Template de execução estruturada (ex.: contagem de estoque)
export const setDelegationTemplate = async (config: DolibarrConfig, taskId: string, template: string, templateConfig?: any) => {
    const url = `${sanitizeUrl(config.apiUrl)}/tasks/${taskId}/delegation/template`;
    return request(url, { method: 'PUT', headers: getHeaders(config.apiKey), body: JSON.stringify({ template, templateConfig }) });
};

// Linha do tempo (histórico) da delegação: [{ type, at, by?, note? }]
export const getDelegationEvents = async (config: DolibarrConfig, taskId: string) => {
    const url = `${sanitizeUrl(config.apiUrl)}/tasks/${taskId}/delegation/events`;
    return request(url, { method: 'GET', headers: getHeaders(config.apiKey) });
};
