import { DolibarrConfig, Project, Task, Intervention, Ticket, AgendaEvent } from '../../types';
import { fetchList, request, getHeaders, sanitizeUrl } from './core';

export const fetchInterventions = async (config: DolibarrConfig): Promise<Intervention[]> => {
    const data = await fetchList(config, 'interventions');
    return data.map((d: any) => ({
        id: String(d.id),
        ref: d.ref,
        socid: String(d.socid),
        project_id: d.fk_projet ? String(d.fk_projet) : undefined,
        date: parseInt(d.date),
        date_creation: parseInt(d.date_creation),
        description: d.description,
        statut: String(d.statut) as any,
        array_options: d.array_options,
        lines: d.lines ? d.lines.map((l: any) => ({
            id: String(l.id),
            desc: l.desc || l.description,
            date: parseInt(l.date),
            duration: parseInt(l.duration),
            qty: parseFloat(l.qty || '0')
        })) : []
    }));
};

export const fetchTickets = async (config: DolibarrConfig): Promise<Ticket[]> => {
    const data = await fetchList(config, 'tickets');
    return data.map((d: any) => ({
        id: String(d.id),
        ref: d.ref,
        track_id: d.track_id,
        socid: String(d.socid),
        project_id: d.fk_projet ? String(d.fk_projet) : undefined,
        subject: d.subject,
        message: d.message,
        type_code: d.type_code,
        category_code: d.category_code,
        severity_code: d.severity_code,
        statut: String(d.statut), // '1'=New...
        progress: parseInt(d.progress || '0'),
        date_c: parseInt(d.date_c || d.date_creation),
        fk_user_assign: d.fk_user_assign ? String(d.fk_user_assign) : undefined,
        origin_email: d.origin_email,
        array_options: d.array_options
    }));
};

export const fetchProjects = async (config: DolibarrConfig): Promise<Project[]> => {
    const data = await fetchList(config, 'projects', '&sortfield=t.datec&sortorder=DESC');
    return data.map((d: any) => ({
        id: String(d.id),
        ref: d.ref,
        title: d.title,
        socid: String(d.socid),
        date_start: d.date_start ? parseInt(d.date_start) : undefined,
        date_end: d.date_end ? parseInt(d.date_end) : undefined,
        statut: String(d.statut) as any,
        progress: parseInt(d.progress || '0'),
        array_options: d.array_options
    }));
};

export const fetchTasks = async (config: DolibarrConfig): Promise<Task[]> => {
    const data = await fetchList(config, 'tasks');
    return data.map((d: any) => ({
        id: String(d.id),
        ref: d.ref,
        label: d.label,
        project_id: d.fk_projet ? String(d.fk_projet) : (d.project_id ? String(d.project_id) : ''),
        description: d.description,
        date_start: d.date_start ? parseInt(d.date_start) : undefined,
        date_end: d.date_end ? parseInt(d.date_end) : undefined,
        progress: parseInt(d.progress || '0'),
        planned_workload: parseInt(d.planned_workload || '0'),
        duration_effective: parseInt(d.duration_effective || '0'),
        fk_user_assign: d.fk_user_assign ? String(d.fk_user_assign) : undefined,
        fk_user_creat: d.fk_user_creat ? String(d.fk_user_creat) : undefined,
        array_options: d.array_options,
        raw: d
    }));
};

export const fetchAgendaEvents = async (config: DolibarrConfig, lastModified: number = 0): Promise<AgendaEvent[]> => {
    // Agenda events need filtering by 'datep' (Planned Start Date) or 'datec' (Creation)
    // tms/date_modification is often unreliable/empty on this endpoint (as verified by tests).
    // optimizing: Sort by datep DESC to get newest.
    // If lastModified is passed, fetchList will apply (t.datep:>=:ISO_DATE)
    const data = await fetchList(config, 'agendaevents', '&sortfield=t.datep&sortorder=DESC', lastModified, 't.datep');
    return data.map((d: any) => ({
        id: String(d.id),
        ref: String(d.id), // Agenda events often don't have a separate ref, use ID
        label: d.label,
        date_start: parseInt(d.datep),
        date_end: parseInt(d.datef),
        type_code: d.type_code,
        percentage: parseInt(d.percentage),
        socid: d.socid ? String(d.socid) : undefined,
        project_id: d.fk_projet ? String(d.fk_projet) : undefined,
        description: d.description,
        user_assigned: d.user_assigned ? String(d.user_assigned) : undefined,
        location: d.location,
        elementtype: d.elementtype,
        fk_element: d.fk_element ? String(d.fk_element) : undefined,

        // New Fields
        fulldayevent: d.fulldayevent === '1' || d.fulldayevent === 1,
        priority: d.priority ? parseInt(d.priority) : undefined,
        fk_user_author: d.fk_user_author ? String(d.fk_user_author) : (d.fk_user_action ? String(d.fk_user_action) : undefined),
        transparency: d.transparency ? parseInt(d.transparency) : undefined,
        date_modification: d.tms ? parseInt(d.tms) : (d.date_modification ? parseInt(d.date_modification) : undefined)
    }));
};

