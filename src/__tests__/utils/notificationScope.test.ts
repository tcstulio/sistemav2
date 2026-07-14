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
    it('respeita n.scope="personal" mesmo quando recipient === userId', () => {
        expect(classifyScope(note({ scope: 'personal', recipient: '42' }), '42')).toBe('personal');
    });

    it('respeita n.scope="system" mesmo quando recipient === userId', () => {
        // backend marcou como system; o fallback não pode sobrescrever.
        expect(classifyScope(note({ scope: 'system', recipient: '42' }), '42')).toBe('system');
    });

    it('respeita n.scope="system" mesmo sem recipient', () => {
        expect(classifyScope(note({ scope: 'system' }), '42')).toBe('system');
    });

    it('respeita n.scope="personal" mesmo sem recipient (caso o backend pré-classificou)', () => {
        expect(classifyScope(note({ scope: 'personal' }), undefined)).toBe('personal');
    });
});

describe('classifyScope — fallback por recipient', () => {
    it('sem recipient => system', () => {
        expect(classifyScope(note({}), '42')).toBe('system');
    });

    it('recipient === userId (string idêntica) => personal', () => {
        // AppNotification.recipient é string e userId também é string (DolibarrUser.id).
        // Comparação direta preserva o comportamento original.
        expect(classifyScope(note({ recipient: '42' }), '42')).toBe('personal');
    });

    it('recipient = "0" casa com userId="0" (preserva comportamento do original)', () => {
        expect(classifyScope(note({ recipient: '0' }), '0')).toBe('personal');
    });

    it('recipient !== userId (string diferente) => system (cai nos defaults)', () => {
        expect(classifyScope(note({ recipient: '99' }), '42')).toBe('system');
    });

    it('userId=undefined NUNCA casa com recipient (mesmo se strings iguais)', () => {
        // Sem usuário logado, nenhum recipient pessoal pode ser classificado.
        expect(classifyScope(note({ recipient: '42' }), undefined)).toBe('system');
    });

    it('recipient === "team" => system (independe de userId)', () => {
        expect(classifyScope(note({ recipient: 'team' }), '42')).toBe('system');
        expect(classifyScope(note({ recipient: 'team' }), undefined)).toBe('system');
    });

    it('recipient === "all" => system (independe de userId)', () => {
        expect(classifyScope(note({ recipient: 'all' }), '42')).toBe('system');
        expect(classifyScope(note({ recipient: 'all' }), undefined)).toBe('system');
    });
});

describe('classifyScope — fallback por event metadata', () => {
    it('event="agent.action" sem recipient => system via metadata', () => {
        expect(classifyScope(note({ event: 'agent.action' }), '42')).toBe('system');
    });

    it('event="agent.action" com recipient casando => personal (precedência recipient > event)', () => {
        // NOTA: a precedência real é scope > recipient > event metadata.
        // Quando recipient === userId, o retorno é 'personal' antes de chegar
        // no fallback por event — comportamento idêntico ao original.
        expect(classifyScope(note({ event: 'agent.action', recipient: '42' }), '42')).toBe('personal');
    });

    it('event="stock.low" sem recipient => system via metadata', () => {
        expect(classifyScope(note({ event: 'stock.low' }), '42')).toBe('system');
    });

    it('event="custom" sem recipient => system via metadata', () => {
        expect(classifyScope(note({ event: 'custom' }), '42')).toBe('system');
    });

    it('event desconhecido e recipient ausente => default system', () => {
        expect(classifyScope(note({ event: 'something.else' }), '42')).toBe('system');
    });
});

describe('classifyScope — pureza e ausência de dependências externas', () => {
    it('função não joga mesmo com input mínimo (sem recipient, sem event, sem scope)', () => {
        expect(() => classifyScope(note({}), '1')).not.toThrow();
    });

    it('não depende de hooks/contexto/dom: invocável fora de React', () => {
        // chamada direta sem qualquer Provider.
        const result = classifyScope(note({ recipient: '7' }), '7');
        expect(result).toBe('personal');
    });

    it('é determinística — mesma entrada produz mesma saída', () => {
        const n = note({ recipient: '5', event: 'agent.action' });
        const a = classifyScope(n, '5');
        const b = classifyScope(n, '5');
        expect(a).toBe(b);
    });
});

describe('classifyScope — regressão do comportamento original (portada de MyNotificationsView.tsx)', () => {
    // Estes casos espelham fielmente a versão portada de MyNotificationsView.tsx
    // linhas 25-33 (mesma precedência: scope → recipient === userId → 'team'/'all' → event → default).
    it('caso 1: backend já classificou => respeita', () => {
        expect(classifyScope(note({ scope: 'personal' }), '99')).toBe('personal');
        expect(classifyScope(note({ scope: 'system' }), '99')).toBe('system');
    });

    it('caso 2: sem recipient (broadcast) => system', () => {
        expect(classifyScope(note({}), '1')).toBe('system');
    });

    it('caso 3: recipient === userId => personal', () => {
        expect(classifyScope(note({ recipient: '1' }), '1')).toBe('personal');
    });

    it('caso 4: recipient "team"/"all" => system', () => {
        expect(classifyScope(note({ recipient: 'team' }), '1')).toBe('system');
        expect(classifyScope(note({ recipient: 'all' }), '1')).toBe('system');
    });

    it('caso 5: events de metadado sem recipient => system', () => {
        expect(classifyScope(note({ event: 'agent.action' }), '1')).toBe('system');
        expect(classifyScope(note({ event: 'stock.low' }), '1')).toBe('system');
        expect(classifyScope(note({ event: 'custom' }), '1')).toBe('system');
    });

    it('caso 6: default (nada casa) => system', () => {
        expect(classifyScope(note({ recipient: '999' }), '1')).toBe('system');
    });
});

