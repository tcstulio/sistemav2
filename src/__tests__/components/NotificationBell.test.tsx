import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NotificationBell } from '../../components/NotificationBell';

describe('NotificationBell (#1004)', () => {
    const mockOnClick = vi.fn();

    beforeEach(() => vi.clearAllMocks());

    it('renderiza um botão acessível de sino', () => {
        render(<NotificationBell unreadCount={0} onClick={mockOnClick} />);
        expect(screen.getByRole('button', { name: /notificações/i })).toBeInTheDocument();
    });

    it('não exibe badge quando não há não-lidas', () => {
        render(<NotificationBell unreadCount={0} onClick={mockOnClick} />);
        expect(screen.queryByText(/^[0-9]+$/)).not.toBeInTheDocument();
    });

    it('exibe a contagem de não-lidas no badge', () => {
        render(<NotificationBell unreadCount={3} onClick={mockOnClick} />);
        expect(screen.getByText('3')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /3 não lidas/i })).toBeInTheDocument();
    });

    it('limita a contagem exibida em 99+', () => {
        render(<NotificationBell unreadCount={150} onClick={mockOnClick} />);
        expect(screen.getByText('99+')).toBeInTheDocument();
    });

    it('chama onClick ao clicar no sino', () => {
        render(<NotificationBell unreadCount={2} onClick={mockOnClick} />);
        fireEvent.click(screen.getByRole('button'));
        expect(mockOnClick).toHaveBeenCalledTimes(1);
    });
});
