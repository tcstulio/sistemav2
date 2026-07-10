import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../context/DolibarrContext', () => ({
    useDolibarr: vi.fn(() => ({
        config: { themeColor: 'indigo' },
        currentUser: { id: '1', login: 'admin', admin: 1 },
    })),
}));

// Stubs das abas pesadas (evitam chamadas de rede no mount).
vi.mock('../../components/DevelopmentConsole/MonitorTab', () => ({
    MonitorTab: () => <div data-testid="monitor-tab" />,
}));
vi.mock('../../components/DevelopmentConsole/AuditTab', () => ({
    AuditTab: () => <div data-testid="audit-tab" />,
}));
vi.mock('../../components/DevelopmentConsole/ConsoleLogsTab', () => ({
    ConsoleLogsTab: () => <div data-testid="console-logs-tab" />,
}));
vi.mock('../../components/DevelopmentConsole/PermissionsTab', () => ({
    PermissionsTab: () => <div data-testid="permissions-tab" />,
}));
vi.mock('../../components/DevelopmentConsole/LlmSettingsTab', () => ({
    LlmSettingsTab: () => <div data-testid="llm-settings-tab" />,
}));

// Stub do editor para isolar a integração (o componente real é testado em AgentConfigEditor.test.tsx).
vi.mock('../../components/development/AgentConfigEditor', () => ({
    AgentConfigEditor: ({ isAdmin }: { isAdmin: boolean }) => (
        <div data-testid="agent-config-editor" data-is-admin={String(isAdmin)} />
    ),
}));

import DevelopmentView from '../../components/DevelopmentView';
import { useDolibarr } from '../../context/DolibarrContext';

const mockedUseDolibarr = useDolibarr as unknown as ReturnType<typeof vi.fn>;

describe('DevelopmentView — aba Config IA integra o AgentConfigEditor (#1005)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockedUseDolibarr.mockReturnValue({
            config: { themeColor: 'indigo' },
            currentUser: { id: '1', login: 'admin', admin: 1 },
        });
    });

    it('renderiza o AgentConfigEditor na aba Config IA', async () => {
        const user = userEvent.setup();
        render(<DevelopmentView />);
        await user.click(screen.getByText('Config IA'));
        expect(screen.getByTestId('agent-config-editor')).toBeInTheDocument();
    });

    it('passa isAdmin=true quando o usuário é admin', async () => {
        const user = userEvent.setup();
        render(<DevelopmentView />);
        await user.click(screen.getByText('Config IA'));
        expect(screen.getByTestId('agent-config-editor')).toHaveAttribute('data-is-admin', 'true');
    });

    it('passa isAdmin=false quando o usuário não é admin', async () => {
        mockedUseDolibarr.mockReturnValue({
            config: { themeColor: 'indigo' },
            currentUser: { id: '2', login: 'user', admin: 0 },
        });
        const user = userEvent.setup();
        render(<DevelopmentView />);
        await user.click(screen.getByText('Config IA'));
        expect(screen.getByTestId('agent-config-editor')).toHaveAttribute('data-is-admin', 'false');
    });
});
