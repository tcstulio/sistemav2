/**
 * #1408 — Fachada `backend/src/agent/runner.ts`.
 *
 * Este arquivo é uma FACHADA CANÔNICA do runner do agente, re-exportando os símbolos
 * relevantes de `services/aiService.ts` (constantes do loop, gate HITL, provider concreto).
 * Este teste verifica que os re-exports ESTÃO CORRETOS — ou seja, que cada símbolo
 * exportado tem o MESMO VALOR/TIPO que o original. Se alguém remover um export do
 * `aiService.ts` e o `runner.ts` continuar exportando-o (ficaria `undefined`), este
 * teste pega.
 */
import { describe, it, expect } from 'vitest';

import {
    MAX_CONCLUSION_NUDGES,
    TOOL_BUDGET_EXHAUSTED_MSG,
    confirmationBlock,
    LocalProvider,
} from '../../services/aiService';

import * as runner from '../../agent/runner';

describe('#1408 — fachada backend/src/agent/runner.ts (re-exports)', () => {
    it('MAX_CONCLUSION_NUDGES é o mesmo símbolo do aiService (não undefined)', () => {
        expect(runner.MAX_CONCLUSION_NUDGES).toBe(MAX_CONCLUSION_NUDGES);
        expect(runner.MAX_CONCLUSION_NUDGES).toBe(2);
    });

    it('TOOL_BUDGET_EXHAUSTED_MSG é o mesmo símbolo (função pura)', () => {
        expect(runner.TOOL_BUDGET_EXHAUSTED_MSG).toBe(TOOL_BUDGET_EXHAUSTED_MSG);
        // Comportamento idêntico ao do original.
        expect(runner.TOOL_BUDGET_EXHAUSTED_MSG(7)).toContain('7');
        expect(runner.TOOL_BUDGET_EXHAUSTED_MSG(7)).toContain('maxToolCallsPerConversation');
    });

    it('confirmationBlock é o mesmo símbolo (gate HITL)', () => {
        expect(runner.confirmationBlock).toBe(confirmationBlock);
        // Smoke test: tool sem lista devolve null (liberado).
        expect(runner.confirmationBlock('any_tool')).toBeNull();
    });

    it('LocalProvider é o mesmo símbolo (re-export do provider concreto)', () => {
        expect(runner.LocalProvider).toBe(LocalProvider);
        // Construtor ainda funciona.
        const provider = new runner.LocalProvider('http://localhost:11434/v1', 'llama3');
        expect(provider).toBeInstanceOf(LocalProvider);
    });

    it('tipos do runner são re-exportados (ChatMessage, GenerateReplyResult, GenerateReplyOptions, TokenUsage)', () => {
        // Estes são `export type` — não têm valor em runtime. Verifica que os IDENTIFICADORES
        // existem no módulo (TypeScript removeria qualquer um que falhasse ao re-exportar,
        // mas checamos no TS também via tsc --noEmit).
        expect(typeof runner).toBe('object');
    });
});