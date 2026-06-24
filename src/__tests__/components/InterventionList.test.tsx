import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import InterventionList from '../../components/InterventionList';
import { ConfirmProvider } from '../../hooks/useConfirm';
import { DolibarrService } from '../../services/dolibarrService';

// --- Mock sonner so we can assert toast calls instead of native alert ---
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
        createIntervention: vi.fn(),
        updateIntervention: vi.fn(),
        validateIntervention: vi.fn(),
        deleteIntervention: vi.fn(),
        addInterventionLine: vi.fn(),
        deleteInterventionLine: vi.fn(),
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
    useInterventions: vi.fn(() => ({ data: [], refetch: vi.fn() })),
    useCustomers: vi.fn(() => ({ data: [] })),
    useProjects: vi.fn(() => ({ data: [] })),
    useInterventionLines: vi.fn(() => ({ data: [], refetch: vi.fn() })),
}));

vi.mock('../../hooks/usePrefill', () => ({
    usePrefill: vi.fn(() => null),
}));

vi.mock('../../components/common/LinkedObjects', () => ({
    LinkedObjects: () => null,
}));

vi.mock('../../utils/sanitizeHtml', () => ({
    sanitizeHtml: (s: string) => s,
}));

const { useInterventions, useCustomers, useProjects, useInterventionLines } =
    await import('../../hooks/dolibarr');

const interventionsMock = [
    {
        id: '1',
        ref: 'INT-001',
        socid: '10',
        project_id: '',
        date: Math.floor(new Date('2024-06-01').getTime() / 1000),
        statut: '0',
        description: 'Manutenção preventiva',
        fk_user_author: '1',
        lines: [],
    },
    {
        id: '2',
        ref: 'INT-002',
        socid: '20',
        project_id: '',
        date: Math.floor(new Date('2024-06-10').getTime() / 1000),
        statut: '1',
        description: 'Instalação completa',
        fk_user_author: '2',
        lines: [],
    },
];

const customersMock = [
    { id: '10', name: 'Cliente Alpha' },
    { id: '20', name: 'Cliente Beta' },
];

const refetchLinesMock = vi.fn();

const setupMocks = () => {
    vi.mocked(useInterventions).mockReturnValue({
        data: interventionsMock,
        refetch: vi.fn(),
    } as any);
    vi.mocked(useCustomers).mockReturnValue({ data: customersMock } as any);
    vi.mocked(useProjects).mockReturnValue({ data: [] } as any);
    vi.mocked(useInterventionLines).mockReturnValue({ data: [], refetch: refetchLinesMock } as any);
};

const renderList = (props?: { onNavigate?: any; onRefresh?: any }) =>
    render(
        <MemoryRouter>
            <ConfirmProvider>
                <InterventionList {...props} />
            </ConfirmProvider>
        </MemoryRouter>
    );

