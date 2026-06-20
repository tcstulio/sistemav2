import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReactNode } from 'react';
import { render } from '@testing-library/react';
import SalaryPaymentList from '../../components/HR/SalaryPaymentList';
import { SalaryPayment } from '../../types';
import { formatCurrency } from '../../utils/formatUtils';

// Force a fixed viewport so react-window renders rows in jsdom
vi.mock('react-virtualized-auto-sizer', () => ({
    __esModule: true,
    default: ({ children }: { children: (size: { height: number; width: number }) => ReactNode }) =>
        children({ height: 600, width: 800 }),
}));

const mockConfig = {
    apiUrl: 'http://test',
    apiKey: 'key',
    themeColor: 'indigo',
    darkMode: false,
    apiLimit: 0,
};

vi.mock('../../context/DolibarrContext', () => ({
    useDolibarr: () => ({ config: mockConfig }),
}));

const payments: SalaryPayment[] = [
    { id: 'sp1', ref: 'SAL001', fk_user: '1', date_payment: 1700000000, amount: 2000, salary: 2500, fk_bank: 'b1' },
    { id: 'sp2', ref: 'SAL002', fk_user: '1', date_payment: 1700000001, amount: 1000, salary: 2500, fk_bank: 'b1' },
];

vi.mock('../../hooks/dolibarr', () => ({
    useSalaryPayments: () => ({ data: payments }),
    useUsers: () => ({
        data: [{ id: '1', login: 'u', firstname: 'José', lastname: 'Silva', email: 'j@t.com', statut: '1' }],
    }),
    useBankAccounts: () => ({ data: [] }),
}));

describe('SalaryPaymentList — Currency standardization (#642)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders total paid in BRL via formatCurrency (no $ prefix)', () => {
        const { container } = render(<SalaryPaymentList />);

        // totalPaid = 2000 + 1000 = 3000
        const formatted = formatCurrency(3000);
        const matches = Array.from(container.querySelectorAll('*')).filter(
            (el) => el.textContent === formatted
        );
        expect(matches.length).toBeGreaterThanOrEqual(1);
        expect(container.textContent).toContain('R$');
    });

    it('renders each payment amount in BRL via formatCurrency in the list (no $ prefix)', () => {
        const { container } = render(<SalaryPaymentList />);

        // Row renders: -{formatCurrency(amount)}
        expect(container.textContent).toContain(`-${formatCurrency(2000)}`);
        expect(container.textContent).toContain(`-${formatCurrency(1000)}`);
    });
});
