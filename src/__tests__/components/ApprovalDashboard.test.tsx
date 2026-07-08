import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { toast } from 'sonner';
import { ApprovalDashboard } from '../../components/Banking/ApprovalDashboard';
import { useDolibarr } from '../../context/DolibarrContext';
import {
    getPendingActions,
    getActionHistory,
    getApprovalStats,
    approveAction,
    rejectAction,
    type PendingAction,
} from '../../services/approvalService';

// O componente não faz mais fetch cru — usa o service (axios+Bearer) e o contexto de auth.
vi.mock('../../services/approvalService', () => ({
    getPendingActions: vi.fn(),
    getActionHistory: vi.fn(),
    getApprovalStats: vi.fn(),
    approveAction: vi.fn(),
    rejectAction: vi.fn(),
}));

vi.mock('../../context/DolibarrContext', () => ({
    useDolibarr: vi.fn(),
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const mockedUseDolibarr = useDolibarr as unknown as ReturnType<typeof vi.fn>;

// --- helpers ---

interface ActionSeed {
    id: string;
    type: string;
    description: string;
    riskLevel?: string;
    requestedBy?: string;
    requestedAt?: string;
    status?: string;
    banco?: string;
    payload?: unknown;
}

const makeAction = (overrides: Partial<ActionSeed>): ActionSeed => ({
    id: 'a1',
    type: 'agent_tool',
    description: 'Ação do agente',
    riskLevel: 'medium',
    requestedBy: 'bot',
    requestedAt: new Date('2026-01-01T10:00:00Z').toISOString(),
    status: 'pending',
    payload: {},
    ...overrides,
});

function setPending(actions: ActionSeed[]) {
    vi.mocked(getPendingActions).mockResolvedValue(actions as unknown as PendingAction[]);
    vi.mocked(getActionHistory).mockResolvedValue([]);
    vi.mocked(getApprovalStats).mockResolvedValue({
        pending: actions.length, approved: 0, rejected: 0, executed: 0, failed: 0,
    });
}

const resetDefaults = () => {
    vi.mocked(getPendingActions).mockResolvedValue([]);
    vi.mocked(getActionHistory).mockResolvedValue([]);
    vi.mocked(getApprovalStats).mockResolvedValue(null);
    vi.mocked(approveAction).mockResolvedValue({ success: false, status: 0 });
    vi.mocked(rejectAction).mockResolvedValue({ success: false, status: 0 });
    // admin por padrão (preserva o comportamento anterior de mostrar os botões)
    mockedUseDolibarr.mockReturnValue({ config: { currentUser: { admin: 1 } }, previewTarget: null });
};

const expandCard = (description: string) => {
    fireEvent.click(screen.getByText(description));
};

const findPreContaining = (container: HTMLElement, needle: string): HTMLElement | undefined =>
    Array.from(container.querySelectorAll('pre')).find((p) => p.textContent?.includes(needle));

describe('ApprovalDashboard — tipos dinâmicos e payload desconhecido (#1220)', () => {
    beforeEach(() => { vi.clearAllMocks(); resetDefaults(); });

    it('renderiza item type "agent_tool" (string arbitrária) sem erro', async () => {
        setPending([makeAction({ type: 'agent_tool', description: 'Executar tool', payload: { tool: 'search_web' } })]);
        render(<ApprovalDashboard />);
        expect(await screen.findByText('Executar tool')).toBeInTheDocument();
        // label humanizado derivado do type
        expect(screen.getByText(/Agent Tool/)).toBeInTheDocument();
    });

    it('mostra campos semânticos + JSON colapsável em <pre> para payload desconhecido', async () => {
        setPending([makeAction({
            type: 'agent_tool',
            description: 'Executar ação X',
            payload: { description: 'Buscar cliente', value: 1500.5, tool: 'search', extra: { foo: 'bar' } },
        })]);
        const { container } = render(<ApprovalDashboard />);
        await screen.findByText('Executar ação X');
        expandCard('Executar ação X');

        // campos semânticos legíveis
        expect(screen.getByText('Buscar cliente')).toBeInTheDocument();
        // valor formatado como moeda (regex tolera NBSP/espaço do Intl pt-BR)
        expect(screen.getByText(/R\$\s*1\.500,50/)).toBeInTheDocument();

        // bloco colapsável de detalhes técnicos
        expect(screen.getByText('Detalhes técnicos')).toBeInTheDocument();

        // JSON completo do payload em <pre>
        const jsonPre = findPreContaining(container, '"foo"');
        expect(jsonPre).toBeTruthy();
    });

    it('mantém renderização dos tipos bancários conhecidos (pagar_boleto) sem regressão', async () => {
        setPending([makeAction({
            type: 'pagar_boleto',
            banco: 'inter',
            description: 'Boleto Premium',
            payload: { linhaDigitavel: '0019000000' },
        })]);
        const { container } = render(<ApprovalDashboard />);
        await screen.findByText('Boleto Premium');
        expandCard('Boleto Premium');

        // label específica (igual ao comportamento anterior)
        expect(screen.getByText(/Pagamento de Boleto/)).toBeInTheDocument();
        // bloco "Detalhes:" (formato legado), NÃO o bloco de "Detalhes técnicos"
        expect(screen.getByText('Detalhes:')).toBeInTheDocument();
        expect(screen.queryByText('Detalhes técnicos')).not.toBeInTheDocument();
        // payload cru serializado em <pre>
        expect(findPreContaining(container, 'linhaDigitavel')).toBeTruthy();
    });

    it('NÃO usa dangerouslySetInnerHTML: payload com HTML é escapado como texto', async () => {
        const evil = '<img src=x onerror="alert(1)">';
        setPending([makeAction({
            type: 'agent_tool',
            description: 'Payload malicioso',
            payload: { description: evil },
        })]);
        const { container } = render(<ApprovalDashboard />);
        await screen.findByText('Payload malicioso');
        expandCard('Payload malicioso');

        // nenhum elemento <img> injetado (renderização escapada)
        expect(container.querySelector('img')).toBeNull();
        // o conteúdo aparece como texto literal
        expect(container.textContent).toContain(evil);
    });

    it('renderiza bloco de detalhes mesmo sem campos semânticos conhecidos', async () => {
        setPending([makeAction({
            type: 'custom_op',
            description: 'Operação custom',
            payload: { randomField: 42 },
        })]);
        render(<ApprovalDashboard />);
        await screen.findByText('Operação custom');
        expandCard('Operação custom');

        expect(screen.getByText('Detalhes técnicos')).toBeInTheDocument();
        expect(screen.getByText(/Custom Op/)).toBeInTheDocument();
    });
});

describe('ApprovalDashboard — auth do app, gate de admin e feedback 403 (#1221)', () => {
    beforeEach(() => { vi.clearAllMocks(); resetDefaults(); });

    it('admin vê os botões Aprovar/Rejeitar ao expandir', async () => {
        mockedUseDolibarr.mockReturnValue({ config: { currentUser: { admin: 1 } }, previewTarget: null });
        setPending([makeAction({ description: 'Ação pendente admin' })]);
        render(<ApprovalDashboard />);
        await screen.findByText('Ação pendente admin');
        expandCard('Ação pendente admin');

        expect(await screen.findByRole('button', { name: /Aprovar e Executar/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Rejeitar/i })).toBeInTheDocument();
    });

    it('trata admin como string "1" como admin (guard defensivo #535)', async () => {
        mockedUseDolibarr.mockReturnValue({ config: { currentUser: { admin: '1' } }, previewTarget: null });
        setPending([makeAction({ description: 'Ação admin string' })]);
        render(<ApprovalDashboard />);
        await screen.findByText('Ação admin string');
        expandCard('Ação admin string');

        expect(await screen.findByRole('button', { name: /Aprovar e Executar/i })).toBeInTheDocument();
    });

    it('não-admin (admin:0) vê a tela mas NÃO vê botões de aprovar/recusar', async () => {
        mockedUseDolibarr.mockReturnValue({ config: { currentUser: { admin: 0 } }, previewTarget: null });
        setPending([makeAction({ description: 'Ação pendente comum' })]);
        render(<ApprovalDashboard />);
        await screen.findByText('Ação pendente comum');
        expandCard('Ação pendente comum');

        // a tela segue usável (header + atualizar), mas sem os botões admin-only
        expect(screen.getByText('Aprovações Pendentes')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Aprovar e Executar/i })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Rejeitar/i })).not.toBeInTheDocument();
    });

    it('modo preview (previewTarget definido) esconde os botões mesmo para um admin', async () => {
        mockedUseDolibarr.mockReturnValue({
            config: { currentUser: { admin: 1 } },
            previewTarget: { id: 'u9', name: 'Outro' },
        });
        setPending([makeAction({ description: 'Ação em preview' })]);
        render(<ApprovalDashboard />);
        await screen.findByText('Ação em preview');
        expandCard('Ação em preview');

        expect(screen.queryByRole('button', { name: /Aprovar e Executar/i })).not.toBeInTheDocument();
    });

    it('approve com 403 mostra toast de permissão e mantém a UI usável', async () => {
        mockedUseDolibarr.mockReturnValue({ config: { currentUser: { admin: 1 } }, previewTarget: null });
        setPending([makeAction({ id: 'a1', description: 'Ação 403' })]);
        vi.mocked(approveAction).mockResolvedValue({ success: false, status: 403, error: 'Forbidden' });
        render(<ApprovalDashboard />);
        await screen.findByText('Ação 403');
        expandCard('Ação 403');

        fireEvent.click(screen.getByRole('button', { name: /Aprovar e Executar/i }));

        await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Você não tem permissão para aprovar esta ação.'));
        // sem crash: botão Atualizar segue acessível
        expect(screen.getByRole('button', { name: /Atualizar/i })).toBeInTheDocument();
    });

    it('approve com erro de EXECUÇÃO retornado pela API exibe a mensagem (não engole)', async () => {
        mockedUseDolibarr.mockReturnValue({ config: { currentUser: { admin: 1 } }, previewTarget: null });
        setPending([makeAction({ id: 'a1', description: 'Ação que falha ao executar' })]);
        // backend executa e pode falhar (approvalService.ts:262) -> 400 com {success:false,error}
        vi.mocked(approveAction).mockResolvedValue({ success: false, status: 400, error: 'Saldo insuficiente' });
        render(<ApprovalDashboard />);
        await screen.findByText('Ação que falha ao executar');
        expandCard('Ação que falha ao executar');

        fireEvent.click(screen.getByRole('button', { name: /Aprovar e Executar/i }));

        await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Erro: Saldo insuficiente'));
    });

    it('approve com sucesso mostra toast de sucesso', async () => {
        mockedUseDolibarr.mockReturnValue({ config: { currentUser: { admin: 1 } }, previewTarget: null });
        setPending([makeAction({ id: 'a1', description: 'Ação ok' })]);
        vi.mocked(approveAction).mockResolvedValue({ success: true, status: 200 });
        render(<ApprovalDashboard />);
        await screen.findByText('Ação ok');
        expandCard('Ação ok');

        fireEvent.click(screen.getByRole('button', { name: /Aprovar e Executar/i }));

        await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Ação aprovada e executada com sucesso'));
    });

    it('reject abre prompt pedindo motivo e envia {reason} no body', async () => {
        mockedUseDolibarr.mockReturnValue({ config: { currentUser: { admin: 1 } }, previewTarget: null });
        setPending([makeAction({ id: 'a1', description: 'Ação p/ rejeitar' })]);
        vi.mocked(rejectAction).mockResolvedValue({ success: true, status: 200 });
        const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue('valor incorreto');

        render(<ApprovalDashboard />);
        await screen.findByText('Ação p/ rejeitar');
        expandCard('Ação p/ rejeitar');
        fireEvent.click(screen.getByRole('button', { name: /Rejeitar/i }));

        await waitFor(() => expect(promptSpy).toHaveBeenCalledWith('Motivo da rejeição:'));
        expect(vi.mocked(rejectAction)).toHaveBeenCalledWith('a1', 'valor incorreto');
        await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Ação rejeitada'));

        promptSpy.mockRestore();
    });

    it('reject cancelado (prompt retorna null) não chama a API', async () => {
        mockedUseDolibarr.mockReturnValue({ config: { currentUser: { admin: 1 } }, previewTarget: null });
        setPending([makeAction({ id: 'a1', description: 'Ação cancelada' })]);
        const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue(null);

        render(<ApprovalDashboard />);
        await screen.findByText('Ação cancelada');
        expandCard('Ação cancelada');
        fireEvent.click(screen.getByRole('button', { name: /Rejeitar/i }));

        expect(vi.mocked(rejectAction)).not.toHaveBeenCalled();
        promptSpy.mockRestore();
    });

    it('reject com 403 mostra toast de permissão', async () => {
        mockedUseDolibarr.mockReturnValue({ config: { currentUser: { admin: 1 } }, previewTarget: null });
        setPending([makeAction({ id: 'a1', description: 'Ação rej 403' })]);
        vi.mocked(rejectAction).mockResolvedValue({ success: false, status: 403 });
        const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue('motivo');

        render(<ApprovalDashboard />);
        await screen.findByText('Ação rej 403');
        expandCard('Ação rej 403');
        fireEvent.click(screen.getByRole('button', { name: /Rejeitar/i }));

        await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Você não tem permissão para rejeitar esta ação.'));
        promptSpy.mockRestore();
    });

    it('não usa fetch cru: dados vêm do service autenticado (getPendingActions)', async () => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch');
        setPending([makeAction({ description: 'Ação via service' })]);
        render(<ApprovalDashboard />);
        await screen.findByText('Ação via service');

        expect(vi.mocked(getPendingActions)).toHaveBeenCalled();
        expect(fetchSpy).not.toHaveBeenCalled();
        fetchSpy.mockRestore();
    });
});
