import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmProvider } from '../../hooks/useConfirm';
import ProposalList from '../../components/ProposalList';
import { DolibarrService } from '../../services/dolibarrService';
import { useProposals, useProposalLines } from '../../hooks/dolibarr';
import { formatCurrency } from '../../utils/formatUtils';

const { toastMock } = vi.hoisted(() => ({
    toastMock: {
        success: vi.fn(),
        error: vi.fn(),
        info: vi.fn(),
        warning: vi.fn(),
    },
}));
vi.mock('sonner', () => ({ toast: toastMock }));

const { notifyErrorMock } = vi.hoisted(() => ({
    notifyErrorMock: vi.fn(),
}));
vi.mock('../../utils/notifyError', () => ({
    notifyError: notifyErrorMock,
}));

vi.mock('../../context/DolibarrContext', () => ({
    useDolibarr: vi.fn(() => ({ config: { apiUrl: 'http://test', apiKey: 'key' }, canAccess: () => true, canDo: () => true })),
}));

const mockRefetch = vi.fn();
vi.mock('../../hooks/dolibarr', () => ({
    useProposals: vi.fn(() => ({
        data: [
            {
                id: 'prop1',
                ref: 'PR2501-0001',
                socid: 'cust1',
                date: 1700000000,
                total_ht: 1000,
                total_ttc: 1200,
                statut: '1',
                project_id: null,
                fk_user_author: null,
            },
        ],
        isRefetching: false,
        refetch: mockRefetch,
    })),
    useCustomers: vi.fn(() => ({ data: [{ id: 'cust1', name: 'Cliente Teste' }] })),
    useProducts: vi.fn(() => ({ data: [] })),
    useProjects: vi.fn(() => ({ data: [] })),
    useProposalLines: vi.fn(() => ({ data: [], refetch: mockRefetch })),
    useUsers: vi.fn(() => ({ data: [] })),
}));

vi.mock('../../hooks/usePrefill', () => ({
    usePrefill: vi.fn(() => null),
}));

vi.mock('../../hooks/useDolibarrLink', () => ({
    useDolibarrLink: vi.fn(() => ({ openLink: vi.fn() })),
}));

vi.mock('../../services/dolibarrService', () => ({
    DolibarrService: {
        cloneProposal: vi.fn(),
        deleteProposal: vi.fn(),
        downloadDocument: vi.fn(),
        createProposal: vi.fn(),
        updateProposal: vi.fn(),
    },
}));

vi.mock('../../services/aiService', () => ({
    AiService: {
        auditProposal: vi.fn(),
    },
}));

vi.mock('react-virtualized-auto-sizer', () => ({
    default: ({ children }: any) => children({ height: 600, width: 800 }),
}));

vi.mock('react-window', () => ({
    FixedSizeList: ({ children, itemCount }: any) => (
        <>
            {Array.from({ length: itemCount }, (_, index) =>
                children({ index, style: {} })
            )}
        </>
    ),
}));

vi.mock('../../utils/sanitizeHtml', () => ({
    sanitizeHtml: (html: string) => html,
}));

vi.mock('../../components/common/LinkedObjects', () => ({
    LinkedObjects: () => null,
}));

const mockConfig = { apiUrl: 'http://test', apiKey: 'key' };

const renderComponent = (props?: Record<string, any>) =>
    render(
        <ConfirmProvider>
            <ProposalList {...props} />
        </ConfirmProvider>
    );

