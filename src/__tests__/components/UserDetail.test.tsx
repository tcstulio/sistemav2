import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import { UserDetail } from '../../components/HR/UserDetail';
import { DolibarrUser, ExpenseReport, DolibarrConfig } from '../../types';
import { formatCurrency } from '../../utils/formatUtils';

vi.mock('../../context/DolibarrContext', () => ({
    useDolibarr: vi.fn(() => ({
        currentUser: { id: '99', admin: 1 },
        canAccess: () => true,
        canDo: () => true,
    })),
}));

vi.mock('../../hooks/dolibarr', () => ({
    useGroups: () => ({ data: [] }),
    useGroupUsers: () => ({ data: [], refetch: vi.fn() }),
}));

vi.mock('../../hooks/useConfirm', () => ({
    useConfirm: () => vi.fn(() => Promise.resolve(true)),
}));

// Stub heavy child components that are not relevant to currency formatting
vi.mock('../../components/HR/PermissionManager', () => ({
    PermissionManager: () => null,
}));
vi.mock('../../components/admin/UserPermissionsEditor', () => ({
    UserPermissionsEditor: () => null,
}));
vi.mock('../../components/HR/modals/ExpenseDetailModal', () => ({
    ExpenseDetailModal: () => null,
}));

const config: DolibarrConfig = {
    apiUrl: 'http://t',
    apiKey: 'k',
    themeColor: 'indigo',
    darkMode: false,
    apiLimit: 0,
};

const user = {
    id: '1',
    login: 'jose',
    firstname: 'José',
    lastname: 'Silva',
    email: 'j@t.com',
    statut: '1',
    job: 'Desenvolvedor',
    salary: 5432.10,
} as unknown as DolibarrUser;

const expense: ExpenseReport = {
    id: 'e1',
    ref: 'EXP1',
    fk_user_author: '1',
    date_debut: 1700000000,
    date_fin: 1700000000,
    total_ttc: 987.65,
    statut: '1',
};

const baseProps = {
    user,
    userTasks: [],
    userExpenses: [],
    userLeaves: [],
    subordinates: [],
    projects: [],
    config,
    onClose: vi.fn(),
    onEditUser: vi.fn(),
    onDeleteUser: vi.fn(),
};

describe('UserDetail — Currency standardization (#642)', () => {
    it('renders salary in BRL via formatCurrency on overview (no $ prefix)', () => {
        const { container } = render(<UserDetail {...baseProps} />);

        const formatted = formatCurrency(5432.10);
        const matches = Array.from(container.querySelectorAll('*')).filter(
            (el) => el.textContent === formatted
        );
        expect(matches.length).toBeGreaterThanOrEqual(1);
        expect(container.textContent).toContain('R$');
    });

    it('renders expense total in BRL via formatCurrency on expenses tab (no $ prefix)', () => {
        const { container } = render(<UserDetail {...baseProps} userExpenses={[expense]} />);

        fireEvent.click(screen.getByText('Despesas'));

        const formatted = formatCurrency(987.65);
        const matches = Array.from(container.querySelectorAll('*')).filter(
            (el) => el.textContent === formatted
        );
        expect(matches.length).toBeGreaterThanOrEqual(1);
        expect(container.textContent).toContain('R$');
    });
});

describe('UserDetail — Excluir Usuário (#1088)', () => {
    it('renders the delete button when onDeleteUser is provided', () => {
        render(<UserDetail {...baseProps} />);
        expect(screen.getByTitle('Excluir Usuário')).toBeInTheDocument();
    });

    it('hides the delete button (and the no-op confirm flow) when there is no backend handler', () => {
        const { onDeleteUser, ...propsWithoutDelete } = baseProps;
        render(<UserDetail {...(propsWithoutDelete as any)} />);
        expect(screen.queryByTitle('Excluir Usuário')).not.toBeInTheDocument();
    });
});
