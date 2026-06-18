/**
 * Log de eventos da delegação (Fase 1.6) — a fonte única da "linha do tempo" (quem/quando/o quê).
 * Persiste local em data/delegation_events.json e ESPELHA cada evento como actioncomm no Dolibarr
 * (best-effort, ligado à tarefa) para a trilha ser durável/visível lá. Issues #292/#293.
 */
import fs from 'fs';
import path from 'path';
import { atomicWriteSync } from '../utils/atomicWrite';
import { createLogger } from '../utils/logger';
import { dolibarrService } from './dolibarr';

const log = createLogger('DelegationEvents');

export type DelegationEventType =
    | 'requested'      // aceite solicitado
    | 'accepted'
    | 'declined'
    | 'doc_updated'
    | 'template_set'
    | 'cobranca'       // overdue (cobrança da entrega)
    | 'escalated'      // stalled OU acceptance_overdue
    | 'completed'      // concluída/reportada
    | 'reminder';      // deadline_reminder

export interface DelegationEvent {
    type: DelegationEventType;
    at: string;        // ISO
    by?: string;       // userId (resolvido p/ nome no frontend); ausente = sistema
    note?: string;
}

const LABELS: Record<DelegationEventType, string> = {
    requested: 'Aceite solicitado',
    accepted: 'Delegação aceita',
    declined: 'Delegação recusada',
    doc_updated: 'Documentação atualizada',
    template_set: 'Template definido',
    cobranca: 'Cobrança enviada',
    escalated: 'Escalada ao solicitante',
    completed: 'Concluída/reportada',
    reminder: 'Lembrete de prazo',
};

type EventStore = Record<string, DelegationEvent[]>;

const DEFAULT_STORE_PATH = path.join(__dirname, '../../data/delegation_events.json');

export class DelegationEventsService {
    private store: EventStore = {};
    private readonly storePath: string;

    constructor(storePath: string = DEFAULT_STORE_PATH) {
        this.storePath = storePath;
        this.load();
    }

    private load() {
        try {
            const dir = path.dirname(this.storePath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            if (fs.existsSync(this.storePath)) this.store = JSON.parse(fs.readFileSync(this.storePath, 'utf-8')) || {};
        } catch (e) { log.error('load error', e); this.store = {}; }
    }

    private save() {
        try { atomicWriteSync(this.storePath, this.store); } catch (e) { log.error('save error', e); }
    }

    /** Eventos de uma delegação, do mais antigo ao mais novo. */
    getEvents(taskId: string): DelegationEvent[] {
        return this.store[String(taskId)] || [];
    }

    /** Registra um evento (local) e espelha no Dolibarr como actioncomm (best-effort). */
    logEvent(taskId: string, type: DelegationEventType, opts: { by?: string; atMs?: number; note?: string } = {}): DelegationEvent {
        const id = String(taskId);
        const ev: DelegationEvent = {
            type,
            at: new Date(opts.atMs ?? Date.now()).toISOString(),
            by: opts.by,
            note: opts.note,
        };
        this.store[id] = [...(this.store[id] || []), ev];
        this.save();
        // Espelho durável no Dolibarr — nunca bloqueia/derruba o fluxo principal.
        this.mirror(id, type, opts).catch((e) => log.warn(`mirror actioncomm falhou (task=${id})`, e?.message || e));
        return ev;
    }

    private async mirror(taskId: string, type: DelegationEventType, opts: { by?: string; note?: string }): Promise<void> {
        await dolibarrService.createAgendaEvent({
            label: `[Delegação] ${LABELS[type]}`,
            // Categoria própria (#: agenda lotada) — escondida da agenda normal (igual AC_CHAT),
            // visível como trilha de delegação. Antes caía em AC_OTH e poluía a agenda de todos.
            type_code: 'AC_DELEG',
            note: opts.note || '',
            fk_element: taskId,
            elementtype: 'project_task',
            userownerid: opts.by,
        });
    }
}

export const delegationEventsService = new DelegationEventsService();