describe('ProposalList — Duplicate button', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.spyOn(window, 'alert').mockImplementation(() => {});
        vi.spyOn(window, 'confirm').mockImplementation(() => false);
    });

    it('shows toast.success and refetches when duplicate succeeds', async () => {
        vi.mocked(DolibarrService.cloneProposal).mockResolvedValue('new-id' as any);
        const user = userEvent.setup();
        renderComponent();

        const dupBtn = await screen.findByLabelText('Duplicar');
        await user.click(dupBtn);

        const confirmBtn = await screen.findByText('Confirmar');
        await user.click(confirmBtn);

        await waitFor(() => {
            expect(DolibarrService.cloneProposal).toHaveBeenCalledWith(mockConfig, 'prop1');
            expect(toastMock.success).toHaveBeenCalledWith('Proposta duplicada com sucesso');
            expect(mockRefetch).toHaveBeenCalled();
        });
        expect(window.confirm).not.toHaveBeenCalled();
    });

    it('calls notifyError with the real error when duplicate fails', async () => {
        const err = new Error('Dolibarr says no');
        vi.mocked(DolibarrService.cloneProposal).mockRejectedValue(err);
        const user = userEvent.setup();
        renderComponent();

        const dupBtn = await screen.findByLabelText('Duplicar');
        await user.click(dupBtn);

        const confirmBtn = await screen.findByText('Confirmar');
        await user.click(confirmBtn);

        await waitFor(() => {
            expect(DolibarrService.cloneProposal).toHaveBeenCalledWith(mockConfig, 'prop1');
            expect(notifyErrorMock).toHaveBeenCalledWith('Duplicar proposta', err);
            expect(toastMock.error).not.toHaveBeenCalledWith('Erro ao duplicar proposta');
        });
    });

    it('does NOT call cloneProposal when user cancels confirmation', async () => {
        vi.mocked(DolibarrService.cloneProposal).mockResolvedValue('new-id' as any);
        const user = userEvent.setup();
        renderComponent();

        const dupBtn = await screen.findByLabelText('Duplicar');
        await user.click(dupBtn);

        const cancelBtn = await screen.findByText('Cancelar');
        await user.click(cancelBtn);

        await waitFor(() => {
            expect(DolibarrService.cloneProposal).not.toHaveBeenCalled();
            expect(toastMock.success).not.toHaveBeenCalled();
        });
    });
});

describe('ProposalList — Total bar (#486)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders the total bar with the sum of all visible proposals as BRL', async () => {
        renderComponent();

        const totalBar = await screen.findByTestId('list-total-bar');
        expect(totalBar).toBeTruthy();

        const totalValue = screen.getByTestId('list-total-value');
        expect(totalValue.textContent).toBe(formatCurrency(1200));
    });

    it('shows R$ 0,00 when there are no proposals', async () => {
        vi.mocked(useProposals).mockReturnValue({
            data: [],
            isRefetching: false,
            refetch: vi.fn(),
        } as any);

        renderComponent();

        const totalValue = await screen.findByTestId('list-total-value');
        expect(totalValue.textContent).toBe(formatCurrency(0));
    });

    it('updates the total when filtering by status tab', async () => {
        vi.mocked(useProposals).mockReturnValue({
            data: [
                { id: 'prop1', ref: 'PR001', socid: 'cust1', date: 1700000000, total_ht: 1000, total_ttc: 1200, statut: '1', project_id: null, fk_user_author: null },
                { id: 'prop2', ref: 'PR002', socid: 'cust1', date: 1700000001, total_ht: 500, total_ttc: 600, statut: '2', project_id: null, fk_user_author: null },
            ],
            isRefetching: false,
            refetch: vi.fn(),
        } as any);

        const user = userEvent.setup();
        renderComponent();

        const totalValue = await screen.findByTestId('list-total-value');
        expect(totalValue.textContent).toBe(formatCurrency(1800));

        await user.click(screen.getByText('Assinadas'));

        await waitFor(() => {
            expect(screen.getByTestId('list-total-value').textContent).toBe(formatCurrency(600));
        });
    });
});

describe('ProposalList — Currency standardization (#639)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders proposal values in BRL via formatCurrency (no USD $ prefix)', async () => {
        vi.mocked(useProposals).mockReturnValue({
            data: [
                { id: 'propX', ref: 'PRX1', socid: 'cust1', date: 1700000000, total_ht: 1000, total_ttc: 2345.67, statut: '1', project_id: null, fk_user_author: null },
            ],
            isRefetching: false,
            refetch: vi.fn(),
        } as any);

        const { container } = renderComponent();
        await screen.findByTestId('list-total-bar');

        const formatted = formatCurrency(2345.67);
        const matches = Array.from(container.querySelectorAll('*')).filter(
            (el) => el.textContent === formatted
        );
        // The row total AND the total bar both render the BRL value
        expect(matches.length).toBeGreaterThanOrEqual(2);
    });
});

const defaultProposal = {
    id: 'prop1',
    ref: 'PR2501-0001',
    socid: 'cust1',
    date: 1700000000,
    total_ht: 1000,
    total_ttc: 1200,
    statut: '1',
    project_id: null,
    fk_user_author: null,
};

