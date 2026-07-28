/**
 * Delegation Service (Fase 1.5) — metadados do CICLO de vida da delegação, sobre uma tarefa
 * do Dolibarr. Os fatos estruturais (objetivo=label, prazo=date_end, responsável=element_contact,
 * solicitante=fk_user_creat, progresso) vivem no Dolibarr; aqui guardamos o que ainda não tem
 * casa estrutural: estado de ACEITE, critério de pronto e objetivo. Store durável em
 * data/delegation_store.json (migração futura p/ array_options do Dolibarr).
 *
 * O motor (delegationFollowUpService) lê o aceite daqui via getAceite() para decidir entre
 * "cobrar o aceite/escalar" e "cobrar a entrega".
 */
import fs from 'fs';
import path from 'path';
import { atomicWriteSync } from '../utils/atomicWrite';
import { createLogger } from '../utils/logger';
import { AceiteState, dayIndex, DEFAULT_CADENCE } from './delegationFollowUpLogic';
import { uiConfigService } from './uiConfigService';
import { dolibarrService } from './dolibarr';

const log = createLogger('Delegation');

export type AceiteStatus = 'pending' | 'accepted' | 'declined';

export interface DelegationRecord {
    taskId: string;
    objetivo?: string;   // Inc 2 (documentação oficial)
    criterio?: string;   // Inc 2 (critério de pronto)
    template?: string;          // Inc 5 (ex.: 'contagem_de_estoque')
    templateConfig?: any;       // Inc 5 (ex.: { warehouseId })
    aceite?: {
        status: AceiteStatus;
        deadlineDay?: number; // day index do prazo de aceite
        requestedAt?: string;
        by?: string;          // quem aceitou/recusou
        at?: string;          // quando aceitou/recusou (ISO)
        reason?: string;      // motivo da recusa
    };
}

type DelegationStore = Record<string, DelegationRecord>;

const DEFAULT_STORE_PATH = path.join(__dirname, '../../data/delegation_store.json');

export class DelegationService {
    private store: DelegationStore = {};
    private readonly storePath: string;

    constructor(storePath: string = DEFAULT_STORE_PATH) {
        this.storePath = storePath;
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

    get(taskId: string): DelegationRecord | undefined {
        return this.store[String(taskId)];
    }

    /** Subconjunto do aceite que o motor precisa para decidir. undefined = tarefa comum (sem delegação). */
    getAceite(taskId: string): AceiteState | undefined {
        const rec = this.store[String(taskId)];
        if (!rec?.aceite) return undefined;
        return { status: rec.aceite.status, deadlineDay: rec.aceite.deadlineDay };
    }

    private upsert(taskId: string, patch: Partial<DelegationRecord>): DelegationRecord {
        const id = String(taskId);
        const cur = this.store[id] || { taskId: id };
        const next: DelegationRecord = { ...cur, ...patch, taskId: id };
        this.store[id] = next;
        this.save();
        this.mirror(next); // #293 — espelho durável no Dolibarr (best-effort, não bloqueia)
        return next;
    }

    /** Espelha o estado no extrafield options_delegation_state da tarefa (Dolibarr). #293, fire-and-forget. */
    private mirror(rec: DelegationRecord): void {
        void dolibarrService
            .setTaskDelegationState(rec.taskId, JSON.stringify(rec))
            .catch((e: any) => log.warn(`mirror delegation_state task=${rec.taskId} falhou: ${e?.message || e}`));
    }

    /**
     * Reidrata o cache local a partir dos estados persistidos no Dolibarr (#293). O store local
     * tem prioridade (cache quente): só preenche o que falta. Best-effort. Retorna quantos
     * registros foram reidratados.
     */
    async hydrateFromDolibarr(): Promise<number> {
        let n = 0;
        try {
            const states = await dolibarrService.listDelegationStates();
            for (const { taskId, state } of states) {
                if (this.store[taskId]) continue; // não sobrescreve o cache local
                try {
                    const rec = JSON.parse(state) as DelegationRecord;
                    if (rec && typeof rec === 'object') {
                        this.store[taskId] = { ...rec, taskId };
                        n++;
                    }
                } catch { /* estado corrompido — ignora */ }
            }
            if (n > 0) this.save();
        } catch (e: any) {
            log.warn(`hydrateFromDolibarr falhou: ${e?.message || e}`);
        }
        return n;
    }

    /** Define o template de execução estruturada (ex.: contagem de estoque). */
    setTemplate(taskId: string, template: string, templateConfig?: any): DelegationRecord {
        return this.upsert(taskId, { template, templateConfig });
    }

    /** Documentação oficial: objetivo + critério de pronto (o "o que é esperado"). */
    setDoc(taskId: string, doc: { objetivo?: string; criterio?: string }): DelegationRecord {
        const patch: Partial<DelegationRecord> = {};
        if (doc.objetivo !== undefined) patch.objetivo = doc.objetivo;
        if (doc.criterio !== undefined) patch.criterio = doc.criterio;
        return this.upsert(taskId, patch);
    }

    /** Solicita o aceite: marca pending com um prazo (day index). nowMs injetável p/ teste. */
    requestAcceptance(taskId: string, opts: { nowMs?: number; prazoDeAceiteDays?: number; by?: string } = {}): DelegationRecord {
        const nowMs = opts.nowMs ?? Date.now();
        // #1406 — prazo default vem do `notificationPolicy.cobrancaCadence.prazoDeAceiteDays`
        // lido em runtime do `uiConfigService`. Fallback `DEFAULT_CADENCE` se o config não
        // tiver o bloco (preserva comportamento histórico / testes que não mockam o config).
        const dias = opts.prazoDeAceiteDays ?? this.resolvePrazoDeAceiteDays();
        const deadlineDay = dayIndex(nowMs) + dias;
        return this.upsert(taskId, {
            aceite: { status: 'pending', deadlineDay, requestedAt: new Date(nowMs).toISOString(), by: opts.by },
        });
    }

    /**
     * Resolve o prazo de aceite a partir do `uiConfigService` em runtime (#1406). Se o
     * serviço de config não estiver disponível ou não tiver a chave, devolve
     * `DEFAULT_CADENCE.prazoDeAceiteDays` como rede de segurança.
     */
    private resolvePrazoDeAceiteDays(): number {
        try {
            return uiConfigService.getCobrancaCadence().prazoDeAceiteDays;
        } catch (e) {
            log.warn('uiConfigService.getCobrancaCadence() falhou em requestAcceptance; usando DEFAULT_CADENCE', e);
            return DEFAULT_CADENCE.prazoDeAceiteDays;
        }
    }

    accept(taskId: string, by: string, nowMs: number = Date.now()): DelegationRecord {
        const cur = this.store[String(taskId)];
        return this.upsert(taskId, {
            aceite: { ...(cur?.aceite || { status: 'pending' }), status: 'accepted', by, at: new Date(nowMs).toISOString() },
        });
    }

    decline(taskId: string, by: string, reason?: string, nowMs: number = Date.now()): DelegationRecord {
        const cur = this.store[String(taskId)];
        return this.upsert(taskId, {
            aceite: { ...(cur?.aceite || { status: 'pending' }), status: 'declined', by, reason, at: new Date(nowMs).toISOString() },
        });
    }
}

export const delegationService = new DelegationService();
