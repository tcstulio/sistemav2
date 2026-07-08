import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ApprovalDashboard } from '../../components/Banking/ApprovalDashboard';

// --- helpers ---

const okJson = (body: unknown) =>
    Promise.resolve({
        ok: true,
        status: 200,
        json: async () => body,
        text: async () => '',
        headers: new Headers(),
        clone() { return this; },
    });

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
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
        if (typeof url === 'string' && url.includes('/pending')) return okJson({ actions });
        if (typeof url === 'string' && url.includes('/history')) return okJson({ history: [] });
        if (typeof url === 'string' && url.includes('/stats')) {
            return okJson({ stats: { pending: actions.length, approved: 0, rejected: 0, executed: 0, failed: 0 } });
        }
        return okJson({});
    });
}

const expandCard = (description: string) => {
    fireEvent.click(screen.getByText(description));
};

const findPreContaining = (container: HTMLElement, needle: string): HTMLElement | undefined =>
    Array.from(container.querySelectorAll('pre')).find((p) => p.textContent?.includes(needle));

describe('ApprovalDashboard — tipos dinâmicos e payload desconhecido (#1220)', () => {
    beforeEach(() => { vi.clearAllMocks(); });

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

        // label específico (igual ao comportamento anterior)
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