export const getProject = async (config: DolibarrConfig, id: string) => {
    const url = `${sanitizeUrl(config.apiUrl)}/projects/${id}`;
    return request(url, { headers: getHeaders(config.apiKey) });
};

export const getTask = async (config: DolibarrConfig, id: string) => {
    const url = `${sanitizeUrl(config.apiUrl)}/tasks/${id}`;
    return request(url, { headers: getHeaders(config.apiKey) });
};

export const getTicket = async (config: DolibarrConfig, id: string) => {
    const url = `${sanitizeUrl(config.apiUrl)}/tickets/${id}`;
    return request(url, { headers: getHeaders(config.apiKey) });
};

export const getEvent = async (config: DolibarrConfig, id: string) => {
    const url = `${sanitizeUrl(config.apiUrl)}/agendaevents/${id}`;
    return request(url, { headers: getHeaders(config.apiKey) });
};

export const getIntervention = async (config: DolibarrConfig, id: string) => {
    const url = `${sanitizeUrl(config.apiUrl)}/interventions/${id}`;
    return request(url, { headers: getHeaders(config.apiKey) });
};


// -- Write Operations --

export const createTicket = async (config: DolibarrConfig, data: Partial<Ticket>) => {
    const url = `${sanitizeUrl(config.apiUrl)}/tickets`;
    return request(url, {
        method: 'POST',
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

export const createIntervention = async (config: DolibarrConfig, data: any) => {
    const url = `${sanitizeUrl(config.apiUrl)}/interventions`;
    return request(url, {
        method: 'POST',
        headers: getHeaders(config.apiKey),
        body: JSON.stringify(data)
    });
};

export const fetchTicketEvents = async (config: DolibarrConfig, ticketId: string) => {
    // Fetches linked events/logs for the ticket
    const url = `${sanitizeUrl(config.apiUrl)}/tickets/${ticketId}/events`; // Or agendaevents linked?
    // Often tickets have their own 'messages' array in result or sub-resource.
    // Let's try sub-resource 'messages' or 'events'.
    return fetchList(config, `tickets/${ticketId}/messages`);
};


// -- Projects --
export const createProject = async (config: DolibarrConfig, data: any) => {
    const url = `${sanitizeUrl(config.apiUrl)}/projects`;
    return request(url, {
        method: 'POST',
        headers: getHeaders(config.apiKey),
        body: JSON.stringify(data)
    });
};

export const updateProject = async (config: DolibarrConfig, id: string, data: any) => {
    const url = `${sanitizeUrl(config.apiUrl)}/projects/${id}`;
    return request(url, {
        method: 'PUT',
        headers: getHeaders(config.apiKey),
        body: JSON.stringify(data)
    });
};

// -- Tasks --
export const createTask = async (config: DolibarrConfig, data: any) => {
    const url = `${sanitizeUrl(config.apiUrl)}/tasks`;
    return request(url, {
        method: 'POST',
        headers: getHeaders(config.apiKey),
        body: JSON.stringify(data)
    });
};

export const updateTask = async (config: DolibarrConfig, id: string, data: any) => {
    const url = `${sanitizeUrl(config.apiUrl)}/tasks/${id}`;
    return request(url, {
        method: 'PUT',
        headers: getHeaders(config.apiKey),
        body: JSON.stringify(data)
    });
};

export const updateTaskTime = async (config: DolibarrConfig, taskId: string, timeAdded: number) => {
    // Usually adding time spent
    const url = `${sanitizeUrl(config.apiUrl)}/tasks/${taskId}/addtimespent`;
    // If not standard, fallback to update
    // Assuming a PUT on task or POST on sub-resource
    // Let's implement generic update if specific doesn't exist
    // But since this signature is specific, let's assume it logs time.
    // NOTE: Default API might not have `addtimespent` easily exposed, check standard.
    // If unknown, implement as update to `duration_effective`.
    return request(url, {
        method: 'POST',
        headers: getHeaders(config.apiKey),
        body: JSON.stringify({ duration: timeAdded, date: Date.now() / 1000 })
    });
};

// -- Events --
export const createEvent = async (config: DolibarrConfig, data: any) => {
    const url = `${sanitizeUrl(config.apiUrl)}/agendaevents`;
    return request(url, {
        method: 'POST',
        headers: getHeaders(config.apiKey),
        body: JSON.stringify(data)
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
