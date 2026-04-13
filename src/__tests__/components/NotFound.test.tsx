import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NotFound } from '../../components/NotFound';
import { MemoryRouter } from 'react-router-dom';

describe('NotFound', () => {
    it('renders with MemoryRouter', () => {
        render(
            <MemoryRouter>
                <NotFound />
            </MemoryRouter>
        );
        expect(document.body.textContent).toBeTruthy();
    });

    it('renders default title', () => {
        render(
            <MemoryRouter>
                <NotFound />
            </MemoryRouter>
        );
        expect(screen.getByText('Página não encontrada')).toBeTruthy();
    });

    it('renders default message', () => {
        render(
            <MemoryRouter>
                <NotFound />
            </MemoryRouter>
        );
        expect(screen.getByText(/A página que você está procurando/)).toBeTruthy();
    });

    it('renders custom title', () => {
        render(
            <MemoryRouter>
                <NotFound title="Custom Not Found" />
            </MemoryRouter>
        );
        expect(screen.getByText('Custom Not Found')).toBeTruthy();
    });

    it('renders custom message', () => {
        render(
            <MemoryRouter>
                <NotFound message="Custom message" />
            </MemoryRouter>
        );
        expect(screen.getByText('Custom message')).toBeTruthy();
    });

    it('renders 404 text', () => {
        render(
            <MemoryRouter>
                <NotFound />
            </MemoryRouter>
        );
        expect(screen.getByText('404')).toBeTruthy();
    });

    it('renders navigation buttons', () => {
        render(
            <MemoryRouter>
                <NotFound />
            </MemoryRouter>
        );
        expect(screen.getByText('Voltar')).toBeTruthy();
        expect(screen.getByText('Ir para o início')).toBeTruthy();
    });

    it('renders popular pages links', () => {
        render(
            <MemoryRouter>
                <NotFound />
            </MemoryRouter>
        );
        expect(screen.getByText('Dashboard')).toBeTruthy();
        expect(screen.getByText('Clientes')).toBeTruthy();
    });

    it('renders popular pages even when showSearch is false (showSearch prop is unused)', () => {
        render(
            <MemoryRouter>
                <NotFound showSearch={false} />
            </MemoryRouter>
        );
        expect(screen.getByText('Dashboard')).toBeTruthy();
    });
});