describe('classifyScope — equivalência byte-a-byte com a implementação original', () => {
    // Cópia literal da função ORIGINAL portada de MyNotificationsView.tsx
    // (linhas 25-33, commit b1f0ca4 — pré-extração). Mantida aqui APENAS para
    // provar que a refatoração não alterou o comportamento runtime em nenhum
    // caminho. Se algum teste deste bloco falhar, houve regressão silenciosa
    // na extração e o PR deve ser bloqueado.
    function originalClassifyScope(n: AppNotification, userId: string | undefined): 'personal' | 'system' {
        if (n.scope) return n.scope;
        if (!n.recipient) return 'system';
        if (n.recipient === userId) return 'personal';
        if (n.recipient === 'team' || n.recipient === 'all') return 'system';
        if (n.event === 'agent.action' || n.event === 'stock.low' || n.event === 'custom') return 'system';
        return 'system';
    }

    // Tabela de cenários que exercita TODOS os ramos da função, incluindo:
    // - scope definido pelo backend (com e sem recipient coincidente)
    // - recipient ausente, team, all, casando, não casando
    // - eventos de metadado (com e sem recipient casando)
    // - edge case recipient='0' (string falsy)
    // - userId undefined
    const scenarios: Array<{
        label: string;
        n: AppNotification;
        userId: string | undefined;
    }> = [
        { label: 'backend scope=personal', n: note({ scope: 'personal' }), userId: '42' },
        { label: 'backend scope=system', n: note({ scope: 'system' }), userId: '42' },
        { label: 'backend scope=personal sem recipient', n: note({ scope: 'personal' }), userId: undefined },
        { label: 'backend scope=system sem recipient', n: note({ scope: 'system' }), userId: undefined },
        { label: 'backend scope=personal + recipient casando', n: note({ scope: 'personal', recipient: '42' }), userId: '42' },
        { label: 'backend scope=system + recipient casando', n: note({ scope: 'system', recipient: '42' }), userId: '42' },
        { label: 'sem recipient, sem scope', n: note({}), userId: '42' },
        { label: 'sem recipient, sem scope, userId undefined', n: note({}), userId: undefined },
        { label: 'recipient === userId', n: note({ recipient: '42' }), userId: '42' },
        { label: 'recipient === "0" === userId "0"', n: note({ recipient: '0' }), userId: '0' },
        { label: 'recipient !== userId', n: note({ recipient: '99' }), userId: '42' },
        { label: 'recipient == userId mas userId undefined', n: note({ recipient: '42' }), userId: undefined },
        { label: 'recipient=team, userId presente', n: note({ recipient: 'team' }), userId: '42' },
        { label: 'recipient=team, userId undefined', n: note({ recipient: 'team' }), userId: undefined },
        { label: 'recipient=all, userId presente', n: note({ recipient: 'all' }), userId: '42' },
        { label: 'recipient=all, userId undefined', n: note({ recipient: 'all' }), userId: undefined },
        { label: 'event=agent.action sem recipient', n: note({ event: 'agent.action' }), userId: '42' },
        { label: 'event=agent.action + recipient casando', n: note({ event: 'agent.action', recipient: '42' }), userId: '42' },
        { label: 'event=agent.action + recipient não casando', n: note({ event: 'agent.action', recipient: '99' }), userId: '42' },
        { label: 'event=stock.low sem recipient', n: note({ event: 'stock.low' }), userId: '42' },
        { label: 'event=custom sem recipient', n: note({ event: 'custom' }), userId: '42' },
        { label: 'event desconhecido sem recipient', n: note({ event: 'something.else' }), userId: '42' },
        { label: 'event desconhecido + recipient não casando', n: note({ event: 'something.else', recipient: '99' }), userId: '42' },
        { label: 'tudo vazio (notificação mínima)', n: note({}), userId: '1' },
    ];

    it.each(scenarios)('$label: nova função === implementação original', ({ n, userId }) => {
        const original = originalClassifyScope(n, userId);
        const refactored = classifyScope(n, userId);
        expect(refactored).toBe(original);
    });

    it('assinatura preservada: (AppNotification, string | undefined) => NotificationScope', () => {
        // Esta asserção é estática (compile-time) e roda em runtime apenas
        // para garantir que a função ainda é chamável com a assinatura original.
        type OriginalSig = (n: AppNotification, userId: string | undefined) => 'personal' | 'system';
        const refactoredAsOriginal: OriginalSig = classifyScope;
        const result: 'personal' | 'system' = refactoredAsOriginal(note({ recipient: '7' }), '7');
        expect(result).toBe('personal');
    });
});
