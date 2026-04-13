import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RestrictedAccess } from '../../components/RestrictedAccess';
import { MemoryRouter } from 'react-router-dom';

describe('RestrictedAccess', () => {
    it('renders with MemoryRouter', () => {
        render(
            <MemoryRouter>
                <RestrictedAccess view="customers" />
            </MemoryRouter>
        );
        expect(document.body.textContent).toBeTruthy();
    });

    it('renders lock icon', () => {
        render(
            <MemoryRouter>
                <RestrictedAccess view="customers" />
            </MemoryRouter>
        );
        expect(document.querySelector('.text-red-500')).toBeTruthy();
    });

    it('renders access denied title', () => {
        render(
            <MemoryRouter>
                <RestrictedAccess view="customers" />
            </MemoryRouter>
        );
        expect(screen.getByText('Acesso Restrito')).toBeTruthy();
    });

    it('renders custom view name in message', () => {
        render(
            <MemoryRouter>
                <RestrictedAccess view="billing" />
            </MemoryRouter>
        );
        expect(screen.getByText(/billing/)).toBeTruthy();
    });

    it('renders back button', () => {
        render(
            <MemoryRouter>
                <RestrictedAccess view="settings" />
            </MemoryRouter>
        );
        expect(screen.getByText('Voltar ao Painel')).toBeTruthy();
    });

    it('renders different view names correctly', () => {
        const { rerender } = render(
            <MemoryRouter>
                <RestrictedAccess view="billing" />
            </MemoryRouter>
        );
        expect(screen.getByText(/billing/)).toBeTruthy();

        rerender(
            <MemoryRouter>
                <RestrictedAccess view="reports" />
            </MemoryRouter>
        );
        expect(screen.getByText(/reports/)).toBeTruthy();
    });
});
