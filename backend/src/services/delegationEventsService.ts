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
import { socketService } from './socketService';

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
    by?: string;       // userId de quem AGIU (resolvido p/ nome no frontend); ausente = sistema
    to?: string;       // userId do DESTINATÁRIO da ação (p/ quem foi a cobrança/escalada/etc.)
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

    /** Todos os eventos de todas as delegações (com o taskId), do mais novo ao mais antigo. (#519) */
    listAll(limit = 1000): Array<DelegationEvent & { taskId: string }> {
        const out: Array<DelegationEvent & { taskId: string }> = [];
        for (const [taskId, evs] of Object.entries(this.store)) {
            for (const ev of evs) out.push({ ...ev, taskId });
        }
        out.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
        return out.slice(0, limit);
    }

    /** Registra um evento (local) e espelha no Dolibarr como actioncomm (best-effort). */
    logEvent(taskId: string, type: DelegationEventType, opts: { by?: string; to?: string; atMs?: number; note?: string } = {}): DelegationEvent {
        const id = String(taskId);
        const ev: DelegationEvent = {
            type,
            at: new Date(opts.atMs ?? Date.now()).toISOString(),
            by: opts.by,
            to: opts.to,
            note: opts.note,
        };
        this.store[id] = [...(this.store[id] || []), ev];
        this.save();
        // Tempo real p/ a Central de Eventos (#519) — sinal "algo mudou"; o front re-busca com a
        // visibilidade reaplicada no backend. Best-effort, nunca quebra o fluxo.
        try { socketService.emit('delegation_event', { taskId: id, type, at: ev.at, by: ev.by, to: ev.to }); } catch { /* noop */ }
        // Espelho durável no Dolibarr — nunca bloqueia/derruba o fluxo principal.
        this.mirror(id, type, opts).catch((e) => log.warn(`mirror actioncomm falhou (task=${id})`, e?.message || e));
        return ev;
    }

    private async mirror(taskId: string, type: DelegationEventType, opts: { by?: string; to?: string; note?: string }): Promise<void> {
        await dolibarrService.createAgendaEvent({
            label: `[Delegação] ${LABELS[type]}`,
            // Categoria NATIVA de eventos automáticos do Dolibarr (type 'systemauto'). O Dolibarr
            // esconde esses da agenda por padrão (filtro de eventos automáticos), como faz com os
            // que ele mesmo cria (projeto/tarefa). Antes caía em AC_OTH e poluía a agenda de todos.
            type_code: 'AC_OTH_AUTO',
            note: opts.note || '',
            fk_element: taskId,
            elementtype: 'project_task',
            // Dono do evento na agenda = destinatário (a quem concerne), com fallback p/ o autor.
            userownerid: opts.to ?? opts.by,
        });
    }
}

export const delegationEventsService = new DelegationEventsService();
