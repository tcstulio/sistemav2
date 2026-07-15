/**
 * #1353 — Diferencia "vazio legítimo" de "falha de API" nas tools de listagem.
 *
 * Cada tool que envolve um `list_*` / `search_*` deve devolver duas mensagens
 * distintas para o LLM:
 *
 *   1. service retornou `[]` (404 ou 200 com array vazio) → "Nenhuma X encontrada."
 *      Logado como `→ empty (legit)`.
 *
 *   2. service LANÇOU (5xx/401/403/timeout/network) → "ERRO_API: Não consegui consultar..."
 *      Logado como `→ error (api failure)`.
 *
 * Este teste cobre as 3 variantes (500, 200 [], 200 [items]) para pelo menos
 * 3 tools (list_invoices, list_proposals, search_customer) e verifica que o
 * log do backend registra a diferença entre os cenários.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../config/env', () => ({ config: {} }));
vi.mock('../../services/scraperService', () => ({ ScraperService: {} }));
vi.mock('../../utils/urlValidation', () => ({ isValidExternalUrl: () => true }));

const { mockPinoInstance, pinoMock, mockDolibarrService } = vi.hoisted(() => {
    const instance = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        fatal: vi.fn(),
    };
    const pinoFn = vi.fn(() => instance);
    const dolibarr = {
        listInvoices: vi.fn(),
        listProposals: vi.fn(),
        searchThirdParty: vi.fn(),
        listSupplierInvoices: vi.fn(),
        listEvents: vi.fn(),
        listUsers: vi.fn(),
        listWarehouses: vi.fn(),
        listCandidates: vi.fn(),
    };
    return { mockPinoInstance: instance, pinoMock: pinoFn, mockDolibarrService: dolibarr };
});

vi.mock('pino', () => ({
    default: (...args: any[]) => pinoMock(...args),
}));

vi.mock('../../services/dolibarrService', () => ({ dolibarrService: mockDolibarrService }));

import { executeTool, ERRO_API_MARKER, TOOLS_PROMPT } from '../../services/agentTools';

const resetLoggerMocks = () => {
    mockPinoInstance.info.mockClear();
    mockPinoInstance.warn.mockClear();
    mockPinoInstance.error.mockClear();
};

const resetDolibarrMocks = () => {
    mockDolibarrService.listInvoices.mockReset();
    mockDolibarrService.listProposals.mockReset();
    mockDolibarrService.searchThirdParty.mockReset();
    mockDolibarrService.listSupplierInvoices.mockReset();
    mockDolibarrService.listEvents.mockReset();
    mockDolibarrService.listUsers.mockReset();
    mockDolibarrService.listWarehouses.mockReset();
    mockDolibarrService.listCandidates.mockReset();
    // Outros métodos chamados pelo `search` — se não forem resetados, mocks de testes
    // anteriores vazariam para o teste de "search todas falhando".
    const dolibarrAny = mockDolibarrService as any;
    if (dolibarrAny.listProjects) dolibarrAny.listProjects.mockReset();
    if (dolibarrAny.listTasks) dolibarrAny.listTasks.mockReset();
    if (dolibarrAny.listOrders) dolibarrAny.listOrders.mockReset();
};

/**
 * Extrai a mensagem legível de uma chamada de log, suportando DOIS formatos:
 *   1. setup.ts global mock — `info: vi.fn()` recebe a string crua → `c[0]` é string.
 *   2. pino real (via Logger class) — `info({ msg, context, data })` → `c[0]` é objeto.
 * Assim o teste não quebra dependendo de qual mock está ativo.
 */
const logMsg = (call: unknown[]): string => {
    const arg = call[0];
    if (typeof arg === 'string') return arg;
    if (arg && typeof arg === 'object' && 'msg' in (arg as Record<string, unknown>)) {
        return String((arg as { msg?: unknown }).msg ?? '');
    }
    return '';
};

beforeEach(() => {
    resetLoggerMocks();
    resetDolibarrMocks();
});

// --- list_invoices ----------------------------------------------------------------

