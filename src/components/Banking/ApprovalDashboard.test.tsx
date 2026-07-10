import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { toast } from 'sonner';
import { ApprovalDashboard } from './ApprovalDashboard';
import { useDolibarr } from '../../context/DolibarrContext';
import {
    getPendingActions,
    getActionHistory,
    getApprovalStats,
    approveAction,
    rejectAction,
    type PendingAction,
    type RiskLevel,
    type ApprovalStatus,
} from '../../services/approvalService';

// O componente consome o approvalService (axios + Bearer) e o contexto de auth (useDolibarr),
// não faz fetch cru — por isso o mock é no service, que é a fronteira real de rede.
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

interface ActionSeed {
    id: string;
    type: string;
    description: string;
    riskLevel: RiskLevel;
    requestedBy: string;
    requestedAt: string;
    status: ApprovalStatus;
    banco?: 'inter' | 'itau';
    payload: unknown;
}

const makeAction = (overrides: Partial<ActionSeed>): ActionSeed => ({
    id: 'a1',
    type: 'pagar_boleto',
    description: 'Ação pendente',
    riskLevel: 'medium',
    requestedBy: 'Sistema',
    requestedAt: '2026-06-15T12:00:00',
    status: 'pending',
    payload: {},
    ...overrides,
});

// 1 item bancário padrão + 1 item com type desconhecido (agent_tool) p/ cobrir generalização.
const bankingAction = makeAction({
    id: 'bk-1',
    type: 'pagar_boleto',
    banco: 'inter',
    description: 'Pagamento de boleto Premium',
    riskLevel: 'high',
    requestedBy: 'Sistema',
    payload: { linhaDigitavel: '0019000000', valor: 250.75 },
});

const agentToolAction = makeAction({
    id: 'agt-1',
    type: 'agent_tool',
    description: 'Rodar ferramenta do agente',
    riskLevel: 'medium',
    requestedBy: 'AgentBot',
    payload: { tool: 'search_web', target: 'web', query: 'clientes SP' },
});

const defaultPending: ActionSeed[] = [bankingAction, agentToolAction];

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
    mockedUseDolibarr.mockReturnValue({ config: { currentUser: { admin: 1 } }, previewTarget: null });
};

const expandCard = (description: string) => {
    fireEvent.click(screen.getByText(description));
};

const findPreContaining = (container: HTMLElement, needle: string): HTMLElement | undefined =>
    Array.from(container.querySelectorAll('pre')).find((p) => p.textContent?.includes(needle));

