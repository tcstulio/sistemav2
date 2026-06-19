import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import SupplierPaymentList from '../../components/SupplierPaymentList';

// --- Mock sonner ---
vi.mock('sonner', () => ({
    toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

// --- Mock DolibarrContext (config resolvido) ---
vi.mock('../../context/DolibarrContext', () => ({
    useDolibarr: vi.fn(() => ({ config: { baseUrl: 'http://test', apiKey: 'key' } })),
}));

// --- Mock dolibarr hooks ---
const payments = [
    { id: 1, ref: 'SUP-PAY-001', date_payment: '2024-01-01', amount: 1500, mode_id: 2 },
    { id: 2, ref: 'SUP-PAY-002', date_payment: '2024-01-02', amount: 500, mode_id: 4 },
];

vi.mock('../../hooks/dolibarr', () => ({
    useSupplierPayments: vi.fn(() => ({ data: payments })),
    useSupplierInvoices: vi.fn(() => ({ data: [] })),
    useSupplierPaymentInvoiceLinks: vi.fn(() => ({ data: [] })),
    useBankAccounts: vi.fn(() => ({ data: [] })),
    useUsers: vi.fn(() => ({ data: [] })),
}));

// Altura que o AutoSizer (mockado) vai reportar. Mutada por teste para simular os
// cenários de "altura resolvida" e "altura zero" (issue #651).
const { autosizer } = vi.hoisted(() => ({ autosizer: { height: 0 } }));

vi.mock('react-virtualized-auto-sizer', () => ({
    default: ({ children }: { children: (size: { height: number; width: number }) => React.ReactNode }) =>
        children({ height: autosizer.height, width: 800 }),
}));

vi.mock('react-window', () => ({
    FixedSizeList: ({
        children,
        itemCount,
        height,
    }: {
        children: (props: { index: number; style: React.CSSProperties }) => React.ReactNode;
        itemCount: number;
        height: number;
    }) => (
        <div data-testid="vw-list" data-height={String(height)}>
            {Array.from({ length: itemCount }, (_, index) =>
                children({ index, style: {} })
            )}
        </div>
    ),
}));

const renderComponent = (props?: Record<string, unknown>) =>
    render(
        <MemoryRouter>
            <SupplierPaymentList {...props} />
        </MemoryRouter>
    );

describe('SupplierPaymentList — virtualization fallback (#651)', () => {
    beforeEach(() => {
        autosizer.height = 0;
    });

    it('renders rows even when AutoSizer reports height = 0', () => {
        // Cenário-problema: AutoSizer não mede a altura (cadeia flex sem altura
        // resolvida) e reporta 0. A lista deve usar o fallback MIN_LIST_HEIGHT.
        autosizer.height = 0;

        renderComponent();

        // A altura passada para a lista virtualizada não pode ser 0 (fallback aplicado).
        const list = screen.getByTestId('vw-list');
        const resolvedHeight = Number(list.getAttribute('data-height'));
        expect(resolvedHeight).toBeGreaterThan(0);

        // As linhas continuam visíveis/clicáveis mesmo com AutoSizer retornando 0.
        expect(screen.getByText('SUP-PAY-001')).toBeInTheDocument();
        expect(screen.getByText('SUP-PAY-002')).toBeInTheDocument();
    });

    it('passes through a real height unchanged when AutoSizer measures correctly', () => {
        autosizer.height = 600;

        renderComponent();

        const list = screen.getByTestId('vw-list');
        expect(list.getAttribute('data-height')).toBe('600');
    });
});