describe('InterventionList', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        setupMocks();
    });

    it('renders the intervention list', async () => {
        renderList();
        await waitFor(() => {
            expect(screen.getByText('INT-001')).toBeInTheDocument();
            expect(screen.getByText('INT-002')).toBeInTheDocument();
        });
    });

    it('opens the in-app confirm dialog on Validar (not native confirm)', async () => {
        const user = userEvent.setup();
        const confirmSpy = vi.spyOn(window, 'confirm');

        renderList();

        await waitFor(() => screen.getByText('INT-001'));
        await user.click(screen.getByText('INT-001'));

        const validateBtn = await screen.findByRole('button', { name: /Validar/i });
        await user.click(validateBtn);

        const dialog = await screen.findByRole('dialog');
        expect(dialog).toBeInTheDocument();
        expect(within(dialog).getByText('Validar esta intervenção?')).toBeInTheDocument();

        expect(confirmSpy).not.toHaveBeenCalled();
        confirmSpy.mockRestore();
    });

    it('validates the intervention and shows toast.success when user confirms', async () => {
        const user = userEvent.setup();
        vi.mocked(DolibarrService.validateIntervention).mockResolvedValue({} as any);
        const onRefresh = vi.fn();
        const alertSpy = vi.spyOn(window, 'alert');

        renderList({ onRefresh });

        await waitFor(() => screen.getByText('INT-001'));
        await user.click(screen.getByText('INT-001'));

        const validateBtn = await screen.findByRole('button', { name: /Validar/i });
        await user.click(validateBtn);

        const dialog = await screen.findByRole('dialog');
        await user.click(within(dialog).getByText('Confirmar'));

        await waitFor(() => {
            expect(DolibarrService.validateIntervention).toHaveBeenCalledTimes(1);
            expect(toastMock.success).toHaveBeenCalledWith('Intervenção Validada');
        });
        expect(onRefresh).toHaveBeenCalled();
        expect(alertSpy).not.toHaveBeenCalled();
        alertSpy.mockRestore();
    });

    it('does NOT validate when user cancels the dialog', async () => {
        const user = userEvent.setup();
        renderList();

        await waitFor(() => screen.getByText('INT-001'));
        await user.click(screen.getByText('INT-001'));

        const validateBtn = await screen.findByRole('button', { name: /Validar/i });
        await user.click(validateBtn);

        const dialog = await screen.findByRole('dialog');
        await user.click(within(dialog).getByText('Cancelar'));

        await waitFor(() => {
            expect(DolibarrService.validateIntervention).not.toHaveBeenCalled();
        });
    });

    it('shows toast.error via notifyError (not native alert) when validation fails', async () => {
        const user = userEvent.setup();
        vi.mocked(DolibarrService.validateIntervention).mockRejectedValue(
            new Error('Falha de rede') as any,
        );
        const alertSpy = vi.spyOn(window, 'alert');

        renderList();

        await waitFor(() => screen.getByText('INT-001'));
        await user.click(screen.getByText('INT-001'));

        const validateBtn = await screen.findByRole('button', { name: /Validar/i });
        await user.click(validateBtn);

        const dialog = await screen.findByRole('dialog');
        await user.click(within(dialog).getByText('Confirmar'));

        await waitFor(() => {
            expect(toastMock.error).toHaveBeenCalledWith(
                'Validar intervenção falhou.',
                expect.objectContaining({ description: expect.stringContaining('Falha de rede') }),
            );
        });
        expect(alertSpy).not.toHaveBeenCalled();
        alertSpy.mockRestore();
    });

    it('creates an intervention with toast.success and no native alert', async () => {
        const user = userEvent.setup();
        vi.mocked(DolibarrService.createIntervention).mockResolvedValue({ id: '99' } as any);
        const alertSpy = vi.spyOn(window, 'alert');

        renderList();

        await waitFor(() => screen.getByText('INT-001'));

        await user.click(screen.getByRole('button', { name: /Nova Intervenção/i }));

        // Select customer
        const customerSelect = await screen.findByDisplayValue('Selecione o Cliente...');
        await user.selectOptions(customerSelect, '10');

        await user.click(screen.getByText('Criar'));

        await waitFor(() => {
            expect(DolibarrService.createIntervention).toHaveBeenCalledTimes(1);
            expect(toastMock.success).toHaveBeenCalledWith('Intervenção criada com sucesso');
        });
        expect(alertSpy).not.toHaveBeenCalled();
        alertSpy.mockRestore();
    });

    it('shows toast.error via notifyError (not native alert) when creation fails', async () => {
        const user = userEvent.setup();
        vi.mocked(DolibarrService.createIntervention).mockRejectedValue(
            new Error('Erro servidor') as any,
        );
        const alertSpy = vi.spyOn(window, 'alert');

        renderList();

        await waitFor(() => screen.getByText('INT-001'));

        await user.click(screen.getByRole('button', { name: /Nova Intervenção/i }));

        const customerSelect = await screen.findByDisplayValue('Selecione o Cliente...');
        await user.selectOptions(customerSelect, '10');

        await user.click(screen.getByText('Criar'));

        await waitFor(() => {
            expect(toastMock.error).toHaveBeenCalledWith(
                'Salvar intervenção falhou.',
                expect.objectContaining({ description: expect.stringContaining('Erro servidor') }),
            );
        });
        expect(alertSpy).not.toHaveBeenCalled();
        alertSpy.mockRestore();
    });

    it('updates an intervention via updateIntervention (not updateObject) and shows toast.success', async () => {
        const user = userEvent.setup();
        vi.mocked(DolibarrService.updateIntervention).mockResolvedValue({} as any);
        const onRefresh = vi.fn();
        const alertSpy = vi.spyOn(window, 'alert');

        renderList({ onRefresh });

        await waitFor(() => screen.getByText('INT-001'));
        await user.click(screen.getByText('INT-001'));

        await user.click(await screen.findByRole('button', { name: /^Editar$/i }));

        await user.click(await screen.findByRole('button', { name: /Salvar/i }));

        await waitFor(() => {
            expect(DolibarrService.updateIntervention).toHaveBeenCalledTimes(1);
            expect(toastMock.success).toHaveBeenCalledWith('Intervenção atualizada');
        });

        const [cfg, id] = vi.mocked(DolibarrService.updateIntervention).mock.calls[0];
        expect(cfg).toMatchObject({ apiKey: 'key' });
        expect(id).toBe('1');
        expect(onRefresh).toHaveBeenCalled();
        expect(alertSpy).not.toHaveBeenCalled();
        alertSpy.mockRestore();
    });

    it('shows notifyError (not native alert) when editing fails', async () => {
        const user = userEvent.setup();
        vi.mocked(DolibarrService.updateIntervention).mockRejectedValue(
            new Error('Erro de conexão') as any
        );
        const alertSpy = vi.spyOn(window, 'alert');

        renderList();

        await waitFor(() => screen.getByText('INT-001'));
        await user.click(screen.getByText('INT-001'));

        await user.click(await screen.findByRole('button', { name: /^Editar$/i }));
        await user.click(await screen.findByRole('button', { name: /Salvar/i }));

        await waitFor(() => {
            expect(toastMock.error).toHaveBeenCalledWith(
                'Salvar intervenção falhou.',
                expect.objectContaining({ description: expect.stringContaining('Erro de conexão') }),
            );
        });
        expect(alertSpy).not.toHaveBeenCalled();
        alertSpy.mockRestore();
    });

    // --- #610: Add line tests ---

    it('shows total duration from lines in the detail view', async () => {
        const user = userEvent.setup();
        const linesMock = [
            { id: 'l1', parent_id: '1', desc: 'Configuração', duration: 3600 }, // 1h
            { id: 'l2', parent_id: '1', desc: 'Instalação', duration: 1800 },   // 30m
        ];
        vi.mocked(useInterventionLines).mockReturnValue({ data: linesMock, refetch: refetchLinesMock } as any);
        vi.mocked(useInterventions).mockReturnValue({
            data: [{ ...interventionsMock[0], lines: linesMock }],
            refetch: vi.fn(),
        } as any);

        renderList();

        await waitFor(() => screen.getByText('INT-001'));
        await user.click(screen.getByText('INT-001'));

        await waitFor(() => {
            const durationEl = screen.getByTestId('total-duration');
            expect(durationEl).toHaveTextContent('1h 30m');
        });
    });

    it('adds an intervention line and shows toast.success', async () => {
        const user = userEvent.setup();
        vi.mocked(DolibarrService.addInterventionLine).mockResolvedValue({ id: 'new-line' } as any);
        const onRefresh = vi.fn();
        const alertSpy = vi.spyOn(window, 'alert');

        renderList({ onRefresh });

        await waitFor(() => screen.getByText('INT-001'));
        await user.click(screen.getByText('INT-001'));

        // Click "Adicionar item" button
        await user.click(await screen.findByRole('button', { name: /Adicionar item/i }));

        // Fill in the form
        const descTextarea = await screen.findByPlaceholderText(/Descreva o serviço realizado/i);
        await user.type(descTextarea, 'Reparo do sistema');

        const hoursInput = screen.getByLabelText('Horas');
        await user.clear(hoursInput);
        await user.type(hoursInput, '2');

        const minutesInput = screen.getByLabelText('Minutos');
        await user.clear(minutesInput);
        await user.type(minutesInput, '30');

        // Click Confirmar
        await user.click(screen.getByRole('button', { name: /Confirmar/i }));

        await waitFor(() => {
            expect(DolibarrService.addInterventionLine).toHaveBeenCalledTimes(1);
            expect(toastMock.success).toHaveBeenCalledWith('Item adicionado com sucesso');
        });

        const [cfg, intId, payload] = vi.mocked(DolibarrService.addInterventionLine).mock.calls[0];
        expect(cfg).toMatchObject({ apiKey: 'key' });
        expect(intId).toBe('1');
        expect(payload).toMatchObject({ desc: 'Reparo do sistema', duration: 9000 }); // 2h30m = 9000s
        expect(onRefresh).toHaveBeenCalled();
        expect(alertSpy).not.toHaveBeenCalled();
        alertSpy.mockRestore();
    });

    it('shows notifyError when adding a line fails', async () => {
        const user = userEvent.setup();
        vi.mocked(DolibarrService.addInterventionLine).mockRejectedValue(
            new Error('Falha ao adicionar') as any
        );
        const alertSpy = vi.spyOn(window, 'alert');

        renderList();

        await waitFor(() => screen.getByText('INT-001'));
        await user.click(screen.getByText('INT-001'));

        await user.click(await screen.findByRole('button', { name: /Adicionar item/i }));

        const descTextarea = await screen.findByPlaceholderText(/Descreva o serviço realizado/i);
        await user.type(descTextarea, 'Serviço X');

        const hoursInput = screen.getByLabelText('Horas');
        await user.clear(hoursInput);
        await user.type(hoursInput, '1');

        await user.click(screen.getByRole('button', { name: /Confirmar/i }));

        await waitFor(() => {
            expect(toastMock.error).toHaveBeenCalledWith(
                'Adicionar item falhou.',
                expect.objectContaining({ description: expect.stringContaining('Falha ao adicionar') }),
            );
        });
        expect(alertSpy).not.toHaveBeenCalled();
        alertSpy.mockRestore();
    });
});