describe('ApprovalDashboard — render e clique (issue #1223)', () => {
    beforeEach(() => { vi.clearAllMocks(); resetDefaults(); });

    // 1) render → lista aparece com descrição, risco, solicitante, idade
    it('renderiza a lista com descrição, risco, solicitante e idade da ação', async () => {
        setPending(defaultPending);
        const { container } = render(<ApprovalDashboard />);

        await screen.findByText('Pagamento de boleto Premium');

        // descrição
        expect(screen.getByText('Pagamento de boleto Premium')).toBeInTheDocument();
        // risco (high -> "Alto Risco")
        expect(screen.getByText('Alto Risco')).toBeInTheDocument();
        // idade (data formatada pt-BR contém o ano)
        expect(container.textContent).toContain('2026');

        // solicitante (aparece ao expandir o card)
        expandCard('Pagamento de boleto Premium');
        expect(screen.getByText(/Solicitado por: Sistema/)).toBeInTheDocument();
    });

    // 2) admin clica 'Aprovar' -> approve é chamado -> linha some + toast de sucesso
    it('admin aprova: chama approveAction(id) e a linha some com toast de sucesso', async () => {
        mockedUseDolibarr.mockReturnValue({ config: { currentUser: { admin: 1 } }, previewTarget: null });
        // mount mostra o item; refetch pós-aprove retorna lista vazia (linha some)
        vi.mocked(getPendingActions).mockResolvedValue([]);
        vi.mocked(getPendingActions).mockResolvedValueOnce([bankingAction]);
        vi.mocked(getActionHistory).mockResolvedValue([]);
        vi.mocked(getApprovalStats).mockResolvedValue(null);
        vi.mocked(approveAction).mockResolvedValue({ success: true, status: 200 });

        render(<ApprovalDashboard />);
        await screen.findByText('Pagamento de boleto Premium');
        expandCard('Pagamento de boleto Premium');

        fireEvent.click(screen.getByRole('button', { name: /Aprovar e Executar/i }));

        // POST /:id/approve (fronteira de service) chamado com o id
        await waitFor(() => expect(vi.mocked(approveAction)).toHaveBeenCalledWith('bk-1'));
        // toast de sucesso
        await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Ação aprovada e executada com sucesso'));
        // linha some após o refetch
        await waitFor(() => expect(screen.queryByText('Pagamento de boleto Premium')).not.toBeInTheDocument());
    });

    // 3) admin clica 'Recusar' -> prompt de motivo -> reject chamado com {reason}
    it('admin recusa: abre prompt de motivo e chama rejectAction(id, reason)', async () => {
        mockedUseDolibarr.mockReturnValue({ config: { currentUser: { admin: 1 } }, previewTarget: null });
        setPending([bankingAction]);
        vi.mocked(rejectAction).mockResolvedValue({ success: true, status: 200 });
        const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue('valor incorreto');

        render(<ApprovalDashboard />);
        await screen.findByText('Pagamento de boleto Premium');
        expandCard('Pagamento de boleto Premium');

        fireEvent.click(screen.getByRole('button', { name: /Rejeitar/i }));

        // prompt de motivo aparece
        await waitFor(() => expect(promptSpy).toHaveBeenCalledWith('Motivo da rejeição:'));
        // POST /:id/reject chamado com o motivo no body (fronteira de service -> {reason})
        await waitFor(() => expect(vi.mocked(rejectAction)).toHaveBeenCalledWith('bk-1', 'valor incorreto'));
        await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Ação rejeitada'));

        promptSpy.mockRestore();
    });

    // 4) tipo desconhecido (agent_tool) renderiza sem crash (fallback de ícone/label + JSON colapsável)
    it('renderiza type "agent_tool" sem crashar, com label humanizada e JSON colapsável', async () => {
        setPending([agentToolAction]);
        const { container } = render(<ApprovalDashboard />);

        await screen.findByText('Rodar ferramenta do agente');

        // label humanizada derivada do type (fallback sem ícone conhecido)
        expect(screen.getByText(/Agent Tool/)).toBeInTheDocument();

        // expande e valida o JSON colapsável (detalhes técnicos) + payload cru em <pre>
        expandCard('Rodar ferramenta do agente');
        expect(screen.getByText('Detalhes técnicos')).toBeInTheDocument();
        expect(findPreContaining(container, 'search_web')).toBeTruthy();
    });

    // 5) não-admin NÃO vê botões aprovar/recusar
    it('não-admin vê a tela mas não vê os botões de aprovar/recusar', async () => {
        mockedUseDolibarr.mockReturnValue({ config: { currentUser: { admin: 0 } }, previewTarget: null });
        setPending(defaultPending);

        render(<ApprovalDashboard />);
        await screen.findByText('Pagamento de boleto Premium');
        expandCard('Pagamento de boleto Premium');

        expect(screen.getByText('Aprovações Pendentes')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Aprovar e Executar/i })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Rejeitar/i })).not.toBeInTheDocument();
    });

    // 6) backend retorna 403 -> toast de erro aparece, UI não quebra
    it('approve retornando 403 mostra toast de erro de permissão sem quebrar a UI', async () => {
        mockedUseDolibarr.mockReturnValue({ config: { currentUser: { admin: 1 } }, previewTarget: null });
        setPending([bankingAction]);
        vi.mocked(approveAction).mockResolvedValue({ success: false, status: 403, error: 'Forbidden' });

        render(<ApprovalDashboard />);
        await screen.findByText('Pagamento de boleto Premium');
        expandCard('Pagamento de boleto Premium');

        fireEvent.click(screen.getByRole('button', { name: /Aprovar e Executar/i }));

        await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Você não tem permissão para aprovar esta ação.'));
        // sem crash: botão Atualizar segue acessível
        expect(screen.getByRole('button', { name: /Atualizar/i })).toBeInTheDocument();
    });

    // Extra: os dados vêm do service autenticado, nunca de fetch cru.
    it('não usa fetch cru: pendentes vêm de getPendingActions (service)', async () => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch');
        setPending([bankingAction]);

        render(<ApprovalDashboard />);
        await screen.findByText('Pagamento de boleto Premium');

        expect(vi.mocked(getPendingActions)).toHaveBeenCalled();
        expect(fetchSpy).not.toHaveBeenCalled();
        fetchSpy.mockRestore();
    });
});