describe('agentTools — list_invoices (#1353)', () => {
    it('500 (erro de API) → resposta contém ERRO_API + mensagem amigável, NÃO "nenhuma fatura"', async () => {
        mockDolibarrService.listInvoices.mockRejectedValueOnce(
            Object.assign(new Error('Request failed with status code 500'), { response: { status: 500 } })
        );

        const out = await executeTool('list_invoices', { status: 'unpaid', limit: 10 });

        expect(out).toContain(ERRO_API_MARKER);
        expect(out).not.toContain('Nenhuma fatura encontrada');
        expect(out).toMatch(/faturas/i);
        expect(out).toMatch(/Tente novamente em alguns instantes/);
    });

    it('200 [] → "Nenhuma fatura encontrada."', async () => {
        mockDolibarrService.listInvoices.mockResolvedValueOnce([]);

        const out = await executeTool('list_invoices', { status: 'unpaid', limit: 10 });

        expect(out).toBe('Nenhuma fatura encontrada.');
        expect(out).not.toContain(ERRO_API_MARKER);
    });

    it('200 [fat1, fat2] → lista as faturas com ref e total', async () => {
        mockDolibarrService.listInvoices.mockResolvedValueOnce([
            { id: '1', ref: 'FA2501-0001', statut: 1, total_ttc: '1500.50' },
            { id: '2', ref: 'FA2501-0002', statut: 0, total_ttc: '899.00' },
        ]);

        const out = await executeTool('list_invoices', { status: 'all', limit: 10 });

        expect(out).not.toContain(ERRO_API_MARKER);
        expect(out).toContain('FA2501-0001');
        expect(out).toContain('R$ 1500.50');
        expect(out).toContain('FA2501-0002');
        expect(out).toContain('R$ 899.00');
    });
});

// --- list_proposals ---------------------------------------------------------------

describe('agentTools — list_proposals (#1353)', () => {
    it('500 (erro de API) → resposta contém ERRO_API', async () => {
        mockDolibarrService.listProposals.mockRejectedValueOnce(
            Object.assign(new Error('Request failed with status code 502'), { response: { status: 502 } })
        );

        const out = await executeTool('list_proposals', { status: 'open' });

        expect(out).toContain(ERRO_API_MARKER);
        expect(out).not.toContain('Nenhuma proposta encontrada');
    });

    it('200 [] → "Nenhuma proposta encontrada."', async () => {
        mockDolibarrService.listProposals.mockResolvedValueOnce([]);

        const out = await executeTool('list_proposals', { status: 'open' });

        expect(out).toBe('Nenhuma proposta encontrada.');
        expect(out).not.toContain(ERRO_API_MARKER);
    });

    it('200 [p1] → lista as propostas', async () => {
        mockDolibarrService.listProposals.mockResolvedValueOnce([
            { id: '99', ref: 'PR2501-0099', total_ttc: '4250.00' },
        ]);

        const out = await executeTool('list_proposals', { status: 'open' });

        expect(out).not.toContain(ERRO_API_MARKER);
        expect(out).toContain('PR2501-0099');
        expect(out).toContain('R$ 4250.00');
    });
});

// --- search_customer --------------------------------------------------------------

describe('agentTools — search_customer (#1353)', () => {
    it('500 (erro de API) → resposta contém ERRO_API', async () => {
        mockDolibarrService.searchThirdParty.mockRejectedValueOnce(
            Object.assign(new Error('Request failed with status code 401'), { response: { status: 401 } })
        );

        const out = await executeTool('search_customer', { query: 'acme' });

        expect(out).toContain(ERRO_API_MARKER);
        expect(out).not.toContain('Nenhum cliente encontrado');
    });

    it('200 [] → "Nenhum cliente encontrado para ..."', async () => {
        mockDolibarrService.searchThirdParty.mockResolvedValueOnce([]);

        const out = await executeTool('search_customer', { query: 'inexistente' });

        expect(out).toBe('Nenhum cliente encontrado para "inexistente".');
        expect(out).not.toContain(ERRO_API_MARKER);
    });

    it('200 [c1, c2] → lista os clientes encontrados', async () => {
        mockDolibarrService.searchThirdParty.mockResolvedValueOnce([
            { id: '7', name: 'Acme Corp', email: 'a@acme.com' },
            { id: '8', name: 'Acme Filial', email: '' },
        ]);

        const out = await executeTool('search_customer', { query: 'acme' });

        expect(out).not.toContain(ERRO_API_MARKER);
        expect(out).toContain('Acme Corp');
        expect(out).toContain('a@acme.com');
        expect(out).toContain('Acme Filial');
        expect(out).toContain('sem email');
    });

    it('exige query não-vazia (regras já existentes permanecem)', async () => {
        const out = await executeTool('search_customer', { query: '' });
        expect(out).toMatch(/query não pode ser vazio/i);
    });
});

// --- Diferenciação no log ---------------------------------------------------------

