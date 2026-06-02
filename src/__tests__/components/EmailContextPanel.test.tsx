import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { EmailContextPanel } from '../../components/Email/EmailContextPanel';
import { ThirdParty, Invoice, Order, Ticket } from '../../types';

vi.mock('../../utils/dateUtils', () => ({
    formatDateOnly: vi.fn((date: number) => new Date(date * 1000).toLocaleDateString('pt-BR'))
}));

describe('EmailContextPanel', () => {
    const mockOnClose = vi.fn();
    const mockOnNavigate = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
    });

    const createMockCustomer = (name: string, email?: string): ThirdParty => ({
        id: '1',
        name,
        email: email || undefined,
        phone: undefined,
        phone_mobile: undefined,
        address: undefined,
        zip: undefined,
        town: undefined,
        status: '1',
        client: '1',
        fournisseur: '0'
    });

    const createMockInvoice = (ref: string, socid: string): Invoice => ({
        id: ref,
        ref,
        socid,
        date: Date.now() / 1000,
        total_ttc: 1000,
        statut: '1',
        paye: '0'
    });

    const createMockOrder = (ref: string, socid: string): Order => ({
        id: ref,
        ref,
        socid,
        date: Date.now() / 1000,
        total_ttc: 500,
        statut: '1'
    });

    const createMockTicket = (ref: string, socid: string): Ticket => ({
        id: ref,
        ref,
        socid,
        track_id: 'TRK-' + ref,
        subject: 'Test Ticket',
        message: 'Test ticket message',
        type_code: 'COMMERCIAL',
        category_code: 'OTHER',
        severity_code: 'NORMAL',
        statut: '0',
        progress: '0',
        datec: Date.now() / 1000,
        tms: Date.now() / 1000
    });

    it('renders panel header even when closed (CSS-based visibility)', () => {
        render(
            <EmailContextPanel
                isOpen={false}
                onClose={mockOnClose}
                contextData={null}
            />
        );
        expect(screen.getByText('Contexto')).toBeInTheDocument();
    });

    it('renders panel when open', () => {
        render(
            <EmailContextPanel
                isOpen={true}
                onClose={mockOnClose}
                contextData={null}
            />
        );
        expect(screen.getByText('Contexto')).toBeInTheDocument();
    });

    it('shows customer not found when contextData is null', () => {
        render(
            <EmailContextPanel
                isOpen={true}
                onClose={mockOnClose}
                contextData={null}
            />
        );
        expect(screen.getByText('Cliente não encontrado.')).toBeInTheDocument();
    });

    it('shows customer info when customer is provided', () => {
        render(
            <EmailContextPanel
                isOpen={true}
                onClose={mockOnClose}
                contextData={{
                    customer: createMockCustomer('Empresa Teste', 'test@empresa.com'),
                    invoices: [],
                    orders: [],
                    tickets: []
                }}
                onNavigate={mockOnNavigate}
            />
        );
        expect(screen.getByText('Empresa Teste')).toBeInTheDocument();
        expect(screen.getByText('test@empresa.com')).toBeInTheDocument();
    });

    it('shows "Nenhum email selecionado" when no emailAddress', () => {
        render(
            <EmailContextPanel
                isOpen={true}
                onClose={mockOnClose}
                contextData={null}
            />
        );
        expect(screen.getByText('Nenhum email selecionado')).toBeInTheDocument();
    });

    it('displays email address when provided', () => {
        render(
            <EmailContextPanel
                isOpen={true}
                onClose={mockOnClose}
                contextData={null}
                emailAddress="test@example.com"
            />
        );
        expect(screen.getByText('test@example.com')).toBeInTheDocument();
    });

    it('shows recent invoices section when customer has invoices', () => {
        const customer = createMockCustomer('Empresa Teste', 'test@empresa.com');
        render(
            <EmailContextPanel
                isOpen={true}
                onClose={mockOnClose}
                contextData={{
                    customer,
                    invoices: [createMockInvoice('INV-001', '1')],
                    orders: [],
                    tickets: []
                }}
            />
        );
        expect(screen.getByText('Faturas Recentes')).toBeInTheDocument();
        expect(screen.getByText('INV-001')).toBeInTheDocument();
    });

    it('shows orders section when customer has orders', () => {
        const customer = createMockCustomer('Empresa Teste');
        render(
            <EmailContextPanel
                isOpen={true}
                onClose={mockOnClose}
                contextData={{
                    customer,
                    invoices: [],
                    orders: [createMockOrder('ORD-001', '1')],
                    tickets: []
                }}
            />
        );
        expect(screen.getByText('ORD-001')).toBeInTheDocument();
    });

    it('calls onNavigate when clicking customer profile', () => {
        const customer = createMockCustomer('Empresa Teste');
        render(
            <EmailContextPanel
                isOpen={true}
                onClose={mockOnClose}
                contextData={{
                    customer,
                    invoices: [],
                    orders: [],
                    tickets: []
                }}
                onNavigate={mockOnNavigate}
            />
        );
        fireEvent.click(screen.getByText(/Ver Perfil Completo/));
        expect(mockOnNavigate).toHaveBeenCalledWith('customers', '1');
    });

    it('calls onClose when close button is clicked', () => {
        render(
            <EmailContextPanel
                isOpen={true}
                onClose={mockOnClose}
                contextData={null}
            />
        );
        fireEvent.click(screen.getByRole('button', { name: '' }));
        expect(mockOnClose).toHaveBeenCalled();
    });
});