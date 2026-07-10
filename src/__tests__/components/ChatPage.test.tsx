import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import * as routerDom from 'react-router-dom';
import { ChatPage, ChatConversation } from '../../pages/ChatPage';

vi.mock('react-router-dom', () => ({
    useParams: vi.fn(),
}));

vi.mock('../../components/chat/ChatInterface', () => ({
    ChatInterface: (props: any) => (
        <div data-testid="chat-interface" data-height={props.height}>
            {props.title}
        </div>
    ),
}));

vi.mock('../../components/chat/ChatLayout', () => ({
    ChatLayout: () => <div data-testid="chat-layout" />,
}));

vi.mock('../../hooks/dolibarr', () => ({
    useUsers: vi.fn(() => ({ data: [] })),
    useProjects: vi.fn(() => ({ data: [] })),
}));

vi.mock('../../context/DolibarrContext', () => ({
    useDolibarr: () => ({ config: { apiUrl: 'http://test/api/index.php', apiKey: 'key' } }),
}));

describe('ChatPage', () => {
    it('renders ChatLayout', () => {
        render(<ChatPage />);
        expect(screen.getByTestId('chat-layout')).toBeInTheDocument();
    });
});

describe('ChatConversation — height chain (#663)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(routerDom.useParams).mockReturnValue({ type: 'project', id: '1' });
    });

    it('wraps ChatInterface in a flex container that repasses flex-1 min-h-0', () => {
        render(<ChatConversation />);
        const wrapper = screen.getByTestId('chat-interface').parentElement as HTMLElement;
        expect(wrapper).toHaveClass('flex');
        expect(wrapper).toHaveClass('flex-col');
        expect(wrapper).toHaveClass('flex-1');
        expect(wrapper).toHaveClass('min-h-0');
    });

    it('passes height="100%" to ChatInterface', () => {
        render(<ChatConversation />);
        expect(screen.getByTestId('chat-interface').getAttribute('data-height')).toBe('100%');
    });

    it('renders empty state when no type/id is present', () => {
        vi.mocked(routerDom.useParams).mockReturnValue({ type: undefined, id: undefined });
        render(<ChatConversation />);
        expect(screen.getByText('Selecione uma conversa ao lado para começar.')).toBeInTheDocument();
        expect(screen.queryByTestId('chat-interface')).toBeNull();
    });
});
