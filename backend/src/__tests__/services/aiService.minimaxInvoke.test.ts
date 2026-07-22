import { describe, it, expect } from 'vitest';
import {
    extractToolCall,
    extractToolCalls,
    parseInvokeToolCalls,
    looksLikeLeakedToolCall,
    sanitizeFinalReply,
} from '../../services/aiService';

// BUG REAL em produção: o MiniMax M3 emite tool-calls no formato XML estilo Anthropic/Claude
// (<invoke name="tool"><param>valor</param></invoke>), às vezes com o delimitador de token
// `]<]minimax[>[` entre cada peça. O parser antigo só via JSON/GLM → a call VAZAVA como TEXTO CRU
// no WhatsApp e as tools NÃO executavam. Este teste usa o vazamento REAL como oráculo.

// Oráculo: o texto EXATO que vazou pro dono no WhatsApp.
const LEAKED_REAL = `]<]minimax[>[<tool_call>
]<]minimax[>[<invoke name="list_supplier_invoices">]<]minimax[>[<status>paid]<]minimax[>[</status>]<]minimax[>[</invoke>
]<]minimax[>[<invoke name="list_expense_reports">]<]minimax[>[<status>approved]<]minimax[>[</status>]<]minimax[>[</invoke>
]<]minimax[>[<invoke name="list_users">]<]minimax[>[<search>]<]minimax[>[</search>]<]minimax[>[</invoke>
]<]minimax[>[<invoke name="list_warehouses">]<]minimax[>[</invoke>
]<]minimax[>[<invoke name="list_events">]<]minimax[>[<limit>10]<]minimax[>[</limit>]<]minimax[>[</invoke>
]<]minimax[>[</tool_call>`;

describe('parseInvokeToolCalls (MiniMax M3 <invoke> XML)', () => {
    it('extrai as 5 tool-calls do vazamento REAL (com delimitador ]<]minimax[>[)', () => {
        const calls = extractToolCalls(LEAKED_REAL);
        expect(calls).toEqual([
            { tool: 'list_supplier_invoices', args: { status: 'paid' } },
            { tool: 'list_expense_reports', args: { status: 'approved' } },
            { tool: 'list_users', args: { search: '' } },
            { tool: 'list_warehouses', args: {} },
            { tool: 'list_events', args: { limit: 10 } },
        ]);
    });

    it('parseInvokeToolCalls direto devolve as mesmas 5 calls', () => {
        expect(parseInvokeToolCalls(LEAKED_REAL)).toHaveLength(5);
    });

    it('variante Claude-XML <parameter name="X">VALOR</parameter> também parseia', () => {
        const txt = '<invoke name="list_supplier_invoices"><parameter name="status">paid</parameter></invoke>';
        expect(extractToolCalls(txt)).toEqual([
            { tool: 'list_supplier_invoices', args: { status: 'paid' } },
        ]);
        // extractToolCall (single) também
        expect(extractToolCall(txt)).toEqual({ tool: 'list_supplier_invoices', args: { status: 'paid' } });
    });

    it('conversão de tipo: número, boolean, string vazia', () => {
        const num = extractToolCalls('<invoke name="list_events"><limit>10</limit></invoke>');
        expect(num[0].args.limit).toBe(10);
        expect(typeof num[0].args.limit).toBe('number');

        const bool = extractToolCalls('<invoke name="list_users"><active>true</active></invoke>');
        expect(bool[0].args.active).toBe(true);
        expect(typeof bool[0].args.active).toBe('boolean');

        const boolF = extractToolCalls('<invoke name="list_users"><active>false</active></invoke>');
        expect(boolF[0].args.active).toBe(false);

        const empty = extractToolCalls('<invoke name="list_users"><search></search></invoke>');
        expect(empty[0].args.search).toBe('');
    });

    it('variante solta <|minimax|> também é limpa', () => {
        const txt = '<|minimax|><invoke name="list_warehouses"></invoke>';
        expect(extractToolCalls(txt)).toEqual([{ tool: 'list_warehouses', args: {} }]);
    });

    it('LEAKED_TOOLCALL_RE reconhece <invoke> e delimitador minimax como vazamento', () => {
        expect(looksLikeLeakedToolCall('<invoke name="list_users"><search></search></invoke>')).toBe(true);
        expect(looksLikeLeakedToolCall(LEAKED_REAL)).toBe(true);
        expect(looksLikeLeakedToolCall(']<]minimax[>[ texto solto')).toBe(true);
        // sanitizeFinalReply suprime o cru
        expect(sanitizeFinalReply('<invoke name="list_users"></invoke>')).toMatch(/problema ao processar/i);
    });
});

// NÃO-REGRESSÃO: formatos antigos (JSON nosso, GLM <tool_call:{...}>, bare {"name":...}) seguem OK.
describe('não-regressão dos formatos antigos', () => {
    it('JSON padrão {"tool":...,"args":...} (multi e single)', () => {
        const txt = '{"tool":"list_users","args":{"search":"marcus"}}';
        expect(extractToolCalls(txt)).toEqual([{ tool: 'list_users', args: { search: 'marcus' } }]);
        expect(extractToolCall(txt)).toEqual({ tool: 'list_users', args: { search: 'marcus' } });
    });

    it('GLM <tool_call: {"name":..., "arguments":...}>', () => {
        const txt = '<tool_call: {"name":"list_products","arguments":{"search":"cadeira"}}>';
        expect(extractToolCall(txt)).toEqual({ tool: 'list_products', args: { search: 'cadeira' } });
    });

    it('bare {"name":..., "arguments":...}', () => {
        const txt = '{"name":"list_invoices","arguments":{"status":"paid"}}';
        expect(extractToolCall(txt)).toEqual({ tool: 'list_invoices', args: { status: 'paid' } });
    });

    it('prosa legítima NÃO vira tool-call nem vazamento', () => {
        expect(extractToolCalls('Aqui estão suas tarefas: TK2510-0306.')).toEqual([]);
        expect(extractToolCall('Use a ferramenta de busca, por favor.')).toBeNull();
        expect(looksLikeLeakedToolCall('Aqui estão suas tarefas: TK2510-0306, TK2510-0307.')).toBe(false);
    });
});
