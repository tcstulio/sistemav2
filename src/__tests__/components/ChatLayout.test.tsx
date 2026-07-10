import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { ChatLayout } from '../../components/chat/ChatLayout';

vi.mock('react-router-dom', () => ({
    useNavigate: () => vi.fn(),
    useParams: () => ({ type: undefined, id: undefined }),
    Outlet: () => <div data-testid="router-outlet" />,
}));

vi.mock('../../components/chat/ChatSidebar', () => ({
    ChatSidebar: () => <div data-testid="chat-sidebar" />,
}));

vi.mock('../../components/ui/MasterDetailLayout', () => ({
    MasterDetailLayout: ({ list, detail }: any) => (
        <div data-testid="master-detail">
            <div>{list}</div>
            <div>{detail}</div>
        </div>
    ),
}));

describe('ChatLayout — height chain (#663)', () => {
    it('root container uses h-full instead of calc(100vh-64px)', () => {
        const { container } = render(<ChatLayout />);
        const root = container.firstChild as HTMLElement;
        expect(root).toHaveClass('h-full');
        expect(root.className).not.toContain('calc(100vh-64px)');
    });

    it('root container preserves overflow-hidden and flex flex-col', () => {
        const { container } = render(<ChatLayout />);
        const root = container.firstChild as HTMLElement;
        expect(root).toHaveClass('overflow-hidden');
        expect(root).toHaveClass('flex');
        expect(root).toHaveClass('flex-col');
    });

    it('renders sidebar and routed outlet via MasterDetailLayout', () => {
        render(<ChatLayout />);
        expect(document.querySelector('[data-testid="chat-sidebar"]')).not.toBeNull();
        expect(document.querySelector('[data-testid="router-outlet"]')).not.toBeNull();
    });
});
