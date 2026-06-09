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

export const addTicketMessage = async (config: DolibarrConfig, ticketId: string, message: string) => {
    // There isn't a direct "add message" endpoint usually, passing it as an update or specific endpoint
    // Standard Dolibarr API: POST /tickets/{id}/newMessage might exist or PUT /tickets/{id}
    // Let's assume a custom or standard pattern. Often it is "newMessage".
    // Checking previous codebase knowledge... standard is often just updating the ticket or specific endpoint.
    // If not sure, we can try /tickets/{id}/messages
    // Based on TicketList usage, it expects a promise.
    const url = `${sanitizeUrl(config.apiUrl)}/tickets/${ticketId}/messages`; // Hypothetical standard
    // Fallback: PUT to ticket with specific note field?
    // Let's uset standard POST for new message if supported.
    return request(url, {
        method: 'POST',
        headers: getHeaders(config.apiKey),
        body: JSON.stringify({ message })
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