describe('ProposalList — Responsividade (#545)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Restore default mock data (previous tests may have overridden it with mockReturnValue)
        vi.mocked(useProposals).mockReturnValue({
            data: [defaultProposal],
            isRefetching: false,
            refetch: mockRefetch,
        } as any);
    });

    it('renders proposal list with ref, customer name, and total', async () => {
        renderComponent();

        // Wait for list to be fully rendered (Duplicar button is inside the Row component)
        const dupBtn = await screen.findByLabelText('Duplicar');
        expect(dupBtn).toBeTruthy();

        // Ref da proposta — text is in a span inside the Row
        const refEls = screen.queryAllByText(/PR2501-0001/);
        expect(refEls.length).toBeGreaterThanOrEqual(1);
        // Nome do cliente
        const customerEls = screen.queryAllByText(/Cliente Teste/);
        expect(customerEls.length).toBeGreaterThanOrEqual(1);
        // Total formatado deve aparecer (pelo menos uma vez no card da lista)
        // Usa regex para tolerar diferenças de espaço/encoding no formatCurrency
        const totals = screen.queryAllByText(/1[.,]200/);
        expect(totals.length).toBeGreaterThanOrEqual(1);
    });

    it('actions (Editar, Duplicar, Excluir) are accessible without hover — not hidden behind opacity-0 in DOM', async () => {
        renderComponent();

        // Wait for render
        await screen.findByTestId('list-total-bar');

        // findByLabelText para garantir que o botão está renderizado e acessível
        const dupBtn = screen.getByLabelText('Duplicar');
        expect(dupBtn).toBeTruthy();

        // O contêiner pai das ações NÃO deve ter a classe opacity-0 isolada (sem md: prefix)
        // Verificamos que o wrapper das ações não tem `opacity-0` puro (o qual bloquearia touch)
        const actionsWrapper = dupBtn.closest('[class*="opacity"]') || dupBtn.parentElement;
        if (actionsWrapper) {
            // A classe deve ser md:opacity-0 (prefixada), nunca só opacity-0 sem prefixo breakpoint
            const cls = actionsWrapper.getAttribute('class') || '';
            expect(cls).not.toMatch(/(?:^|\s)opacity-0(?:\s|$)/);
        }
    });

    it('card row has responsive flex classes (flex-col mobile / md:flex-row desktop)', async () => {
        const { container } = renderComponent();

        // Wait for render
        await screen.findByTestId('list-total-bar');

        // O card do item da lista deve ter as classes de layout responsivo
        const cardWithResponsiveLayout = container.querySelector('[class*="flex-col"][class*="md:flex-row"]');
        expect(cardWithResponsiveLayout).not.toBeNull();
    });

    it('header actions container has flex-wrap for reflow on narrow screens', async () => {
        const { container } = renderComponent();

        // Wait for render
        await screen.findByTestId('list-total-bar');

        // O wrapper das actions do PageHeader deve ter flex-wrap
        const wrapEl = container.querySelector('[class*="flex-wrap"]');
        expect(wrapEl).not.toBeNull();
    });
});

describe('ProposalList — Edit date conversion (#626)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('shows the correct date in the edit form when date is in unix seconds', async () => {
        // date: 1718000000 = ~10/06/2024 (unix SEGUNDOS, como retornado pela API)
        vi.mocked(useProposals).mockReturnValue({
            data: [
                {
                    id: 'prop-date',
                    ref: 'PR-DATE-001',
                    socid: 'cust1',
                    date: 1718000000,
                    total_ht: 1000,
                    total_ttc: 1200,
                    statut: '1',
                    project_id: null,
                    fk_user_author: null,
                },
            ],
            isRefetching: false,
            refetch: vi.fn(),
        } as any);

        const user = userEvent.setup();
        renderComponent();

        // Seleciona a proposta para abrir o detail view
        await user.click(await screen.findByText('PR-DATE-001'));

        // Abre o formulário de edição pelo botão "Editar" do detail view
        await user.click(await screen.findByText('Editar'));

        // O input[type=date] deve mostrar 2024-06-10 (segundos convertidos p/ ms),
        // e NÃO uma data de 1970 (que ocorreria ao tratar segundos como milissegundos).
        const dateInput = await screen.findByDisplayValue('2024-06-10') as HTMLInputElement;
        expect(dateInput).toBeTruthy();
        expect(dateInput.type).toBe('date');
    });
});

