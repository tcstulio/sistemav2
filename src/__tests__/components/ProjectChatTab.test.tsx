import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ProjectChatTab } from '../../components/Projects/tabs/ProjectChatTab';
import { Project } from '../../types/projects';

vi.mock('../../components/Chat/ChatInterface', () => ({
    ChatInterface: (props: any) => (
        <div data-testid="chat-interface" data-height={props.height} data-element-id={props.elementId}>
            {props.title}
        </div>
    ),
}));

const createMockProject = (overrides: Partial<Project> = {}): Project => ({
    id: '1',
    ref: 'PRJ-001',
    title: 'Projeto Teste',
    socid: '1',
    statut: '1',
    progress: 0,
    ...overrides,
});

describe('ProjectChatTab — height chain (#663)', () => {
    it('wraps ChatInterface in a container with h-full flex flex-col', () => {
        render(<ProjectChatTab project={createMockProject()} />);
        const wrapper = screen.getByTestId('chat-interface').parentElement as HTMLElement;
        expect(wrapper).toHaveClass('h-full');
        expect(wrapper).toHaveClass('flex');
        expect(wrapper).toHaveClass('flex-col');
    });

    it('passes height="100%" explicitly to ChatInterface', () => {
        render(<ProjectChatTab project={createMockProject()} />);
        expect(screen.getByTestId('chat-interface').getAttribute('data-height')).toBe('100%');
    });

    it('forwards project id and title to ChatInterface', () => {
        render(<ProjectChatTab project={createMockProject({ id: '42', ref: 'PRJ-042' })} />);
        const chat = screen.getByTestId('chat-interface');
        expect(chat.getAttribute('data-element-id')).toBe('42');
        expect(chat).toHaveTextContent('Chat do Projeto PRJ-042');
    });
});
