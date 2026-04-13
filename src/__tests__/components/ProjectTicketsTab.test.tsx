import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ProjectTicketsTab } from '../../components/Projects/tabs/ProjectTicketsTab';
import { Ticket } from '../../types';

describe('ProjectTicketsTab', () => {
    const mockOnCreateTicket = vi.fn();
    const mockOnEditTicket = vi.fn();
    const mockOnDeleteTicket = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
    });

    const createMockTicket = (id: string, overrides: Partial<Ticket> = {}): Ticket => ({
        id,
        ref: `TKT-${id}`,
        subject: `Ticket ${id}`,
        message: 'This is a test message for the ticket',
        type_code: 'ISSUE',
        severity_code: 'HIGH',
        statut: '1',
        date: Date.now(),
        ...overrides
    });

    it('renders empty state when no tickets', () => {
        render(
            <ProjectTicketsTab
                tickets={[]}
                onCreateTicket={mockOnCreateTicket}
                onEditTicket={mockOnEditTicket}
                onDeleteTicket={mockOnDeleteTicket}
            />
        );
        expect(screen.getByText('Nenhum chamado encontrado.')).toBeInTheDocument();
    });

    it('renders ticket subject and ref', () => {
        const tickets = [createMockTicket('1', { subject: 'Bug no sistema' })];
        render(
            <ProjectTicketsTab
                tickets={tickets}
                onCreateTicket={mockOnCreateTicket}
                onEditTicket={mockOnEditTicket}
                onDeleteTicket={mockOnDeleteTicket}
            />
        );
        expect(screen.getByText('TKT-1 - Bug no sistema')).toBeInTheDocument();
    });

    it('renders multiple tickets', () => {
        const tickets = [
            createMockTicket('1', { subject: 'Ticket 1' }),
            createMockTicket('2', { subject: 'Ticket 2' })
        ];
        render(
            <ProjectTicketsTab
                tickets={tickets}
                onCreateTicket={mockOnCreateTicket}
                onEditTicket={mockOnEditTicket}
                onDeleteTicket={mockOnDeleteTicket}
            />
        );
        expect(screen.getByText('TKT-1 - Ticket 1')).toBeInTheDocument();
        expect(screen.getByText('TKT-2 - Ticket 2')).toBeInTheDocument();
    });

    it('calls onCreateTicket when clicking "Novo Chamado"', () => {
        render(
            <ProjectTicketsTab
                tickets={[]}
                onCreateTicket={mockOnCreateTicket}
                onEditTicket={mockOnEditTicket}
                onDeleteTicket={mockOnDeleteTicket}
            />
        );
        fireEvent.click(screen.getByText('Novo Chamado'));
        expect(mockOnCreateTicket).toHaveBeenCalled();
    });

    it('renders severity and status', () => {
        const tickets = [createMockTicket('1', { severity_code: 'HIGH', statut: 'Open' })];
        render(
            <ProjectTicketsTab
                tickets={tickets}
                onCreateTicket={mockOnCreateTicket}
                onEditTicket={mockOnEditTicket}
                onDeleteTicket={mockOnDeleteTicket}
            />
        );
        expect(screen.getByText('HIGH')).toBeInTheDocument();
        expect(screen.getByText('Open')).toBeInTheDocument();
    });

    it('calls onEditTicket when clicking edit button', () => {
        const tickets = [createMockTicket('1')];
        render(
            <ProjectTicketsTab
                tickets={tickets}
                onCreateTicket={mockOnCreateTicket}
                onEditTicket={mockOnEditTicket}
                onDeleteTicket={mockOnDeleteTicket}
            />
        );
        const buttons = screen.getAllByRole('button');
        fireEvent.click(buttons[1]);
        expect(mockOnEditTicket).toHaveBeenCalledWith(tickets[0]);
    });

    it('calls onDeleteTicket when clicking delete button', () => {
        const tickets = [createMockTicket('1')];
        render(
            <ProjectTicketsTab
                tickets={tickets}
                onCreateTicket={mockOnCreateTicket}
                onEditTicket={mockOnEditTicket}
                onDeleteTicket={mockOnDeleteTicket}
            />
        );
        const buttons = screen.getAllByRole('button');
        fireEvent.click(buttons[2]);
        expect(mockOnDeleteTicket).toHaveBeenCalledWith('1');
    });

    it('renders header "Chamados Vinculados"', () => {
        render(
            <ProjectTicketsTab
                tickets={[]}
                onCreateTicket={mockOnCreateTicket}
                onEditTicket={mockOnEditTicket}
                onDeleteTicket={mockOnDeleteTicket}
            />
        );
        expect(screen.getByText('Chamados Vinculados')).toBeInTheDocument();
    });

    it('shows ISSUE icon with red background', () => {
        const tickets = [createMockTicket('1', { type_code: 'ISSUE' })];
        render(
            <ProjectTicketsTab
                tickets={tickets}
                onCreateTicket={mockOnCreateTicket}
                onEditTicket={mockOnEditTicket}
                onDeleteTicket={mockOnDeleteTicket}
            />
        );
        expect(screen.getByText('TKT-1 - Ticket 1')).toBeInTheDocument();
    });
});