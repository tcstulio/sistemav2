import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { NotFound } from '../../components/NotFound';

const mockNavigate = vi.fn();

vi.mock('react-router-dom', async () => {
    const actual = await vi.importActual('react-router-dom');
    return {
        ...actual,
        useNavigate: () => mockNavigate,
    };
});

describe('NotFound', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders default title and message', () => {
        render(
            <MemoryRouter>
                <NotFound />
            </MemoryRouter>
        );
        expect(screen.getByText('Página não encontrada')).toBeInTheDocument();
        expect(screen.getByText('A página que você está procurando não existe ou foi movida.')).toBeInTheDocument();
    });

    it('renders custom title and message', () => {
        render(
            <MemoryRouter>
                <NotFound title="Custom Title" message="Custom Message" />
            </MemoryRouter>
        );
        expect(screen.getByText('Custom Title')).toBeInTheDocument();
        expect(screen.getByText('Custom Message')).toBeInTheDocument();
    });

    it('renders 404 text', () => {
        render(
            <MemoryRouter>
                <NotFound />
            </MemoryRouter>
        );
        expect(screen.getByText('404')).toBeInTheDocument();
    });

    it('renders Voltar button', () => {
        render(
            <MemoryRouter>
                <NotFound />
            </MemoryRouter>
        );
        expect(screen.getByText('Voltar')).toBeInTheDocument();
    });

    it('renders Ir para o início button', () => {
        render(
            <MemoryRouter>
                <NotFound />
            </MemoryRouter>
        );
        expect(screen.getByText('Ir para o início')).toBeInTheDocument();
    });

    it('navigates to home when Ir para o início is clicked', () => {
        render(
            <MemoryRouter>
                <NotFound />
            </MemoryRouter>
        );
        fireEvent.click(screen.getByText('Ir para o início'));
        expect(mockNavigate).toHaveBeenCalledWith('/');
    });

    it('renders popular pages section', () => {
        render(
            <MemoryRouter>
                <NotFound />
            </MemoryRouter>
        );
        expect(screen.getByText('Páginas populares:')).toBeInTheDocument();
        expect(screen.getByText('Dashboard')).toBeInTheDocument();
        expect(screen.getByText('Clientes')).toBeInTheDocument();
    });

    it('renders popular pages buttons that navigate', () => {
        render(
            <MemoryRouter>
                <NotFound />
            </MemoryRouter>
        );
        const dashboardButton = screen.getByText('Dashboard');
        fireEvent.click(dashboardButton);
        expect(mockNavigate).toHaveBeenCalledWith('/');
    });
});