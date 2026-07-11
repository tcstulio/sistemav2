import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import ContractList from '../../components/ContractList';
import { ConfirmProvider } from '../../hooks/useConfirm';
import { DolibarrService } from '../../services/dolibarrService';
import { useDolibarr } from '../../context/DolibarrContext';

// --- Mock sonner so we can assert toast calls ---
const { toastMock } = vi.hoisted(() => ({
    toastMock: {
        success: vi.fn(),
        error: vi.fn(),
        info: vi.fn(),
        warning: vi.fn(),
    },
}));
vi.mock('sonner', () => ({ toast: toastMock }));

vi.mock('../../services/dolibarrService', () => ({
    DolibarrService: {
        createContract: vi.fn(),
        updateObject: vi.fn(),
        validateContract: vi.fn(),
        closeContract: vi.fn(),
        deleteContract: vi.fn(),
    },
}));

vi.mock('../../context/DolibarrContext', () => ({
    useDolibarr: vi.fn(() => ({
        config: { baseUrl: 'http://test', apiKey: 'key', currentUser: { id: '1' } },
        canAccess: () => true,
        canDo: () => true,
    })),
}));

vi.mock('../../hooks/dolibarr', () => ({
    useContracts: vi.fn(() => ({ data: [], refetch: vi.fn() })),
    useCustomers: vi.fn(() => ({ data: [] })),
    useProjects: vi.fn(() => ({ data: [] })),
    useInvoices: vi.fn(() => ({ data: [] })),
}));

vi.mock('../../hooks/usePrefill', () => ({
    usePrefill: vi.fn(() => null),
}));

vi.mock('../../components/common/LinkedObjects', () => ({
    LinkedObjects: () => null,
}));

const { useContracts, useCustomers, useProjects } = await import('../../hooks/dolibarr');

const contractsMock = [
    {
        id: '1',
        ref: 'CTR-001',
        socid: '10',
        project_id: '',
        date_contrat: Math.floor(new Date('2024-01-01').getTime() / 1000),
        statut: '0' as const,
        note_public: '',
        lines: [],
    },
    {
        id: '2',
        ref: 'CTR-002',
        socid: '20',
        project_id: '5',
        date_contrat: Math.floor(new Date('2024-03-01').getTime() / 1000),
        statut: '1' as const,
        note_public: 'Contrato de suporte',
        lines: [
            { id: '100', desc: 'Suporte mensal', qty: 1, price: 1500 },
            { id: '101', desc: 'Licença software', qty: 3, price: 200 },
        ],
    },
];

const customersMock = [
    { id: '10', name: 'Cliente Alpha' },
    { id: '20', name: 'Cliente Beta' },
];

const projectsMock = [
    { id: '5', ref: 'PRJ-005', title: 'Projeto Omega' },
    { id: '6', ref: 'PRJ-006', title: 'Projeto Delta' },
];

const setupMocks = () => {
    vi.mocked(useContracts).mockReturnValue({
        data: contractsMock,
        refetch: vi.fn(),
    } as any);
    vi.mocked(useCustomers).mockReturnValue({ data: customersMock } as any);
    vi.mocked(useProjects).mockReturnValue({ data: projectsMock } as any);
};

const renderList = (props?: { onNavigate?: any; onRefresh?: any }) =>
    render(
        <MemoryRouter>
            <ConfirmProvider>
                <ContractList {...props} />
            </ConfirmProvider>
        </MemoryRouter>
    );

