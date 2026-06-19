/**
 * Motor de acompanhamento de delegações (Fase 1d).
 *
 * Um "tick" diário percorre as tarefas em aberto e, por REGRAS (cadência), decide e dispara
 * a próxima ação via dispatchTaskNotification (camada 2): lembra antes do prazo, cobra o
 * Responsável no vencimento, re-cobra, escala ao solicitante (Criador) e reporta a conclusão.
 *
 * Estado durável por tarefa em data/delegation_tracking.json (sobrevive a restart) — guarda
 * nº de cobranças, datas e flags. A decisão é pura (delegationFollowUpLogic); aqui só há I/O.
 *
 * Trava de canais externos da camada 2 segue valendo: por padrão só 'in-app' sai.
 */
import fs from 'fs';
import path from 'path';
import { atomicWriteSync } from '../utils/atomicWrite';
import { createLogger } from '../utils/logger';
import { dolibarrService } from './dolibarr';
import { dispatchTaskNotification } from './taskNotificationService';
import { delegationService } from './delegationService';
import { delegationEventsService, DelegationEventType } from './delegationEventsService';
import { resolveRoleUsers, RoleUsers } from './taskNotificationLogic';
import { decideFollowUp, Cadence, DEFAULT_CADENCE, TaskTracking, FollowUpEvent } from './delegationFollowUpLogic';

// Evento do motor -> tipo no log da delegação (linha do tempo). by=sistema (undefined).
const EVENT_TO_LOG: Record<FollowUpEvent, DelegationEventType> = {
    acceptance_pending: 'requested',
    acceptance_overdue: 'escalated',
    deadline_reminder: 'reminder',
    overdue: 'cobranca',
    stalled: 'escalated',
    completed: 'completed',
};

/** Destinatário do evento do motor: cobrança/lembrete vão ao Responsável; escalada/conclusão ao Solicitante. */
function targetForEvent(event: FollowUpEvent, roles: RoleUsers): string | undefined {
    switch (event) {
        case 'overdue':            // cobrança da entrega
        case 'deadline_reminder':  // lembrete de prazo
        case 'acceptance_pending': // solicitação de aceite (não vem do tick, mas por completude)
            return roles.responsavel[0] || roles.criador[0];
        case 'acceptance_overdue': // aceite estourado
        case 'stalled':            // parada → escala
        case 'completed':          // reporte da conclusão
            return roles.criador[0] || roles.responsavel[0];
    }
}

const log = createLogger('DelegationFollowUp');

/** Descrição com contexto p/ o evento de agenda da delegação (antes ia sem informação). */
function buildDelegationNote(task: any): string {
    const parts = [`Tarefa: ${task.label || `#${task.id}`}`];
    if (task.ref) parts.push(`Ref: ${task.ref}`);
    if (task.date_end) {
        const d = new Date(Number(task.date_end) * 1000);
        if (!isNaN(d.getTime())) parts.push(`Prazo: ${d.toLocaleDateString('pt-BR')}`);
    }
    if (task.progress !== undefined && task.progress !== null && task.progress !== '') {
        parts.push(`Progresso: ${task.progress}%`);
    }
    return parts.join(' — ');
}

type TrackingStore = Record<string, TaskTracking>;

export interface TickResult {
    tasks: number;
    baselines: number;
    acceptance_pending: number; // nunca disparado pelo tick (vem da rota); mantido p/ tipagem
    acceptance_overdue: number;
    deadline_reminder: number;
    overdue: number;
    stalled: number;
    completed: number;
}

const DEFAULT_STORE_PATH = path.join(__dirname, '../../data/delegation_tracking.json');

export class DelegationFollowUpService {
    private store: TrackingStore = {};
    private readonly storePath: string;
    private cadence: Cadence;
    /** teto de disparos por tick (rede de segurança; o baseline-na-1ª-vez já evita flood). */
    private readonly maxDispatchesPerTick = 200;

    constructor(storePath: string = DEFAULT_STORE_PATH, cadence: Cadence = DEFAULT_CADENCE) {
        this.storePath = storePath;
        this.cadence = cadence;
        this.load();
    }

    private load() {
        try {
            const dir = path.dirname(this.storePath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            if (fs.existsSync(this.storePath)) {
                this.store = JSON.parse(fs.readFileSync(this.storePath, 'utf-8')) || {};
            }
        } catch (e) {
            log.error('load error', e);
            this.store = {};
        }
    }

    private save() {
        try {
            atomicWriteSync(this.storePath, this.store);
        } catch (e) {
            log.error('save error', e);
        }
    }

    /** Executa um tick de acompanhamento. `nowMs` é injetável para teste. */
    async runTick(nowMs: number = Date.now()): Promise<TickResult> {
        const result: TickResult = { tasks: 0, baselines: 0, acceptance_pending: 0, acceptance_overdue: 0, deadline_reminder: 0, overdue: 0, stalled: 0, completed: 0 };
        try {
            const tasks = await dolibarrService.listTasksFull();
            if (!tasks || tasks.length === 0) return result;
            result.tasks = tasks.length;

            const allContacts = await dolibarrService.getAllTaskContacts();
            const contactsByTask = new Map<string, any[]>();
            for (const c of allContacts) {
                const k = String(c.task_id);
                if (!contactsByTask.has(k)) contactsByTask.set(k, []);
                contactsByTask.get(k)!.push(c);
            }

            let dispatches = 0;
            for (const task of tasks) {
                const id = String(task.id);
                const prev = this.store[id];
                const aceite = delegationService.getAceite(id);
                const { event, tracking } = decideFollowUp(task, prev, nowMs, this.cadence, aceite);
                this.store[id] = tracking;

                if (!prev) {
                    result.baselines++;
                    continue; // 1ª observação: só baseline, nada dispara
                }
                if (!event) continue;

                if (dispatches >= this.maxDispatchesPerTick) {
                    log.warn(`tick atingiu o teto de ${this.maxDispatchesPerTick} disparos; restante adiado p/ o próximo tick`);
                    break;
                }
                dispatches++;
                result[event]++;
                const taskContacts = contactsByTask.get(id) || [];
                await dispatchTaskNotification(event, task, { taskContacts });
                // Evento do motor: autor = Sistema (by undefined); o DESTINATÁRIO (to) é quem a ação
                // concerne — cobrança→Responsável, escalada/conclusão→Solicitante. O `to` também vira
                // o dono do espelho de agenda (não cai no admin) e diz "para quem" na trilha. (#526)
                const roles = resolveRoleUsers(task, taskContacts);
                delegationEventsService.logEvent(id, EVENT_TO_LOG[event], {
                    atMs: nowMs,
                    to: targetForEvent(event, roles),
                    note: buildDelegationNote(task),
                });
            }

            this.save();
            const acted = result.acceptance_overdue + result.deadline_reminder + result.overdue + result.stalled + result.completed;
            log.info(`tick: ${result.tasks} tarefas, ${result.baselines} baseline(s), ${acted} ação(ões) ` +
                `[aceite-escala=${result.acceptance_overdue} lembrete=${result.deadline_reminder} cobrança=${result.overdue} escala=${result.stalled} reporte=${result.completed}]`);
        } catch (e) {
            log.error('runTick error', e);
        }
        return result;
    }
}

export const delegationFollowUpService = new DelegationFollowUpService();
