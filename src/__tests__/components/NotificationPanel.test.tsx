import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import NotificationPanel from '../../components/NotificationPanel';
import { AppNotification, AppView } from '../../types';

vi.mock('../../utils/dateUtils', () => ({
    formatTime: vi.fn((date: number) => {
        const d = new Date(date);
        return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    })
}));

const mockNotifications: AppNotification[] = [
    {
        id: '1',
        type: 'email',
        title: 'Novo email',
        message: 'Você recebeu uma nova mensagem de contato@empresa.com',
        date: Date.now() - 10000,
        read: false,
        priority: 'normal',
        linkTo: { view: 'email' as AppView, id: '100' }
    },
    {
        id: '2',
        type: 'stock',
        title: 'Alerta de Stock',
        message: 'O produto "Açúcar 5kg" está com stock crítico (3 unidades)',
        date: Date.now() - 50000,
        read: false,
        priority: 'high',
        linkTo: { view: 'inventory' as AppView, id: '50' }
    },
    {
        id: '3',
        type: 'invoice',
        title: 'Fatura Vencida',
        message: 'Fatura #1234 está vencida há 5 dias',
        date: Date.now() - 100000,
        read: true,
        priority: 'normal'
    }
];

describe('NotificationPanel', () => {
    const mockOnClose = vi.fn();
    const mockOnMarkRead = vi.fn();
    const mockOnNavigate = vi.fn();
    const mockOnClearAll = vi.fn();
    const mockOnMarkAllRead = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
    });

    const renderPanel = (notifications: AppNotification[] = mockNotifications, isOpen = true) => {
        return render(
            <NotificationPanel
                isOpen={isOpen}
                onClose={mockOnClose}
                notifications={notifications}
                onMarkRead={mockOnMarkRead}
                onNavigate={mockOnNavigate}
                onClearAll={mockOnClearAll}
                onMarkAllRead={mockOnMarkAllRead}
            />
        );
    };

    it('renders nothing when isOpen is false', () => {
        renderPanel(mockNotifications, false);
        expect(screen.queryByText('Notificações')).not.toBeInTheDocument();
    });

    it('renders notification panel when open', () => {
        renderPanel();
        expect(screen.getByText('Notificações')).toBeInTheDocument();
        expect(screen.getByText('Novo email')).toBeInTheDocument();
        expect(screen.getByText('Alerta de Stock')).toBeInTheDocument();
    });

    it('shows unread count badge', () => {
        renderPanel();
        expect(screen.getByText('2')).toBeInTheDocument();
    });

    it('renders empty state when no notifications', () => {
        renderPanel([]);
        expect(screen.getByText('Tudo em dia!')).toBeInTheDocument();
    });

    it('calls onClose when close button is clicked', () => {
        renderPanel();
        const closeButton = screen.getByRole('button', { name: '' });
        fireEvent.click(closeButton);
        expect(mockOnClose).toHaveBeenCalled();
    });

    it('calls onMarkAllRead when "Lidas" button is clicked', () => {
        renderPanel();
        fireEvent.click(screen.getByText('Lidas'));
        expect(mockOnMarkAllRead).toHaveBeenCalled();
    });

    it('calls onClearAll when "Limpar" button is clicked', () => {
        renderPanel();
        fireEvent.click(screen.getByText('Limpar'));
        expect(mockOnClearAll).toHaveBeenCalled();
    });

    it('calls onMarkRead and onNavigate when clicking a notification', () => {
        renderPanel();
        fireEvent.click(screen.getByText('Novo email'));
        expect(mockOnMarkRead).toHaveBeenCalledWith('1');
        expect(mockOnNavigate).toHaveBeenCalledWith('email', '100');
    });

    it('shows unread indicator for unread notifications', () => {
        renderPanel();
        const unreadNote = screen.getByText('Novo email').closest('.rounded-lg');
        expect(unreadNote).toHaveClass('border-l-indigo-500');
    });
});