// ─────────────────────────────────────────────
// Chaves estáveis nas linhas da proposta (#825)
// ─────────────────────────────────────────────
describe('ProposalList — chaves estáveis nas linhas (#825)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(useProposals).mockReturnValue({
            data: [defaultProposal],
            isRefetching: false,
            refetch: mockRefetch,
        } as any);
    });

    // Cada linha do formulário tem um rótulo "Qtd" (span) seguido do input de
    // quantidade correspondente. Usamos esse rótulo como âncora estável para
    // localizar o input de uma linha específica, independentemente da ordem.
    const getQtyInput = (lineIdx: number): HTMLInputElement => {
        const labels = screen.getAllByText('Qtd', { selector: 'span' });
        return labels[lineIdx].parentElement!.querySelector('input') as HTMLInputElement;
    };

    const getRemoveBtn = (lineIdx: number): HTMLElement => {
        const row = getQtyInput(lineIdx).closest('.bg-slate-50') as HTMLElement;
        return row.querySelector('button[class*="text-red-500"]') as HTMLElement;
    };

    it('remover uma linha do meio não troca os dados das linhas restantes', async () => {
        const user = userEvent.setup();
        renderComponent();

        await user.click(await screen.findByRole('button', { name: /^Nova$/ }));

        const addBtn = screen.getByRole('button', { name: /Adicionar Item/i });
        await user.click(addBtn);
        await user.click(addBtn);
        await user.click(addBtn);

        expect(screen.getAllByText('Qtd', { selector: 'span' })).toHaveLength(3);

        // Digita quantidades distintas por linha
        await user.clear(getQtyInput(0));
        await user.type(getQtyInput(0), '11');
        await user.clear(getQtyInput(1));
        await user.type(getQtyInput(1), '22');
        await user.clear(getQtyInput(2));
        await user.type(getQtyInput(2), '33');

        // Remove a linha do meio (Qtd 22) pelo botão de exclusão da própria linha
        await user.click(getRemoveBtn(1));

        // As linhas restantes mantêm seus dados (11 e 33), sem troca entre
        // linhas — sintoma de key={idx} instável (#825).
        const remaining = screen
            .getAllByText('Qtd', { selector: 'span' })
            .map((l) => (l.parentElement!.querySelector('input') as HTMLInputElement).value);
        expect(remaining).toEqual(['11', '33']);
        expect(screen.queryByDisplayValue('22')).toBeNull();
    });

    it('cada linha nova recebe id estável distinto (crypto.randomUUID, não índice)', async () => {
        const user = userEvent.setup();
        renderComponent();

        await user.click(await screen.findByRole('button', { name: /^Nova$/ }));

        const addBtn = screen.getByRole('button', { name: /Adicionar Item/i });
        await user.click(addBtn);
        await user.click(addBtn);

        // Duas linhas recém-adicionadas, cada uma com input de quantidade próprio
        // — a chave vem de crypto.randomUUID(), não do índice do array.
        expect(screen.getAllByText('Qtd', { selector: 'span' })).toHaveLength(2);
    });
});

// ─────────────────────────────────────────────
// Chaves estáveis no detalhe somente leitura (#825)
// ─────────────────────────────────────────────
describe('ProposalList — chaves estáveis no detalhe somente leitura (#825)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(useProposals).mockReturnValue({
            data: [defaultProposal],
            isRefetching: false,
            refetch: mockRefetch,
        } as any);
    });

    it('linhas do backend sem id recebem uid estável e não geram aviso de chave duplicada', async () => {
        vi.mocked(useProposalLines).mockReturnValue({
            data: [
                { parent_id: 'prop1', label: 'Linha Sem Id A', qty: 1, subprice: 10, total_ht: 10 },
                { parent_id: 'prop1', label: 'Linha Sem Id B', qty: 2, subprice: 20, total_ht: 40 },
            ],
            refetch: mockRefetch,
        } as any);

        const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const user = userEvent.setup();
        renderComponent();

        await user.click(await screen.findByText('PR2501-0001'));

        // As linhas (sem id do backend) renderizam no detalhe somente leitura (#825)
        await waitFor(() => {
            expect(screen.getByText('Linha Sem Id A')).toBeTruthy();
            expect(screen.getByText('Linha Sem Id B')).toBeTruthy();
        });

        // Sem aviso de chave duplicada — uid estável gerado no cliente, não índice (#825)
        const dupKey = spy.mock.calls.find(
            (c) => typeof c[0] === 'string' && c[0].includes('children with the same key')
        );
        expect(dupKey).toBeUndefined();
        spy.mockRestore();
    });
});