describe('ContractList', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        setupMocks();
    });

    it('renders the contract list', async () => {
        renderList();
        await waitFor(() => {
            expect(screen.getByText('CTR-001')).toBeInTheDocument();
            expect(screen.getByText('CTR-002')).toBeInTheDocument();
        });
    });

    describe('Create modal - Project selector', () => {
        it('renders Projeto selector in new contract modal', async () => {
            const user = userEvent.setup();
            renderList();

            await waitFor(() => screen.getByText('CTR-001'));
            await user.click(screen.getByRole('button', { name: /Novo Contrato/i }));

            const modal = await screen.findByRole('dialog');
            expect(within(modal).getByText('Projeto (Opcional)')).toBeInTheDocument();
            // Should show "Nenhum projeto..." option
            expect(within(modal).getByDisplayValue('Nenhum projeto...')).toBeInTheDocument();
        });

        it('lists projects in the Projeto selector', async () => {
            const user = userEvent.setup();
            renderList();

            await waitFor(() => screen.getByText('CTR-001'));
            await user.click(screen.getByRole('button', { name: /Novo Contrato/i }));

            const modal = await screen.findByRole('dialog');
            const projectSelect = within(modal).getByDisplayValue('Nenhum projeto...');
            // All project options should be present
            expect(within(projectSelect as HTMLSelectElement).getByText('Projeto Omega')).toBeInTheDocument();
            expect(within(projectSelect as HTMLSelectElement).getByText('Projeto Delta')).toBeInTheDocument();
        });

        it('includes project_id in payload when creating contract with project', async () => {
            const user = userEvent.setup();
            vi.mocked(DolibarrService.createContract).mockResolvedValue({ id: '99' } as any);

            renderList();

            await waitFor(() => screen.getByText('CTR-001'));
            await user.click(screen.getByRole('button', { name: /Novo Contrato/i }));

            const modal = await screen.findByRole('dialog');

            // Select customer
            const customerSelect = within(modal).getByDisplayValue('Selecione o Cliente...');
            await user.selectOptions(customerSelect, '10');

            // Select project
            const projectSelect = within(modal).getByDisplayValue('Nenhum projeto...');
            await user.selectOptions(projectSelect, '5');

            await user.click(within(modal).getByRole('button', { name: /Criar/i }));

            await waitFor(() => {
                expect(DolibarrService.createContract).toHaveBeenCalledTimes(1);
                const callArg = vi.mocked(DolibarrService.createContract).mock.calls[0][1];
                expect(callArg).toMatchObject({ project_id: '5' });
            });
        });

        it('does NOT include project_id in payload when no project selected', async () => {
            const user = userEvent.setup();
            vi.mocked(DolibarrService.createContract).mockResolvedValue({ id: '100' } as any);

            renderList();

            await waitFor(() => screen.getByText('CTR-001'));
            await user.click(screen.getByRole('button', { name: /Novo Contrato/i }));

            const modal = await screen.findByRole('dialog');

            const customerSelect = within(modal).getByDisplayValue('Selecione o Cliente...');
            await user.selectOptions(customerSelect, '10');

            // Leave project empty
            await user.click(within(modal).getByRole('button', { name: /Criar/i }));

            await waitFor(() => {
                expect(DolibarrService.createContract).toHaveBeenCalledTimes(1);
                const callArg = vi.mocked(DolibarrService.createContract).mock.calls[0][1];
                expect(callArg).not.toHaveProperty('project_id');
            });
        });
    });

    describe('Edit modal - Project selector', () => {
        it('pre-populates Projeto selector when editing a contract with project_id', async () => {
            const user = userEvent.setup();
            renderList();

            await waitFor(() => screen.getByText('CTR-002'));
            // Click contract #2 (has project_id='5')
            await user.click(screen.getByText('CTR-002'));

            // Click Editar button in detail
            const editBtn = await screen.findByRole('button', { name: /Editar/i });
            await user.click(editBtn);

            const modal = await screen.findByRole('dialog');
            // Project select should be pre-populated with project_id='5'
            const projectSelect = within(modal).getByDisplayValue('Projeto Omega');
            expect(projectSelect).toBeInTheDocument();
        });

        it('includes project_id in payload when updating contract', async () => {
            const user = userEvent.setup();
            vi.mocked(DolibarrService.updateObject).mockResolvedValue({} as any);

            renderList();

            await waitFor(() => screen.getByText('CTR-002'));
            await user.click(screen.getByText('CTR-002'));

            const editBtn = await screen.findByRole('button', { name: /Editar/i });
            await user.click(editBtn);

            const modal = await screen.findByRole('dialog');
            await user.click(within(modal).getByRole('button', { name: /Salvar/i }));

            await waitFor(() => {
                expect(DolibarrService.updateObject).toHaveBeenCalledTimes(1);
                const callArg = vi.mocked(DolibarrService.updateObject).mock.calls[0][3];
                expect(callArg).toMatchObject({ project_id: '5' });
            });
        });
    });

    describe('Contract detail - Lines section', () => {
        it('shows contract lines with description, qty and price when contract has lines', async () => {
            const user = userEvent.setup();
            renderList();

            await waitFor(() => screen.getByText('CTR-002'));
            await user.click(screen.getByText('CTR-002'));

            await waitFor(() => {
                expect(screen.getByText('Linhas de Serviço')).toBeInTheDocument();
                expect(screen.getByText('Suporte mensal')).toBeInTheDocument();
                expect(screen.getByText('Licença software')).toBeInTheDocument();
            });
        });

        it('shows empty state when contract has no lines', async () => {
            const user = userEvent.setup();
            renderList();

            await waitFor(() => screen.getByText('CTR-001'));
            await user.click(screen.getByText('CTR-001'));

            await waitFor(() => {
                expect(screen.getByText('Linhas de Serviço')).toBeInTheDocument();
                expect(screen.getByText('Sem linhas de serviço')).toBeInTheDocument();
            });
        });

        it('shows total value when contract has lines', async () => {
            const user = userEvent.setup();
            renderList();

            await waitFor(() => screen.getByText('CTR-002'));
            await user.click(screen.getByText('CTR-002'));

            await waitFor(() => {
                // Total should be (1*1500) + (3*200) = 2100
                expect(screen.getByText(/Total:/i)).toBeInTheDocument();
            });
        });
    });

    describe('Contract detail - NaN guard on lines total (#1107)', () => {
        it('does not render NaN total when line price/qty are missing (null/undefined)', async () => {
            const user = userEvent.setup();
            vi.mocked(useContracts).mockReturnValue({
                data: [
                    {
                        id: '3',
                        ref: 'CTR-003',
                        socid: '20',
                        project_id: '',
                        date_contrat: Math.floor(new Date('2024-05-01').getTime() / 1000),
                        statut: '1' as const,
                        note_public: '',
                        lines: [
                            { id: '200', desc: 'Preço ausente', qty: 2, price: undefined },
                            { id: '201', desc: 'Qtd ausente', qty: undefined, price: 100 },
                            { id: '202', desc: 'Preço nulo', qty: 3, price: null },
                            { id: '203', desc: 'Válido', qty: 1, price: 500 },
                        ],
                    },
                ],
                refetch: vi.fn(),
            } as any);

            renderList();

            await waitFor(() => screen.getByText('CTR-003'));
            await user.click(screen.getByText('CTR-003'));

            await waitFor(() => {
                expect(screen.getByText('Linhas de Serviço')).toBeInTheDocument();
            });

            // Without the guard, `undefined * number` => NaN and the whole total
            // becomes "R$ NaN". Invalid lines must contribute 0; only the valid
            // line (1 * 500) counts.
            expect(screen.queryByText(/NaN/)).toBeNull();
            const totalEl = screen.getByText(/Total:/i);
            expect(totalEl.textContent).not.toMatch(/NaN/);
            expect(totalEl).toHaveTextContent(/500,00/);
        });

        it('renders R$ 0,00 total when every line is missing price/qty', async () => {
            const user = userEvent.setup();
            vi.mocked(useContracts).mockReturnValue({
                data: [
                    {
                        id: '4',
                        ref: 'CTR-004',
                        socid: '20',
                        project_id: '',
                        date_contrat: Math.floor(new Date('2024-06-01').getTime() / 1000),
                        statut: '0' as const,
                        note_public: '',
                        lines: [
                            { id: '300', desc: 'Tudo ausente', qty: undefined, price: undefined },
                            { id: '301', desc: 'Só preço', qty: undefined, price: 100 },
                        ],
                    },
                ],
                refetch: vi.fn(),
            } as any);

            renderList();

            await waitFor(() => screen.getByText('CTR-004'));
            await user.click(screen.getByText('CTR-004'));

            await waitFor(() => {
                expect(screen.getByText(/Total:/i)).toBeInTheDocument();
            });

            expect(screen.queryByText(/NaN/)).toBeNull();
            const totalEl = screen.getByText(/Total:/i);
            expect(totalEl.textContent).not.toMatch(/NaN/);
            expect(totalEl).toHaveTextContent(/0,00/);
        });

        it('guards the total reduce against literal NaN price/qty', async () => {
            const user = userEvent.setup();
            vi.mocked(useContracts).mockReturnValue({
                data: [
                    {
                        id: '5',
                        ref: 'CTR-005',
                        socid: '20',
                        project_id: '',
                        date_contrat: Math.floor(new Date('2024-07-01').getTime() / 1000),
                        statut: '1' as const,
                        note_public: '',
                        lines: [
                            { id: '400', desc: 'Valores corrompidos', qty: NaN, price: NaN },
                            { id: '401', desc: 'Válido', qty: 2, price: 200 },
                        ],
                    },
                ],
                refetch: vi.fn(),
            } as any);

            renderList();

            await waitFor(() => screen.getByText('CTR-005'));
            await user.click(screen.getByText('CTR-005'));

            // With the per-line + total guards, literal NaN price/qty never leaks:
            // invalid values fall back to 0, so the total is (0*0) + (2*200) = 400,
            // never NaN — and no per-line span renders "R$ NaN" either.
            expect(screen.queryByText(/NaN/)).toBeNull();
            const totalEl = await screen.findByText(/Total:/i);
            expect(totalEl.textContent).not.toMatch(/NaN/);
            expect(totalEl).toHaveTextContent(/400,00/);
        });
    });

    describe('Rules of Hooks — early return apos todos os hooks (#1104)', () => {
        it('renderiza null quando config é null (todos os hooks ainda executam)', () => {
            vi.mocked(useDolibarr).mockReturnValue({
                config: null,
                canAccess: () => true,
                canDo: () => true,
            } as any);

            const { container } = renderList();
            expect(container.firstChild).toBeNull();
        });

        it('sobrevive a transicao config null → set sem quebrar a ordem de hooks', async () => {
            vi.mocked(useDolibarr).mockReturnValue({
                config: null,
                canAccess: () => true,
                canDo: () => true,
            } as any);

            const { container, rerender } = renderList();
            expect(container.firstChild).toBeNull();

            vi.mocked(useDolibarr).mockReturnValue({
                config: { baseUrl: 'http://test', apiKey: 'key', currentUser: { id: '1' } },
                canAccess: () => true,
                canDo: () => true,
            } as any);

            rerender(
                <MemoryRouter>
                    <ConfirmProvider>
                        <ContractList />
                    </ConfirmProvider>
                </MemoryRouter>
            );

            await waitFor(() => {
                expect(screen.getByText('CTR-001')).toBeInTheDocument();
            });
        });
    });
});
