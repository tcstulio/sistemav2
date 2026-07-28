/**
 * #1036 — Testes do registry de tools (`agent/tools/index.ts`).
 *
 * Critério de aceite central: "Tool `delegate` aparece em `listTools()` com schema correto".
 * Cobre registro, listagem, lookup por nome e a corretude do schema declarado.
 */
import { describe, it, expect } from 'vitest';

import {
    listTools,
    listToolNames,
    getTool,
    hasTool,
    registerTool,
    unregisterTool,
    clearTools,
    type ToolDefinition,
} from '../../../agent/tools';

describe('#1036 — registry de tools (listTools/getTool/hasTool)', () => {
    it('listTools() retorna um array e INCLUI a tool delegate', () => {
        const tools = listTools();
        expect(Array.isArray(tools)).toBe(true);
        expect(tools.some((t) => t.name === 'delegate')).toBe(true);
    });

    it('listToolNames() contém "delegate"', () => {
        expect(listToolNames()).toContain('delegate');
    });

    it('hasTool("delegate") é true e getTool("delegate") devolve a definição', () => {
        expect(hasTool('delegate')).toBe(true);
        const def = getTool('delegate');
        expect(def).toBeDefined();
        expect(def!.name).toBe('delegate');
    });

    it('getTool de nome inexistente devolve undefined', () => {
        expect(getTool('nao_existe_12345')).toBeUndefined();
        expect(hasTool('nao_existe_12345')).toBe(false);
    });

    it('registerTool/substituição: re-registrar a mesma tool sobrescreve sem duplicar', () => {
        const before = listToolNames().filter((n) => n === 'delegate').length;
        const clone: ToolDefinition = {
            name: 'delegate',
            description: 'clone',
            inputSchema: {},
            execute: async () => 'clone-result',
        };
        registerTool(clone);
        const after = listToolNames().filter((n) => n === 'delegate').length;
        expect(after).toBe(before); // não duplicou
        expect(getTool('delegate')!.description).toBe('clone');
    });

    it('registerTool rejeita definição sem name', () => {
        expect(() => registerTool({ name: '', description: 'x', inputSchema: {}, execute: async () => '' }))
            .toThrow();
    });

    it('unregisterTool remove a tool e clearTools esvazia o registry', () => {
        registerTool({ name: 'tmp_x', description: 't', inputSchema: {}, execute: async () => '' });
        expect(hasTool('tmp_x')).toBe(true);
        expect(unregisterTool('tmp_x')).toBe(true);
        expect(hasTool('tmp_x')).toBe(false);
        expect(unregisterTool('tmp_x')).toBe(false);

        clearTools();
        expect(listTools()).toEqual([]);
        // restaura o estado para os próximos testes (o import inicial registra delegate)
        // — vitest roda cada arquivo em isolamento de módulo, então isto não vaza.
    });
});

describe('#1036 — schema da tool delegate no registry está correto', () => {
    const def = getTool('delegate')!;

    it('nome e descrição', () => {
        expect(def.name).toBe('delegate');
        expect(def.description).toMatch(/delegar uma sub-tarefa/i);
        expect(def.description).toMatch(/sub-agente isolado/i);
        expect(def.description).toMatch(/resumo/);
    });

    it('objective: string, obrigatório', () => {
        const p = def.inputSchema.objective;
        expect(p).toBeDefined();
        expect(p!.type).toBe('string');
        expect(p!.required).toBe(true);
        expect(p!.description.length).toBeGreaterThan(0);
    });

    it('tools: array de string, opcional, com items string', () => {
        const p = def.inputSchema.tools;
        expect(p).toBeDefined();
        expect(p!.type).toBe('array');
        expect(p!.required).toBeFalsy();
        expect(p!.items).toEqual({ type: 'string' });
    });

    it('max_iterations: number, default 5, minimum 1, maximum 10', () => {
        const p = def.inputSchema.max_iterations;
        expect(p).toBeDefined();
        expect(p!.type).toBe('number');
        expect(p!.default).toBe(5);
        expect(p!.minimum).toBe(1);
        expect(p!.maximum).toBe(10);
    });

    it('o executor é uma função assíncrona', () => {
        expect(typeof def.execute).toBe('function');
    });
});