describe('agentTools — log diferencia empty (legit) vs error 500 (api failure) (#1353)', () => {
    it('listInvoices → empty (legit) é logado em info', async () => {
        mockDolibarrService.listInvoices.mockResolvedValueOnce([]);

        await executeTool('list_invoices', { status: 'unpaid' });

        const infos = mockPinoInstance.info.mock.calls.map(logMsg);
        expect(infos.some((m) => /fatura/.test(m) && /empty \(legit\)/.test(m))).toBe(true);
        // E NÃO chama warn
        expect(mockPinoInstance.warn).not.toHaveBeenCalled();
    });

    it('listInvoices → error 500 (api failure) é logado em warn com marker', async () => {
        mockDolibarrService.listInvoices.mockRejectedValueOnce(
            Object.assign(new Error('Boom 500'), { response: { status: 500 } })
        );

        await executeTool('list_invoices', { status: 'unpaid' });

        const warns = mockPinoInstance.warn.mock.calls.map((c) => ({
            msg: logMsg(c),
            meta: c[0],
        }));
        const apiFailLog = warns.find((w) => /fatura/.test(w.msg) && /error \(api failure\)/.test(w.msg));
        expect(apiFailLog).toBeTruthy();
        // E NÃO loga como "empty (legit)"
        const infos = mockPinoInstance.info.mock.calls.map(logMsg);
        expect(infos.some((m) => /empty \(legit\)/.test(m) && /fatura/.test(m))).toBe(false);
    });

    it('listProposals e searchCustomer também diferenciam os dois cenários no log', async () => {
        // empty (legit) para proposals
        mockDolibarrService.listProposals.mockResolvedValueOnce([]);
        await executeTool('list_proposals', {});
        const infosProposals = mockPinoInstance.info.mock.calls.map(logMsg);
        expect(infosProposals.some((m) => /proposta/.test(m) && /empty \(legit\)/.test(m))).toBe(true);

        resetLoggerMocks();

        // error (api failure) para searchCustomer
        mockDolibarrService.searchThirdParty.mockRejectedValueOnce(
            Object.assign(new Error('Boom 503'), { response: { status: 503 } })
        );
        await executeTool('search_customer', { query: 'x' });
        const warnsCust = mockPinoInstance.warn.mock.calls.map(logMsg);
        expect(warnsCust.some((m) => /cliente/.test(m) && /error \(api failure\)/.test(m))).toBe(true);
    });
});

// --- Prompt do agente é instruído a tratar ERRO_API ------------------------------

describe('agentTools — TOOLS_PROMPT explica ERRO_API (#1353)', () => {
    it('documenta o marker ERRO_API e instrui o LLM a não afirmar "não existe" quando presente', () => {
        expect(TOOLS_PROMPT).toContain('ERRO_API');
        // A regra deve estar explícita sobre o comportamento esperado do LLM.
        expect(TOOLS_PROMPT).toMatch(/NUNCA afirme.*não existe|ERRO_API.*NUNCA afirme/i);
    });
});

// --- list_supplier_invoices / list_events / list_users / list_warehouses / list_candidates ---

// Helper genérico: 3 variantes para uma tool de listagem. Usa o mockDolibarrService especificado.
// Mantém os asserts idênticos aos 3 tools já cobertos (list_invoices, list_proposals, search_customer)
// para garantir consistência.
function describeListTool({
    describeLabel,
    toolName,
    entityRe,
    emptyMessage,
    dolibarrMethod,
    mockReturnValue,
    expectedContent,
}: {
    describeLabel: string;
    toolName: string;
    entityRe: RegExp;
    emptyMessage: string;
    dolibarrMethod: keyof typeof mockDolibarrService;
    mockReturnValue: any[];
    expectedContent: string[];
}) {
    describe(describeLabel, () => {
        it('500 → resposta contém ERRO_API + NÃO contém empty message', async () => {
            (mockDolibarrService[dolibarrMethod] as any).mockRejectedValueOnce(
                Object.assign(new Error(`Request failed with status code 500`), { response: { status: 500 } })
            );

            const out = await executeTool(toolName, {});

            expect(out).toContain(ERRO_API_MARKER);
            expect(out).not.toContain(emptyMessage);
            expect(entityRe.test(out)).toBe(true);
            expect(out).toMatch(/Tente novamente em alguns instantes/);
        });

        it('200 [] → empty message', async () => {
            (mockDolibarrService[dolibarrMethod] as any).mockResolvedValueOnce([]);

            const out = await executeTool(toolName, {});

            expect(out).toBe(emptyMessage);
            expect(out).not.toContain(ERRO_API_MARKER);
        });

        it(`200 [items] → lista os itens`, async () => {
            (mockDolibarrService[dolibarrMethod] as any).mockResolvedValueOnce(mockReturnValue);

            const out = await executeTool(toolName, {});

            expect(out).not.toContain(ERRO_API_MARKER);
            for (const expected of expectedContent) {
                expect(out).toContain(expected);
            }
        });
    });
}

