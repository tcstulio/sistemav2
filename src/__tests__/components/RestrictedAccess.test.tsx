import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { RestrictedAccess } from '../../components/RestrictedAccess';

const mockNavigate = vi.fn();

vi.mock('react-router-dom', async () => {
    const actual = await vi.importActual('react-router-dom');
    return {
        ...actual,
        useNavigate: () => mockNavigate,
    };
});

describe('RestrictedAccess', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders access denied message with view name', () => {
        render(
            <MemoryRouter>
                <RestrictedAccess view="Projects" />
            </MemoryRouter>
        );
        expect(screen.getByText('Acesso Restrito')).toBeInTheDocument();
        expect(screen.getByText(/Projects/)).toBeInTheDocument();
    });

    it('renders with error message about the restricted view', () => {
        render(
            <MemoryRouter>
                <RestrictedAccess view="Sales" />
            </MemoryRouter>
        );
        expect(screen.getByText(/módulo/i)).toBeInTheDocument();
    });

    it('renders Voltar ao Painel button', () => {
        render(
            <MemoryRouter>
                <RestrictedAccess view="HR" />
            </MemoryRouter>
        );
        expect(screen.getByText('Voltar ao Painel')).toBeInTheDocument();
    });

    it('navigates to home when button is clicked', () => {
        render(
            <MemoryRouter>
                <RestrictedAccess view="Finance" />
            </MemoryRouter>
        );
        fireEvent.click(screen.getByText('Voltar ao Painel'));
        expect(mockNavigate).toHaveBeenCalledWith('/');
    });
});