// ---------------------------------------------------------------------------
// Suite: exibição de projeto (#551)
// ---------------------------------------------------------------------------
describe('InterventionList — exibição de projeto (#551)', () => {
    const projectsMock = [
        { id: '42', title: 'Projeto Alfa', ref: 'PROJ-042' },
    ];

    const interventionsWithProject = [
        {
            id: '1',
            ref: 'INT-001',
            socid: '10',
            project_id: '42',
            date: Math.floor(new Date('2024-06-01').getTime() / 1000),
            statut: '0',
            description: 'Com projeto',
            fk_user_author: '1',
            lines: [],
        },
        {
            id: '2',
            ref: 'INT-002',
            socid: '20',
            project_id: '',
            date: Math.floor(new Date('2024-06-10').getTime() / 1000),
            statut: '1',
            description: 'Sem projeto',
            fk_user_author: '2',
            lines: [],
        },
    ];

    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(useInterventions).mockReturnValue({
            data: interventionsWithProject,
            refetch: vi.fn(),
        } as any);
        vi.mocked(useCustomers).mockReturnValue({ data: customersMock } as any);
        vi.mocked(useProjects).mockReturnValue({ data: projectsMock } as any);
        vi.mocked(useInterventionLines).mockReturnValue({ data: [], refetch: vi.fn() } as any);
    });

    it('exibe o nome do projeto no card quando project_id está preenchido', () => {
        renderList();
        expect(screen.getByText('Projeto Alfa')).toBeInTheDocument();
    });

    it('exibe "Sem projeto" no card quando project_id está vazio', () => {
        renderList();
        // INT-002 não tem projeto — deve mostrar o rótulo de ausência
        const semProjetos = screen.getAllByText('Sem projeto');
        expect(semProjetos.length).toBeGreaterThanOrEqual(1);
    });

    it('clicar no projeto do card chama onNavigate sem abrir o detalhe', async () => {
        const user = userEvent.setup();
        const onNavigate = vi.fn();
        renderList({ onNavigate });

        // Clique no nome do projeto "Projeto Alfa" no card da lista
        const projectLink = screen.getByText('Projeto Alfa');
        await user.click(projectLink);

        // onNavigate chamado com ('projects', '42')
        expect(onNavigate).toHaveBeenCalledWith('projects', '42');

        // A intervenção não foi selecionada (detalhe não abriu)
        // O detalhe mostraria "Relatório de Serviço de Campo" no subtítulo
        expect(screen.queryByText('Relatório de Serviço de Campo')).not.toBeInTheDocument();
    });

    it('exibe "Sem projeto" no detalhe quando project_id está vazio', async () => {
        const user = userEvent.setup();
        renderList();

        // Seleciona INT-002 (sem projeto)
        await user.click(screen.getByText('INT-002'));

        // O detalhe deve mostrar rótulo "Projeto Vinculado" com o texto "Sem projeto"
        // Pode haver múltiplas ocorrências do texto (lista + detalhe), então usamos getAllByText
        const semProjetoElements = await screen.findAllByText('Sem projeto');
        expect(semProjetoElements.length).toBeGreaterThanOrEqual(1);
    });
});
