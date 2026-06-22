import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CustomerList } from '../../components/CustomerList';
import type { ThirdParty } from '../../types';

vi.mock('sonner', () => ({
    toast: {
        success: vi.fn(),
        error: vi.fn(),
        info: vi.fn(),
    },
}));

vi.mock('../../context/DolibarrContext', () => ({
    useDolibarr: vi.fn(() => ({
        config: { apiUrl: 'https://test.dolibarr.com/api', apiKey: 'test-key' },
        refreshData: vi.fn(),
    })),
}));

vi.mock('../../hooks/dolibarr', () => ({
    useCustomers: vi.fn(() => ({
        data: [
            { id: '1', name: 'ACME Ltda', client: '1', status: '1', fournisseur: '0', email: 'acme@example.com', town: 'São Paulo' },
            { id: '2', name: 'Prospecto XYZ', client: '2', status: '1', fournisseur: '0', email: 'xyz@example.com', town: 'Rio de Janeiro' },
        ] as ThirdParty[],
        isLoading: false,
        refetch: vi.fn(),
    })),
    useInvoices: vi.fn(() => ({ data: [] })),
    useProposals: vi.fn(() => ({ data: [] })),
    useOrders: vi.fn(() => ({ data: [] })),
    useProjects: vi.fn(() => ({ data: [] })),
    useEvents: vi.fn(() => ({ data: [] })),
    useTickets: vi.fn(() => ({ data: [] })),
    useShipments: vi.fn(() => ({ data: [] })),
    useContacts: vi.fn(() => ({ data: [] })),
}));

vi.mock('../../hooks/usePrefill', () => ({
    usePrefill: vi.fn(() => null),
}));

vi.mock('../../hooks/useMutations', () => ({
    useCustomerMutations: vi.fn(() => ({
        createCustomer: { mutateAsync: vi.fn() },
        updateCustomer: { mutateAsync: vi.fn() },
    })),
}));

vi.mock('../../services/aiService', () => ({
    AiService: {
        draftMessage: vi.fn(),
        analyzeCustomerSentiment: vi.fn(),
        extractCustomerInfo: vi.fn(),
        logCorrection: vi.fn(),
    },
}));

vi.mock('react-window', () => ({
    FixedSizeList: ({ children, itemCount }: any) => (
        <div data-testid="virtual-list">
            {Array.from({ length: itemCount }, (_, index) =>
                children({ index, style: {} })
            )}
        </div>
    ),
}));

vi.mock('react-virtualized-auto-sizer', () => ({
    __esModule: true,
    default: ({ children }: any) => <>{children({ height: 600, width: 400 })}</>,
}));

describe('CustomerList', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renderiza o rótulo "Prospecto" para cliente com client=2', () => {
        render(<CustomerList />);
        // Badge na linha do cliente com client='2' e aba de filtro ambos têm "Prospecto"
        const prospectElements = screen.getAllByText('Prospecto');
        expect(prospectElements.length).toBeGreaterThan(0);
        // Garante que a badge do cliente com client='2' exibe "Prospecto"
        const badge = prospectElements.find(el => el.tagName.toLowerCase() === 'span');
        expect(badge).toBeTruthy();
        // Garante que "Prospect" sem "o" não aparece isolado
        const prospectMatches = screen.queryAllByText(/^Prospect$/);
        expect(prospectMatches).toHaveLength(0);
    });

    it('filtra corretamente ao clicar na aba "Prospecto"', async () => {
        const user = userEvent.setup();
        render(<CustomerList />);

        // Inicialmente ambos aparecem
        expect(screen.getByText('ACME Ltda')).toBeInTheDocument();
        expect(screen.getByText('Prospecto XYZ')).toBeInTheDocument();

        // Clica na aba de filtro "Prospecto" (o Tab com value="prospect")
        // Há múltiplos elementos com "Prospecto" (badge + aba), pegar o botão
        const tabButtons = screen.getAllByRole('button', { name: 'Prospecto' });
        // O tab de filtro é um button com texto exato "Prospecto"
        const filterTab = tabButtons.find(btn => btn.closest('[class*="flex gap"]'));
        await user.click(filterTab ?? tabButtons[0]);

        // Após filtrar, apenas o prospecto deve aparecer
        await waitFor(() => {
            expect(screen.queryByText('ACME Ltda')).not.toBeInTheDocument();
        });
        expect(screen.getByText('Prospecto XYZ')).toBeInTheDocument();
    });

    it('container das ações do cabeçalho possui flex-wrap', () => {
        const { container } = render(<CustomerList />);
        // O div que envolve ListToolbar + botão "Novo" deve ter flex-wrap
        const actionsDiv = container.querySelector('.flex.items-center.flex-wrap');
        expect(actionsDiv).not.toBeNull();
        expect(actionsDiv?.className).toContain('flex-wrap');
    });
});
