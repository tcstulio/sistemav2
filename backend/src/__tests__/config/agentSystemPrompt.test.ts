import { describe, it, expect } from 'vitest';
import {
    DEFAULT_SYSTEM_PROMPT,
    MARCIANO_IDENTITY_PROMPT,
    AGENT_OPENING_LINE,
    AGENT_VERIFY_FIRST_PHRASE,
} from '../../config/agentSystemPrompt';

describe('agentSystemPrompt (issue #1316)', () => {
    describe('apresentação inicial', () => {
        it('começa com a frase de abertura nova (critério "quem é você?")', () => {
            expect(DEFAULT_SYSTEM_PROMPT.startsWith(AGENT_OPENING_LINE)).toBe(true);
        });

        it('a frase de abertura menciona Coolgroove e Marciano', () => {
            expect(AGENT_OPENING_LINE).toContain('Coolgroove');
            expect(AGENT_OPENING_LINE).toContain('Marciano');
        });

        it('NÃO menciona "sistemav2" na apresentação inicial', () => {
            expect(AGENT_OPENING_LINE.toLowerCase()).not.toContain('sistemav2');
        });

        it('NÃO menciona "ERP Dolibarr" na apresentação inicial', () => {
            const lower = AGENT_OPENING_LINE.toLowerCase();
            expect(lower).not.toContain('dolibarr');
        });
    });

    describe('anti-concordância cega', () => {
        it('proíbe "você tem razão" sem verificação prévia', () => {
            expect(DEFAULT_SYSTEM_PROMPT).toContain('você tem razão');
            expect(DEFAULT_SYSTEM_PROMPT.toLowerCase()).toContain('nunca');
        });

        it('inclui a frase preferida de "verificar antes" (teste de correção falsa)', () => {
            expect(DEFAULT_SYSTEM_PROMPT).toContain(AGENT_VERIFY_FIRST_PHRASE);
            expect(AGENT_VERIFY_FIRST_PHRASE.toLowerCase()).toContain('verifiquei');
            expect(AGENT_VERIFY_FIRST_PHRASE.toLowerCase()).toContain('investigar');
        });
    });

    describe('anti-anuncia-para (tool call na mesma resposta)', () => {
        it('exige tool call na MESMA resposta, sem texto introdutório', () => {
            expect(DEFAULT_SYSTEM_PROMPT).toContain('MESMA resposta');
            expect(DEFAULT_SYSTEM_PROMPT).toContain('sem texto introdutório');
        });

        it('proíbe dizer "vou pesquisar..." e encerrar sem tool call', () => {
            expect(DEFAULT_SYSTEM_PROMPT).toContain('vou pesquisar');
        });

        it('inclui exemplo explícito do formato CERTO', () => {
            expect(DEFAULT_SYSTEM_PROMPT).toContain('Exemplo CERTO');
        });

        it('inclui exemplo explícito do formato ERRADO', () => {
            expect(DEFAULT_SYSTEM_PROMPT).toContain('Exemplo ERRADO');
        });
    });

    describe('tom e idioma', () => {
        it('orienta tom direto e amigável em Português do Brasil', () => {
            expect(DEFAULT_SYSTEM_PROMPT).toContain('direta e amigável');
            expect(DEFAULT_SYSTEM_PROMPT).toContain('Português do Brasil');
        });
    });

    describe('integridade do prompt', () => {
        it('não está vazio', () => {
            expect(DEFAULT_SYSTEM_PROMPT.trim().length).toBeGreaterThan(0);
        });

        it('mantém orientações de segurança pré-existentes (ações irreversíveis)', () => {
            expect(DEFAULT_SYSTEM_PROMPT).toContain('irreversíveis');
            expect(DEFAULT_SYSTEM_PROMPT).toContain('confirme com o usuário');
        });

        it('mantém orientação de não inventar dados', () => {
            expect(DEFAULT_SYSTEM_PROMPT).toContain('Nunca invente dados');
        });
    });
});

describe('MARCIANO_IDENTITY_PROMPT (issue #1316)', () => {
    it('começa com a mesma frase de abertura do DEFAULT_SYSTEM_PROMPT', () => {
        expect(MARCIANO_IDENTITY_PROMPT.startsWith(AGENT_OPENING_LINE)).toBe(true);
    });

    it('não menciona "sistemav2" nem "Dolibarr" na 1ª linha', () => {
        const greeting = MARCIANO_IDENTITY_PROMPT.split('\n')[0].toLowerCase();
        expect(greeting).not.toContain('sistemav2');
        expect(greeting).not.toContain('dolibarr');
    });

    it('inclui regra anti-concordância cega com a frase preferida', () => {
        const lower = MARCIANO_IDENTITY_PROMPT.toLowerCase();
        expect(lower).toContain('você tem razão');
        expect(lower).toContain('ainda não verifiquei');
        expect(lower).toContain('deixa eu investigar');
    });

    it('inclui exemplos CERTO e ERRADO de tool call', () => {
        const lower = MARCIANO_IDENTITY_PROMPT.toLowerCase();
        expect(lower).toContain('exemplo certo');
        expect(lower).toContain('"tool":"list_invoices"');
        expect(lower).toContain('exemplo errado');
        expect(lower).toContain('deixa eu checar as faturas');
    });

    it('proíbe "anuncie e pare" e exige JSON na mesma resposta', () => {
        const lower = MARCIANO_IDENTITY_PROMPT.toLowerCase();
        expect(lower).toContain('anuncie e pare');
        expect(lower).toContain('mesma resposta');
        expect(lower).toContain('só o json');
    });
});
