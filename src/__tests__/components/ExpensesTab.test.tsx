import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { ExpensesTab } from '../../components/HR/tabs/ExpensesTab';
import { ExpenseReport, DolibarrUser } from '../../types';
import { formatCurrency } from '../../utils/formatUtils';

vi.mock('../../context/DolibarrContext', () => ({
    useDolibarr: vi.fn(() => ({
        canAccess: () => true,
        canDo: () => true,
    })),
}));

const user: DolibarrUser = {
    id: '1',
    login: 'jose.silva',
    lastname: 'Silva',
    firstname: 'José',
    email: 'jose@test.com',
    statut: '1',
};

const expense: ExpenseReport = {
    id: 'e1',
    ref: 'EXP001',
    fk_user_author: '1',
    date_debut: 1700000000,
    date_fin: 1700000000,
    total_ttc: 1234.56,
    statut: '1',
    note_public: 'Almoço de trabalho',
};

const baseProps = {
    users: [user],
    searchTerm: '',
    sortConfig: { key: 'default', direction: 'asc' as const },
    displayLimit: 10,
    onSelectExpense: vi.fn(),
    onOpenScanner: vi.fn(),
};

describe('ExpensesTab — Currency standardization (#642)', () => {
    it('renders expense total in BRL via formatCurrency (no $ prefix)', () => {
        const { container } = render(<ExpensesTab {...baseProps} expenseReports={[expense]} />);

        const formatted = formatCurrency(1234.56);
        const matches = Array.from(container.querySelectorAll('*')).filter(
            (el) => el.textContent === formatted
        );
        expect(matches.length).toBeGreaterThanOrEqual(1);
        expect(container.textContent).toContain('R$');
        // No raw USD-style literal should leak
        expect(container.textContent).not.toContain('$1,234.56');
    });
});
