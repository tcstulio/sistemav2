import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ProjectEventsTab } from '../../components/Projects/tabs/ProjectEventsTab';
import { AgendaEvent } from '../../types/projects';

describe('ProjectEventsTab', () => {
    const mockOnNavigate = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
    });

    const createMockEvent = (id: string, overrides: Partial<AgendaEvent> = {}): AgendaEvent => ({
        id,
        label: `Event ${id}`,
        date_start: '2024-01-15',
        date_end: '2024-01-16',
        percentage: 0,
        location: '',
        description: '',
        ...overrides
    });

    it('renders empty state when no events', () => {
        render(<ProjectEventsTab events={[]} onNavigate={mockOnNavigate} />);
        expect(screen.getByText('Nenhum evento encontrado.')).toBeInTheDocument();
    });

    it('renders event label', () => {
        const events = [createMockEvent('1', { label: 'Reunião de Kickoff' })];
        render(<ProjectEventsTab events={events} onNavigate={mockOnNavigate} />);
        expect(screen.getByText('Reunião de Kickoff')).toBeInTheDocument();
    });

    it('renders multiple events', () => {
        const events = [
            createMockEvent('1', { label: 'Event 1' }),
            createMockEvent('2', { label: 'Event 2' })
        ];
        render(<ProjectEventsTab events={events} onNavigate={mockOnNavigate} />);
        expect(screen.getByText('Event 1')).toBeInTheDocument();
        expect(screen.getByText('Event 2')).toBeInTheDocument();
    });

    it('renders location when present', () => {
        const events = [createMockEvent('1', { location: 'Sala de Reunião A' })];
        render(<ProjectEventsTab events={events} onNavigate={mockOnNavigate} />);
        expect(screen.getByText('Sala de Reunião A')).toBeInTheDocument();
    });

    it('renders description when present', () => {
        const events = [createMockEvent('1', { description: 'Descrição do evento' })];
        render(<ProjectEventsTab events={events} onNavigate={mockOnNavigate} />);
        expect(screen.getByText('Descrição do evento')).toBeInTheDocument();
    });

    it('renders percentage badge', () => {
        const events = [createMockEvent('1', { percentage: 100 })];
        render(<ProjectEventsTab events={events} onNavigate={mockOnNavigate} />);
        expect(screen.getByText('100%')).toBeInTheDocument();
    });

    it('renders header Eventos do Projeto', () => {
        render(<ProjectEventsTab events={[]} onNavigate={mockOnNavigate} />);
        expect(screen.getByText('Eventos do Projeto')).toBeInTheDocument();
    });

    it('calls onNavigate when clicking event', () => {
        const events = [createMockEvent('1')];
        render(<ProjectEventsTab events={events} onNavigate={mockOnNavigate} />);
        fireEvent.click(screen.getByText('Event 1'));
        expect(mockOnNavigate).toHaveBeenCalledWith('agenda', '1');
    });

    it('does not call onNavigate when onNavigate is not provided', () => {
        const events = [createMockEvent('1')];
        render(<ProjectEventsTab events={events} />);
        fireEvent.click(screen.getByText('Event 1'));
        expect(mockOnNavigate).not.toHaveBeenCalled();
    });
});