describeListTool({
    describeLabel: 'agentTools — list_supplier_invoices (#1353)',
    toolName: 'list_supplier_invoices',
    entityRe: /faturas/i,
    emptyMessage: 'Nenhuma fatura de fornecedor encontrada.',
    dolibarrMethod: 'listSupplierInvoices',
    mockReturnValue: [{ id: '51', ref: 'FF2501-0051', total_ttc: '320.00' }],
    expectedContent: ['FF2501-0051', 'R$ 320.00'],
});

describeListTool({
    describeLabel: 'agentTools — list_events (#1353)',
    toolName: 'list_events',
    entityRe: /eventos/i,
    emptyMessage: 'Nenhum evento encontrado.',
    dolibarrMethod: 'listEvents',
    mockReturnValue: [{ id: '201', label: 'Reunião semanal', datep: '2026-01-15 10:00:00' }],
    expectedContent: ['Reunião semanal', '2026-01-15 10:00:00'],
});

describeListTool({
    describeLabel: 'agentTools — list_users (#1353)',
    toolName: 'list_users',
    entityRe: /usuários/i,
    emptyMessage: 'Nenhum usuário encontrado.',
    dolibarrMethod: 'listUsers',
    mockReturnValue: [{ id: '5', firstname: 'Maria', lastname: 'Silva', email: 'maria@acme.com' }],
    expectedContent: ['Silva', 'Maria', 'maria@acme.com'],
});

describeListTool({
    describeLabel: 'agentTools — list_warehouses (#1353)',
    toolName: 'list_warehouses',
    entityRe: /armazéns/i,
    emptyMessage: 'Nenhum armazém encontrado.',
    dolibarrMethod: 'listWarehouses',
    mockReturnValue: [{ id: '11', label: 'Almoxarifado Central', description: 'SP' }],
    expectedContent: ['Almoxarifado Central', 'SP'],
});

describeListTool({
    describeLabel: 'agentTools — list_candidates (#1353)',
    toolName: 'list_candidates',
    entityRe: /candidatos/i,
    emptyMessage: 'Nenhum candidato encontrado.',
    dolibarrMethod: 'listCandidates',
    mockReturnValue: [{ id: '301', firstname: 'João', lastname: 'Pereira', email: 'joao@example.com' }],
    expectedContent: ['Pereira', 'João', 'joao@example.com'],
});

// --- search (todas as fontes falhando → ERRO_API no agregado) ---------------------

describe('agentTools — search (todas as fontes falhando → ERRO_API agregado) (#1353)', () => {
    it('quando TODAS as fontes falham, devolve ERRO_API em vez de "Nenhum resultado"', async () => {
        mockDolibarrService.searchThirdParty.mockRejectedValueOnce(
            Object.assign(new Error('Boom'), { response: { status: 503 } })
        );
        // Para os outros métodos (listProjects, listTasks, listInvoices, listOrders, listProposals),
        // precisamos do mock — mas o test só mockou 3+5. Se o agentTools.ts chamar algo não mockado,
        // o mock do dolibarrService devolve undefined, e a chamada `undefined().catch` lança.
        // Solução: mockamos TODOS os métodos do dolibarrService no escopo do test.
        const dolibarrServiceAny = mockDolibarrService as any;
        dolibarrServiceAny.listProjects = dolibarrServiceAny.listProjects || vi.fn();
        dolibarrServiceAny.listTasks = dolibarrServiceAny.listTasks || vi.fn();
        dolibarrServiceAny.listInvoices = dolibarrServiceAny.listInvoices || vi.fn();
        dolibarrServiceAny.listOrders = dolibarrServiceAny.listOrders || vi.fn();
        dolibarrServiceAny.listProposals = dolibarrServiceAny.listProposals || vi.fn();

        dolibarrServiceAny.listProjects.mockRejectedValueOnce(
            Object.assign(new Error('Boom'), { response: { status: 500 } })
        );
        dolibarrServiceAny.listTasks.mockRejectedValueOnce(
            Object.assign(new Error('Boom'), { response: { status: 500 } })
        );
        dolibarrServiceAny.listInvoices.mockRejectedValueOnce(
            Object.assign(new Error('Boom'), { response: { status: 500 } })
        );
        dolibarrServiceAny.listOrders.mockRejectedValueOnce(
            Object.assign(new Error('Boom'), { response: { status: 500 } })
        );
        dolibarrServiceAny.listProposals.mockRejectedValueOnce(
            Object.assign(new Error('Boom'), { response: { status: 500 } })
        );

        const out = await executeTool('search', { query: 'qualquer' });

        expect(out).toContain(ERRO_API_MARKER);
        expect(out).not.toContain('Nenhum resultado encontrado');
        expect(out).toMatch(/Tente novamente em alguns instantes/);
    });
});