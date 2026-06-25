/**
 * Tests for SchedulerAdmin — covers:
 *   #603  testRule: modal captures real target, DRY-RUN badge, Conta label
 *   #604  CRUD: Edit button for templates and flows
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';

vi.mock('sonner', () => ({
    toast: {
        success: vi.fn(),
        error: vi.fn(),
        info: vi.fn(),
        warning: vi.fn(),
    },
}));

vi.mock('../../config', () => ({
    config: { API_BASE_URL: '' },
}));

vi.mock('../../services/whatsappService', () => ({
    WhatsAppService: {
        getAccounts: vi.fn(async () => []),
    },
}));

vi.mock('../../services/emailService', () => ({
    EmailService: {
        getAccounts: vi.fn(async () => []),
    },
}));

vi.mock('../../utils/logger', () => ({
    logger: {
        child: () => ({
            debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn(),
        }),
    },
}));

const mockFetch = vi.fn();
global.fetch = mockFetch as unknown as typeof fetch;

// Helper to build a standard fetch response
function okJson(data: unknown) {
    return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(data),
    } as Response);
}

const whatsappRule = {
    id: 'rule-wa-1',
    name: 'Fatura Criada WA',
    event: 'invoice_created',
    enabled: true,
    sessionId: 'session-default',
    channel: 'whatsapp',
    delay: 0,
};

const emailRule = {
    id: 'rule-em-1',
    name: 'Fatura Criada Email',
    event: 'invoice_created',
    enabled: true,
    sessionId: 'conta-email',
    channel: 'email',
    delay: 0,
};

const sampleTemplate = {
    id: 'tpl-1',
    name: 'Modelo Inicial',
    content: 'Olá {{nome}}!',
    category: 'general',
    channel: 'whatsapp',
};

const sampleFlow = {
    id: 'flow-1',
    name: 'Fluxo Inicial',
    triggerKeywords: ['oi', 'olá'],
    enabled: true,
    steps: [{ id: 'step_1', message: 'Como posso ajudar?', waitForResponse: true }],
};

const statsData = {
    pending: 0, sent: 0, failed: 0, templates: 1,
    automationRules: 2, activeRules: 2, chatFlows: 1,
    logsSentToday: 0, logsFailedToday: 0,
};

function defaultFetchHandler(url: string, _opts?: RequestInit) {
    const u = url as string;
    if (u.includes('/api/scheduler/stats')) return okJson(statsData);
    if (u.includes('/api/scheduler/pending')) return okJson({ count: 0, data: [] });
    if (u.includes('/api/scheduler/templates')) return okJson({ count: 1, data: [sampleTemplate] });
    if (u.includes('/api/webhook/rules') && !u.includes('/test') && !u.includes('/toggle')) return okJson({ count: 2, data: [whatsappRule, emailRule] });
    if (u.includes('/api/webhook/flows') && !u.includes('/toggle')) return okJson({ count: 1, data: [sampleFlow] });
    if (u.includes('/api/webhook/logs')) return okJson({ count: 0, data: [] });
    if (u.includes('/api/webhook/variables')) return okJson({});
    if (u.includes('/api/scheduler/broadcasts')) return okJson({ data: [] });
    return okJson({});
}

// Import after mocks
import { SchedulerAdmin } from '../../components/SchedulerAdmin';

describe('SchedulerAdmin — #534 layout', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockFetch.mockImplementation(defaultFetchHandler);
    });

    it('renderiza dentro do PageLayout (role=main) com título correto', async () => {
        render(<SchedulerAdmin />);
        const main = document.querySelector('[role="main"]');
        expect(main).toBeTruthy();
        expect(main?.getAttribute('aria-label')).toBe('Automação de Mensagens');
    });

    it('renderiza o título "Automação de Mensagens" no PageHeader', () => {
        render(<SchedulerAdmin />);
        expect(screen.getByText('📅 Automação de Mensagens')).toBeTruthy();
    });

    it('root não tem overflowY:auto nem height:100% inline', () => {
        render(<SchedulerAdmin />);
        const main = document.querySelector('[role="main"]');
        expect(main).toBeTruthy();
        const style = (main as HTMLElement).style;
        expect(style.overflowY).toBe('');
        expect(style.height).toBe('');
        expect(style.background).toBe('');
    });

    it('troca de aba para Templates exibe o conteúdo correto', async () => {
        render(<SchedulerAdmin />);
        const tabTemplates = await screen.findByText('📝 Templates');
        await userEvent.click(tabTemplates);
        await waitFor(() => {
            expect(screen.queryByText('Modelo Inicial')).toBeTruthy();
        }, { timeout: 5000 });
    });

    it('troca de aba para Agendar exibe o formulário de nova mensagem', async () => {
        render(<SchedulerAdmin />);
        const tabAgendar = await screen.findByText('➕ Agendar');
        await userEvent.click(tabAgendar);
        await waitFor(() => {
            expect(screen.queryByText('Agendar Nova Mensagem')).toBeTruthy();
        }, { timeout: 5000 });
    });
});

describe('SchedulerAdmin', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockFetch.mockImplementation(defaultFetchHandler);
    });

    // Wait for rules (default tab) to load
    async function waitForRulesTab() {
        // Rules tab is default — wait for "Fatura Criada WA" to appear
        await waitFor(() => {
            expect(screen.queryByText('Fatura Criada WA')).toBeTruthy();
        }, { timeout: 5000 });
    }

    // Get all "Testar" buttons (they render as "🧪 Testar")
    function getAllTestButtons() {
        return screen.getAllByRole('button', { name: /Testar/i });
    }

    async function switchTab(tabEmoji: string) {
        const tab = await screen.findByText(tabEmoji);
        await userEvent.click(tab);
    }

    describe('#603 — botão "Testar regra"', () => {
        it('abre modal de destino ao clicar Testar (não envia imediatamente)', async () => {
            render(<SchedulerAdmin />);
            await waitForRulesTab();

            const testButtons = getAllTestButtons();
            await userEvent.click(testButtons[0]);

            // Modal should appear with input
            expect(await screen.findByTestId('test-target-input')).toBeTruthy();
            // fetch for test endpoint should NOT have been called yet
            const testCalls = mockFetch.mock.calls.filter((c: any[]) => String(c[0]).includes('/test'));
            expect(testCalls.length).toBe(0);
        });

        it('envia target vazio (dry-run) quando campo deixado em branco', async () => {
            mockFetch.mockImplementation((url: string, opts?: RequestInit) => {
                if (url.includes('/test')) {
                    return okJson({ success: true, dryRun: true, realSend: null, rule: whatsappRule, mockVariables: {}, renderedMessage: 'Msg', delay: 0 });
                }
                return defaultFetchHandler(url, opts);
            });

            render(<SchedulerAdmin />);
            await waitForRulesTab();

            await userEvent.click(getAllTestButtons()[0]);
            await screen.findByTestId('test-target-input');
            // Leave empty — button text should be 'Simular (Dry-Run)'
            const simBtn = screen.getByText('Simular (Dry-Run)');
            await userEvent.click(simBtn);

            await waitFor(() => {
                const calls = mockFetch.mock.calls.filter((c: any[]) => String(c[0]).includes('/test'));
                expect(calls.length).toBeGreaterThan(0);
                const body = JSON.parse((calls[0][1] as RequestInit).body as string);
                expect(body.target).toBe('');
            });
        });

        it('envia target preenchido para envio real', async () => {
            mockFetch.mockImplementation((url: string, opts?: RequestInit) => {
                if (url.includes('/test')) {
                    return okJson({ success: true, dryRun: false, realSend: 'WhatsApp sent', rule: whatsappRule, mockVariables: {}, renderedMessage: 'Msg', delay: 0 });
                }
                return defaultFetchHandler(url, opts);
            });

            render(<SchedulerAdmin />);
            await waitForRulesTab();

            await userEvent.click(getAllTestButtons()[0]);
            const input = await screen.findByTestId('test-target-input');
            await userEvent.type(input, '5511999998888');
            // Button text changes to 'Enviar de Verdade' when field has value
            await userEvent.click(screen.getByText('Enviar de Verdade'));

            await waitFor(() => {
                const calls = mockFetch.mock.calls.filter((c: any[]) => String(c[0]).includes('/test'));
                expect(calls.length).toBeGreaterThan(0);
                const body = JSON.parse((calls[0][1] as RequestInit).body as string);
                expect(body.target).toBe('5511999998888');
            });
            expect(toast.success).toHaveBeenCalledWith(expect.stringContaining('WhatsApp sent'));
        });

        it('exibe "Conta Email" no modal de resultado para regra de canal email', async () => {
            mockFetch.mockImplementation((url: string, opts?: RequestInit) => {
                if (url.includes('/rules/rule-em-1/test')) {
                    return okJson({ success: true, dryRun: true, realSend: null, rule: emailRule, mockVariables: {}, renderedMessage: 'Email test', delay: 0 });
                }
                return defaultFetchHandler(url, opts);
            });

            render(<SchedulerAdmin />);
            await waitForRulesTab();

            const testButtons = getAllTestButtons();
            // Find the button for the email rule (second rule)
            await userEvent.click(testButtons[1]);
            await screen.findByTestId('test-target-input');
            await userEvent.click(screen.getByText('Simular (Dry-Run)'));

            await waitFor(() => {
                // The test result modal should contain "Conta Email:" as a label
                const modalHeading = screen.queryByText('🧪 Resultado do Teste');
                expect(modalHeading).toBeTruthy();
                // Get all elements containing "Conta Email" text and find one with ":" suffix (modal label)
                const contaEmailEls = screen.queryAllByText(/Conta Email/);
                const hasModalLabel = contaEmailEls.some(el => el.tagName === 'STRONG' || el.textContent?.includes('Conta Email:'));
                expect(hasModalLabel).toBe(true);
            });
        });

        it('badge DRY-RUN não aparece e badge ENVIADO aparece quando realSend está preenchido', async () => {
            mockFetch.mockImplementation((url: string, opts?: RequestInit) => {
                if (url.includes('/test')) {
                    return okJson({ success: true, dryRun: false, realSend: 'WhatsApp sent', rule: whatsappRule, mockVariables: {}, renderedMessage: 'Msg', delay: 0 });
                }
                return defaultFetchHandler(url, opts);
            });

            render(<SchedulerAdmin />);
            await waitForRulesTab();

            await userEvent.click(getAllTestButtons()[0]);
            const input = await screen.findByTestId('test-target-input');
            await userEvent.type(input, '5511999998888');
            await userEvent.click(screen.getByText('Enviar de Verdade'));

            await waitFor(() => {
                expect(screen.queryByText('ENVIADO')).toBeTruthy();
                expect(screen.queryByText('DRY-RUN')).toBeNull();
            });
        });
    });

    describe('#604 — Editar templates', () => {
        it('exibe botão "Editar" na aba Templates', async () => {
            render(<SchedulerAdmin />);
            await switchTab('📝 Templates');

            await waitFor(() => {
                expect(screen.queryByText('Modelo Inicial')).toBeTruthy();
            });
            expect(screen.queryByText('Editar')).toBeTruthy();
        });

        it('abre modal de edição com o nome do template ao clicar Editar', async () => {
            render(<SchedulerAdmin />);
            await switchTab('📝 Templates');
            await waitFor(() => expect(screen.queryByText('Modelo Inicial')).toBeTruthy());

            await userEvent.click(screen.getByText('Editar'));

            const nameInput = await screen.findByTestId('edit-template-name');
            expect((nameInput as HTMLInputElement).value).toBe('Modelo Inicial');
        });

        it('faz PUT com o novo nome ao salvar template', async () => {
            mockFetch.mockImplementation((url: string, opts?: RequestInit) => {
                if ((opts as RequestInit)?.method === 'PUT' && url.includes('/api/scheduler/templates/tpl-1')) {
                    return okJson({ success: true, data: { ...sampleTemplate, name: 'Novo Nome' } });
                }
                return defaultFetchHandler(url, opts);
            });

            render(<SchedulerAdmin />);
            await switchTab('📝 Templates');
            await waitFor(() => expect(screen.queryByText('Modelo Inicial')).toBeTruthy());

            await userEvent.click(screen.getByText('Editar'));
            const nameInput = await screen.findByTestId('edit-template-name');
            await userEvent.clear(nameInput);
            await userEvent.type(nameInput, 'Novo Nome');
            await userEvent.click(screen.getByText('Salvar'));

            await waitFor(() => {
                const putCalls = mockFetch.mock.calls.filter((c: any[]) => String(c[0]).includes('/api/scheduler/templates/tpl-1') && (c[1] as RequestInit)?.method === 'PUT');
                expect(putCalls.length).toBeGreaterThan(0);
                const body = JSON.parse((putCalls[0][1] as RequestInit).body as string);
                expect(body.name).toBe('Novo Nome');
            });
            expect(toast.success).toHaveBeenCalledWith('Template atualizado!');
        });
    });

    describe('#604 — Editar fluxos', () => {
        it('exibe botão "Editar" na aba Fluxos', async () => {
            render(<SchedulerAdmin />);
            await switchTab('🤖 Fluxos');

            await waitFor(() => expect(screen.queryByText('Fluxo Inicial')).toBeTruthy());
            expect(screen.queryByText('Editar')).toBeTruthy();
        });

        it('faz PUT com palavras-chave atualizadas ao salvar fluxo', async () => {
            mockFetch.mockImplementation((url: string, opts?: RequestInit) => {
                if ((opts as RequestInit)?.method === 'PUT' && url.includes('/api/webhook/flows/flow-1')) {
                    return okJson({ success: true, data: { ...sampleFlow, triggerKeywords: ['menu'] } });
                }
                return defaultFetchHandler(url, opts);
            });

            render(<SchedulerAdmin />);
            await switchTab('🤖 Fluxos');
            await waitFor(() => expect(screen.queryByText('Fluxo Inicial')).toBeTruthy());

            await userEvent.click(screen.getByText('Editar'));
            const keywordsInput = await screen.findByTestId('edit-flow-keywords');
            await userEvent.clear(keywordsInput);
            await userEvent.type(keywordsInput, 'menu');
            await userEvent.click(screen.getByText('Salvar'));

            await waitFor(() => {
                const putCalls = mockFetch.mock.calls.filter((c: any[]) => String(c[0]).includes('/api/webhook/flows/flow-1') && (c[1] as RequestInit)?.method === 'PUT');
                expect(putCalls.length).toBeGreaterThan(0);
                const body = JSON.parse((putCalls[0][1] as RequestInit).body as string);
                expect(body.triggerKeywords).toContain('menu');
            });
            expect(toast.success).toHaveBeenCalledWith('Fluxo atualizado!');
        });
    });
});

describe('SchedulerAdmin — #823 regras com id duplicado', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockFetch.mockImplementation(defaultFetchHandler);
    });

    it('mostra cada regra uma única vez quando a API retorna ids duplicados', async () => {
        // A mesma regra (id + name) retornada duas vezes simulam o bug real:
        // `rule_<timestamp>` colidindo no backend e gerando chaves React duplicadas.
        const dupRule = { ...whatsappRule, id: 'rule_1781739896402', name: 'Regra Espelho' };
        mockFetch.mockImplementation((url: string, opts?: RequestInit) => {
            const u = url as string;
            if (u.includes('/api/webhook/rules') && !u.includes('/test') && !u.includes('/toggle')) {
                return okJson({ count: 2, data: [dupRule, dupRule] });
            }
            return defaultFetchHandler(url, opts);
        });

        render(<SchedulerAdmin />);

        // A regra "espelho" (duplicada) deve aparecer exatamente uma vez na lista.
        await waitFor(() => {
            expect(screen.getAllByText('Regra Espelho')).toHaveLength(1);
        }, { timeout: 5000 });
    });
});
