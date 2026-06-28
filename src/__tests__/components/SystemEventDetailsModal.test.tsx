import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SystemEventDetailsModal from '../../components/SystemEventDetailsModal';
import type { SystemEvent } from '../../services/systemEventsService';

const baseEvent = (over: Partial<SystemEvent> = {}): SystemEvent => ({
    id: 'e1', timestamp: '2026-06-18T10:00:00Z', source: 'agent',
    actor: { id: '7', name: 'Maria' }, type: 'task_done',
    description: 'Tarefa concluída', severity: 'info', ...over,
});

describe('SystemEventDetailsModal (#921)', () => {
    it('não renderiza nada quando event é null', () => {
        const { container } = render(<SystemEventDetailsModal event={null} userMap={{}} onClose={vi.fn()} />);
        expect(container).toBeEmptyDOMElement();
    });

    it('exibe descrição, ator, tipo e a label da fonte ao abrir', () => {
        render(<SystemEventDetailsModal event={baseEvent()} userMap={{}} onClose={vi.fn()} />);
        const dialog = screen.getByRole('dialog');
        expect(within(dialog).getByText('Tarefa concluída')).toBeTruthy();
        expect(within(dialog).getByText('Maria')).toBeTruthy();
        expect(within(dialog).getByText('task_done')).toBeTruthy();
        // título/label da fonte 'agent' = 'Agente' (título + badge no corpo)
        expect(within(dialog).getAllByText('Agente').length).toBeGreaterThan(0);
    });

    it('mostra o botão "Abrir registro" e dispara onNavigate quando o evento é navegável', async () => {
        const user = userEvent.setup();
        const onNav = vi.fn();
        const onClose = vi.fn();
        render(<SystemEventDetailsModal event={baseEvent({ linkTo: 'tasks/77' })} userMap={{}} onClose={onClose} onNavigate={onNav} />);
        const dialog = screen.getByRole('dialog');
        await user.click(within(dialog).getByRole('button', { name: /Abrir registro/i }));
        expect(onNav).toHaveBeenCalledWith('tasks', '77');
        expect(onClose).toHaveBeenCalled(); // fecha após navegar
    });

    it('não mostra "Abrir registro" quando onNavigate não é fornecido', () => {
        render(<SystemEventDetailsModal event={baseEvent({ linkTo: 'tasks/1' })} userMap={{}} onClose={vi.fn()} />);
        expect(screen.queryByRole('button', { name: /Abrir registro/i })).toBeNull();
    });

    it('não mostra "Abrir registro" quando o evento não é navegável', () => {
        render(<SystemEventDetailsModal event={baseEvent()} userMap={{}} onClose={vi.fn()} onNavigate={vi.fn()} />);
        expect(screen.queryByRole('button', { name: /Abrir registro/i })).toBeNull();
    });

    it('o botão "Fechar" dispara onClose', async () => {
        const user = userEvent.setup();
        const onClose = vi.fn();
        render(<SystemEventDetailsModal event={baseEvent()} userMap={{}} onClose={onClose} />);
        await user.click(screen.getByRole('button', { name: /^Fechar$/ }));
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('mostra a label de severidade "Erro" para evento de severidade error', () => {
        render(<SystemEventDetailsModal event={baseEvent({ severity: 'error' })} userMap={{}} onClose={vi.fn()} />);
        expect(screen.getByText('Erro')).toBeTruthy();
    });

    it('mostra a entidade quando entityType e entityId estão presentes', () => {
        render(<SystemEventDetailsModal event={baseEvent({ entityType: 'invoice', entityId: '42' })} userMap={{}} onClose={vi.fn()} />);
        expect(screen.getByText(/invoice #42/)).toBeTruthy();
    });

    it('resolve o destinatário pelo userMap e aplica o papel do DELEG_TO_ROLE', () => {
        render(<SystemEventDetailsModal event={baseEvent({ type: 'requested', metadata: { to: '9' } })} userMap={{ '9': 'Carlos Souza' }} onClose={vi.fn()} />);
        expect(screen.getByText(/Carlos Souza \(Responsável\)/)).toBeTruthy();
    });

    it('mostra metadados extras no bloco "Detalhes" como JSON', () => {
        render(<SystemEventDetailsModal event={baseEvent({ metadata: { objetivo: 'x', host: 'srv-1' } })} userMap={{}} onClose={vi.fn()} />);
        expect(screen.getByText('Detalhes')).toBeTruthy();
        expect(screen.getByText(/"host"/)).toBeTruthy();
        expect(screen.getByText(/"srv-1"/)).toBeTruthy();
    });
});
