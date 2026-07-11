import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('fs', () => {
    const m = { existsSync: vi.fn(() => false), mkdirSync: vi.fn(), readFileSync: vi.fn() };
    return { ...m, default: m };
});
vi.mock('../../utils/atomicWrite', () => ({ atomicWriteSync: vi.fn() }));
vi.mock('crypto', () => ({ randomUUID: vi.fn(() => Math.random().toString(36).slice(2)) }));

import { agentPromptStore, DEFAULT_SYSTEM_PROMPT } from '../../services/agentPromptStore';

const ACTOR = { id: 'u1', login: 'admin', name: 'Admin Teste' };

describe('agentPromptStore', () => {
    beforeEach(() => {
        agentPromptStore.reset();
    });

    it('inicia com o prompt padrão e histórico vazio', () => {
        const snap = agentPromptStore.getSnapshot(false);
        expect(snap.systemPrompt).toBe(DEFAULT_SYSTEM_PROMPT);
        expect(snap.defaultPrompt).toBe(DEFAULT_SYSTEM_PROMPT);
        expect(snap.history).toEqual([]);
        expect(snap.canEdit).toBe(false);
    });

    it('getSnapshot reflete canEdit', () => {
        expect(agentPromptStore.getSnapshot(true).canEdit).toBe(true);
        expect(agentPromptStore.getSnapshot(false).canEdit).toBe(false);
    });

    it('getSnapshot retorna cópias (sem mutação externa)', () => {
        const snap = agentPromptStore.getSnapshot(true);
        snap.systemPrompt = 'mutado';
        snap.history.push({} as any);
        expect(agentPromptStore.getSnapshot(true).systemPrompt).toBe(DEFAULT_SYSTEM_PROMPT);
        expect(agentPromptStore.getSnapshot(true).history).toEqual([]);
    });

    it('getBasePrompt retorna o texto atual', () => {
        expect(agentPromptStore.getBasePrompt()).toBe(DEFAULT_SYSTEM_PROMPT);
    });

    it('update altera o prompt e registra histórico', () => {
        const snap = agentPromptStore.update('Novo prompt', ACTOR, true);
        expect(snap.systemPrompt).toBe('Novo prompt');
        expect(snap.canEdit).toBe(true);
        expect(snap.history).toHaveLength(1);
        expect(snap.history[0].previousPrompt).toBe(DEFAULT_SYSTEM_PROMPT);
        expect(snap.history[0].prompt).toBe('Novo prompt');
        expect(snap.history[0].action).toBe('update');
        expect(snap.history[0].changedBy.login).toBe('admin');
        expect(snap.history[0].timestamp).toBeGreaterThan(0);
    });

    it('update com texto vazio é no-op (não registra histórico)', () => {
        const snap = agentPromptStore.update('   ', ACTOR, true);
        expect(snap.systemPrompt).toBe(DEFAULT_SYSTEM_PROMPT);
        expect(snap.history).toHaveLength(0);
    });

    it('update com texto idêntico ao atual é no-op', () => {
        agentPromptStore.update('Primeiro', ACTOR, true);
        const before = agentPromptStore.getSnapshot(true);
        agentPromptStore.update('Primeiro', ACTOR, true);
        const after = agentPromptStore.getSnapshot(true);
        expect(after.history).toHaveLength(before.history.length);
    });

    it('histórico é limitado às últimas 5 alterações (mais recente primeiro)', () => {
        for (let i = 1; i <= 7; i++) {
            agentPromptStore.update(`versao-${i}`, ACTOR, true);
        }
        const snap = agentPromptStore.getSnapshot(true);
        expect(snap.history).toHaveLength(5);
        expect(snap.systemPrompt).toBe('versao-7');
        // mais recente primeiro
        expect(snap.history[0].prompt).toBe('versao-7');
        expect(snap.history[0].previousPrompt).toBe('versao-6');
        expect(snap.history[4].prompt).toBe('versao-3');
    });

    it('restoreDefault volta ao padrão e registra no histórico', () => {
        agentPromptStore.update('custom', ACTOR, true);
        const snap = agentPromptStore.restoreDefault(ACTOR, true);
        expect(snap.systemPrompt).toBe(DEFAULT_SYSTEM_PROMPT);
        expect(snap.history).toHaveLength(2);
        expect(snap.history[0].action).toBe('restore');
        expect(snap.history[0].previousPrompt).toBe('custom');
        expect(snap.history[0].prompt).toBe(DEFAULT_SYSTEM_PROMPT);
    });

    it('restoreDefault quando já é o padrão é no-op', () => {
        const snap = agentPromptStore.restoreDefault(ACTOR, true);
        expect(snap.systemPrompt).toBe(DEFAULT_SYSTEM_PROMPT);
        expect(snap.history).toHaveLength(0);
    });

    it('update faz trim do texto', () => {
        const snap = agentPromptStore.update('  texto com espaços  ', ACTOR, true);
        expect(snap.systemPrompt).toBe('texto com espaços');
    });
});

// #1316: a apresentação inicial do DEFAULT_SYSTEM_PROMPT não pode mencionar
// "sistemav2" nem "ERP Dolibarr".
describe('DEFAULT_SYSTEM_PROMPT — apresentação inicial (#1316)', () => {
    it('não menciona "sistemav2"', () => {
        expect(DEFAULT_SYSTEM_PROMPT.toLowerCase()).not.toContain('sistemav2');
    });

    it('não menciona "ERP Dolibarr" na linha de abertura', () => {
        const opening = DEFAULT_SYSTEM_PROMPT.split('\n')[0].toLowerCase();
        expect(opening).not.toContain('erp dolibarr');
        expect(opening).not.toContain('dolibarr');
    });

    it('continua identificando o Marciano e a Coolgroove', () => {
        expect(DEFAULT_SYSTEM_PROMPT).toContain('Marciano');
        expect(DEFAULT_SYSTEM_PROMPT).toContain('Coolgroove');
    });

    it('é igual ao prompt retornado por restoreDefault', () => {
        agentPromptStore.update('temporário', ACTOR, true);
        const snap = agentPromptStore.restoreDefault(ACTOR, true);
        expect(snap.systemPrompt).toBe(DEFAULT_SYSTEM_PROMPT);
    });
});
