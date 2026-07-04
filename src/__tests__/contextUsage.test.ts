import { describe, it, expect } from 'vitest';
import { getContextUsage } from '../utils/contextUsage';
import type { ChatMessage } from '../services/aiService';

const model = (text: string, totalTokens: number): ChatMessage => ({
    role: 'model',
    text,
    usage: { promptTokens: Math.floor(totalTokens * 0.9), completionTokens: totalTokens - Math.floor(totalTokens * 0.9), totalTokens },
});

const user = (text: string): ChatMessage => ({ role: 'user', text });

describe('getContextUsage (#967)', () => {
    it('retorna 0 quando não há mensagens com uso', () => {
        const { total, pct } = getContextUsage([], 128000);
        expect(total).toBe(0);
        expect(pct).toBe(0);
    });

    it('usa APENAS o último turno, ignorando mensagens sem uso (usuário)', () => {
        // Histórico longo, mas o uso real é só o do último turno (3k tokens).
        const messages: ChatMessage[] = [
            user('oi'),
            model('olá', 1000),
            user('e agora?'),
            model('resposta', 2000),
            user('mais uma'),
            model('resposta final', 3000),
        ];
        const { total, pct } = getContextUsage(messages, 128000);
        expect(total).toBe(3000);
        expect(pct).toBeCloseTo((3000 / 128000) * 100, 5);
    });

    it('NÃO soma totalTokens de todas as mensagens (regressão do bug do #967)', () => {
        // Antes do fix, somava 1000+2000+...+16000 = 136000 e disparava falso >90%.
        // Uso real (~16k num turno) num contexto de 128k = ~12,5%.
        const messages: ChatMessage[] = [];
        for (let i = 1; i <= 16; i++) messages.push(model(`t${i}`, i * 1000));
        const { total, pct } = getContextUsage(messages, 128000);
        expect(total).toBe(16000); // último turno, não a soma (136000)
        expect(pct).toBeLessThan(90);
        expect(pct).toBeCloseTo((16000 / 128000) * 100, 5);
    });

    it('reporta >90% apenas quando o ÚLTIMO turno de fato ultrapassa a janela', () => {
        const messages: ChatMessage[] = [
            model('t1', 5000),
            model('t2', 120000), // 120k/128k ~ 93,75%
        ];
        const { total, pct } = getContextUsage(messages, 128000);
        expect(total).toBe(120000);
        expect(pct).toBeGreaterThan(90);
    });

    it('considera o último turno com uso válido mesmo seguido de mensagens sem uso', () => {
        const messages: ChatMessage[] = [
            model('com uso', 9000),
            user('pergunta'), // sem usage
        ];
        const { total } = getContextUsage(messages, 128000);
        expect(total).toBe(9000);
    });

    it('retorna pct 0 quando a janela de contexto é 0 ou inválida', () => {
        const { total, pct } = getContextUsage([model('x', 5000)], 0);
        expect(total).toBe(5000);
        expect(pct).toBe(0);
    });

    it('ignora usage com totalTokens zerado e busca o anterior', () => {
        const messages: ChatMessage[] = [
            model('valido', 7000),
            model('vazio', 0),
        ];
        const { total } = getContextUsage(messages, 128000);
        expect(total).toBe(7000);
    });
});
