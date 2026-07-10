import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { atomicWriteSync } from '../utils/atomicWrite';
import { logger } from '../utils/logger';

const log = logger.child('AgentPrompt');

const DATA_DIR = path.join(__dirname, '../../data');
const STORE_FILE = path.join(DATA_DIR, 'agent_prompt.json');
const MAX_HISTORY = 5;

/**
 * Texto-base original do Marciano (system prompt). Editável pelo admin na aba
 * "Config IA" (issue #1005). "Restaurar padrão" volta para este texto.
 */
export const DEFAULT_SYSTEM_PROMPT = `Você é o Marciano — o agente de inteligência artificial do CoolGroove (ERP Dolibarr).

Princípios:
- Responda de forma prestativa, profissional e concisa em Português do Brasil.
- Use as ferramentas disponíveis para consultar dados reais do Dolibarr antes de afirmar algo.
- Nunca invente dados (valores, saldos, prazos). Se não souber, diga que vai verificar.
- Para ações irreversíveis (pagar, enviar mensagem, criar fatura), confirme com o usuário.
- Respeite as permissões e limites do usuário que está conversando.`;

export interface AgentPromptActor {
    id: string;
    login: string;
    name: string;
}

export interface AgentPromptHistoryEntry {
    id: string;
    timestamp: number;
    changedBy: AgentPromptActor;
    previousPrompt: string;
    prompt: string;
    action: 'update' | 'restore';
}

export interface AgentPromptSnapshot {
    systemPrompt: string;
    defaultPrompt: string;
    history: AgentPromptHistoryEntry[];
    canEdit: boolean;
}

interface StoreState {
    systemPrompt: string;
    history: AgentPromptHistoryEntry[];
}

class AgentPromptStore {
    private state: StoreState = {
        systemPrompt: DEFAULT_SYSTEM_PROMPT,
        history: [],
    };

    constructor() {
        this.load();
    }

    private load(): void {
        try {
            if (!fs.existsSync(STORE_FILE)) return;
            const raw = JSON.parse(fs.readFileSync(STORE_FILE, 'utf-8'));
            if (raw && typeof raw === 'object') {
                if (typeof raw.systemPrompt === 'string' && raw.systemPrompt.length > 0) {
                    this.state.systemPrompt = raw.systemPrompt;
                }
                if (Array.isArray(raw.history)) {
                    this.state.history = raw.history
                        .filter((h: any) => h && typeof h === 'object')
                        .slice(0, MAX_HISTORY);
                }
            }
        } catch (e) {
            log.error('Falha ao carregar agent_prompt.json — usando defaults', e);
            this.state = { systemPrompt: DEFAULT_SYSTEM_PROMPT, history: [] };
        }
    }

    private save(): void {
        if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
        atomicWriteSync(STORE_FILE, this.state);
    }

    /** Snapshot imutável para a API. `canEdit` é definido pela camada de auth. */
    getSnapshot(canEdit: boolean): AgentPromptSnapshot {
        return {
            systemPrompt: this.state.systemPrompt,
            defaultPrompt: DEFAULT_SYSTEM_PROMPT,
            history: this.state.history.map(h => ({ ...h, changedBy: { ...h.changedBy } })),
            canEdit,
        };
    }

    /** Texto-base atual — consumido por agentConfigService.getSystemPrompt(). */
    getBasePrompt(): string {
        return this.state.systemPrompt;
    }

    private pushHistory(previousPrompt: string, prompt: string, actor: AgentPromptActor, action: 'update' | 'restore'): void {
        const entry: AgentPromptHistoryEntry = {
            id: randomUUID(),
            timestamp: Date.now(),
            changedBy: { ...actor },
            previousPrompt,
            prompt,
            action,
        };
        this.state.history = [entry, ...this.state.history].slice(0, MAX_HISTORY);
    }

    update(newPrompt: string, actor: AgentPromptActor, canEdit = true): AgentPromptSnapshot {
        const trimmed = (newPrompt || '').trim();
        // Sem alteração de estado real quando idêntico — mas ainda devolve snapshot.
        if (trimmed.length === 0 || trimmed === this.state.systemPrompt) {
            return this.getSnapshot(canEdit);
        }
        const previous = this.state.systemPrompt;
        this.state.systemPrompt = trimmed;
        this.pushHistory(previous, trimmed, actor, 'update');
        this.save();
        log.info(`System prompt atualizado por ${actor.login} (${trimmed.length} chars)`);
        return this.getSnapshot(canEdit);
    }

    restoreDefault(actor: AgentPromptActor, canEdit = true): AgentPromptSnapshot {
        const previous = this.state.systemPrompt;
        if (previous === DEFAULT_SYSTEM_PROMPT) {
            return this.getSnapshot(canEdit);
        }
        this.state.systemPrompt = DEFAULT_SYSTEM_PROMPT;
        this.pushHistory(previous, DEFAULT_SYSTEM_PROMPT, actor, 'restore');
        this.save();
        log.info(`System prompt restaurado para o padrão por ${actor.login}`);
        return this.getSnapshot(canEdit);
    }

    /** Reseta para o padrão e limpa o histórico (utilizado em testes). */
    reset(): void {
        this.state = { systemPrompt: DEFAULT_SYSTEM_PROMPT, history: [] };
    }
}

export const agentPromptStore = new AgentPromptStore();
