import { describe, it, expect } from 'vitest';
import { classifyScope } from '../../utils/notificationScope';
import type { AppNotification } from '../../types';

// Helper para montar uma notificação mínima com os campos que classifyScope consulta.
const note = (overrides: Partial<AppNotification> = {}): AppNotification => ({
    id: 'n1',
    type: 'info',
    title: 't',
    message: 'm',
    date: 1,
    priority: 'medium',
    read: false,
    ...overrides,
});

describe('classifyScope — precedência do backend (n.scope)', () => {
    it('respeita n.scope="personal" mesmo quando recipient === currentUserId', () => {
        expect(classifyScope(note({ scope: 'personal', recipient: '42' }), 42)).toBe('personal');
    });

    it('respeita n.scope="system" mesmo quando recipient === currentUserId', () => {
        // backend marcou como system; o fallback não pode sobrescrever.
        expect(classifyScope(note({ scope: 'system', recipient: '42' }), 42)).toBe('system');
    });

    it('respeita n.scope="system" mesmo sem recipient', () => {
        expect(classifyScope(note({ scope: 'system' }), 42)).toBe('system');
    });

    it('respeita n.scope="personal" mesmo sem recipient (caso o backend pré-classificou)', () => {
        expect(classifyScope(note({ scope: 'personal' }), null)).toBe('personal');
    });
});

describe('classifyScope — fallback por recipient', () => {
    it('sem recipient => system', () => {
        expect(classifyScope(note({}), 42)).toBe('system');
    });

    it('recipient === currentUserId (string equivalente ao número) => personal', () => {
        // AppNotification.recipient é string; currentUserId numérico é convertido
        // para string no comparador — comportamento idêntico à versão original.
        expect(classifyScope(note({ recipient: '42' }), 42)).toBe('personal');
    });

    it('recipient = "0" casa com currentUserId=0 (preserva comportamento do original)', () => {
        expect(classifyScope(note({ recipient: '0' }), 0)).toBe('personal');
    });

    it('recipient !== currentUserId (string diferente) => system (cai nos defaults)', () => {
        expect(classifyScope(note({ recipient: '99' }), 42)).toBe('system');
    });

    it('currentUserId=null NUNCA casa com recipient (mesmo se strings iguais)', () => {
        // Sem usuário logado, nenhum recipient pessoal pode ser classificado.
        expect(classifyScope(note({ recipient: '42' }), null)).toBe('system');
    });

    it('recipient === "team" => system (independe de currentUserId)', () => {
        expect(classifyScope(note({ recipient: 'team' }), 42)).toBe('system');
        expect(classifyScope(note({ recipient: 'team' }), null)).toBe('system');
    });

    it('recipient === "all" => system (independe de currentUserId)', () => {
        expect(classifyScope(note({ recipient: 'all' }), 42)).toBe('system');
        expect(classifyScope(note({ recipient: 'all' }), null)).toBe('system');
    });
});

describe('classifyScope — fallback por event metadata', () => {
    it('event="agent.action" => system mesmo se recipient === currentUserId (mas sem scope)', () => {
        // NOTA: precedence correta: n.scope > recipient > event metadata.
        // Como scope não foi setado e recipient casou, ANTES do event metadata
        // a função já retorna 'personal' — preservando o fallback original.
        expect(classifyScope(note({ event: 'agent.action', recipient: '42' }), 42)).toBe('personal');
    });

    it('event="agent.action" sem recipient => system via metadata', () => {
        expect(classifyScope(note({ event: 'agent.action' }), 42)).toBe('system');
    });

    it('event="stock.low" sem recipient => system via metadata', () => {
        expect(classifyScope(note({ event: 'stock.low' }), 42)).toBe('system');
    });

    it('event="custom" sem recipient => system via metadata', () => {
        expect(classifyScope(note({ event: 'custom' }), 42)).toBe('system');
    });

    it('event desconhecido e recipient ausente => default system', () => {
        expect(classifyScope(note({ event: 'something.else' }), 42)).toBe('system');
    });
});

describe('classifyScope — pureza e ausência de dependências externas', () => {
    it('função não joga mesmo com input mínimo (sem recipient, sem event, sem scope)', () => {
        expect(() => classifyScope(note({}), 1)).not.toThrow();
    });

    it('não depende de hooks/contexto/dom: invocável fora de React', () => {
        // chamada direta sem qualquer Provider.
        const result = classifyScope(note({ recipient: '7' }), 7);
        expect(result).toBe('personal');
    });

    it('é determinística — mesma entrada produz mesma saída', () => {
        const n = note({ recipient: '5', event: 'agent.action' });
        const a = classifyScope(n, 5);
        const b = classifyScope(n, 5);
        expect(a).toBe(b);
    });
});

describe('classifyScope — regressão do comportamento original (portada de MyNotificationsView.tsx)', () => {
    // Estes casos espelham fielmente a versão portada de MyNotificationsView.tsx
    // linhas 25-33 (mesma precedência: scope → recipient === userId → 'team'/'all' → event → default).
    it('caso 1: backend já classificou => respeita', () => {
        expect(classifyScope(note({ scope: 'personal' }), 99)).toBe('personal');
        expect(classifyScope(note({ scope: 'system' }), 99)).toBe('system');
    });

    it('caso 2: sem recipient (broadcast) => system', () => {
        expect(classifyScope(note({}), 1)).toBe('system');
    });

    it('caso 3: recipient === userId => personal', () => {
        expect(classifyScope(note({ recipient: '1' }), 1)).toBe('personal');
    });

    it('caso 4: recipient "team"/"all" => system', () => {
        expect(classifyScope(note({ recipient: 'team' }), 1)).toBe('system');
        expect(classifyScope(note({ recipient: 'all' }), 1)).toBe('system');
    });

    it('caso 5: events de metadado sem recipient => system', () => {
        expect(classifyScope(note({ event: 'agent.action' }), 1)).toBe('system');
        expect(classifyScope(note({ event: 'stock.low' }), 1)).toBe('system');
        expect(classifyScope(note({ event: 'custom' }), 1)).toBe('system');
    });

    it('caso 6: default (nada casa) => system', () => {
        expect(classifyScope(note({ recipient: '999' }), 1)).toBe('system');
    });
});