import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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

describe('DevelopmentView — Rules of Hooks (#1822, épico #1082)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it('renderiza o fallback "Carregando configurações..." quando config é null', () => {
        mockedUseDolibarr.mockReturnValue({
            config: null,
            currentUser: { id: '1', login: 'admin', admin: 1 },
        });
        render(<DevelopmentView />);
        expect(screen.getByText('Carregando configurações...')).toBeInTheDocument();
        expect(screen.queryByText('Console de Desenvolvedor')).not.toBeInTheDocument();
    });

    it('renderiza o fallback de dev-mode bloqueado mesmo com config presente', () => {
        vi.stubEnv('DEV', false);
        vi.stubEnv('VITE_ENABLE_DEV_CONSOLE', '');
        mockedUseDolibarr.mockReturnValue({
            config: { themeColor: 'indigo' },
            currentUser: { id: '1', login: 'admin', admin: 1 },
        });
        render(<DevelopmentView />);
        expect(screen.getByText('Console indisponível')).toBeInTheDocument();
        expect(screen.queryByText('Console de Desenvolvedor')).not.toBeInTheDocument();
    });

    it('renderiza o console completo quando config existe e dev-mode está ativo', () => {
        mockedUseDolibarr.mockReturnValue({
            config: { themeColor: 'indigo' },
            currentUser: { id: '1', login: 'admin', admin: 1 },
        });
        render(<DevelopmentView />);
        expect(screen.getByText('Console de Desenvolvedor')).toBeInTheDocument();
        expect(screen.getByTestId('monitor-tab')).toBeInTheDocument();
    });

    it('não viola Rules of Hooks ao alternar config null → presente (useState permanece na mesma ordem)', () => {
        // 1º render: config null → cai no fallback "Carregando configurações...".
        mockedUseDolibarr.mockReturnValue({
            config: null,
            currentUser: { id: '1', login: 'admin', admin: 1 },
        });
        const { rerender } = render(<DevelopmentView />);
        expect(screen.getByText('Carregando configurações...')).toBeInTheDocument();

        // 2º render: config presente → useState(activeTab) já foi registrada no 1º render,
        // então o React não quebra (useState permanece na mesma posição na ordem de hooks).
        mockedUseDolibarr.mockReturnValue({
            config: { themeColor: 'indigo' },
            currentUser: { id: '1', login: 'admin', admin: 1 },
        });
        expect(() => rerender(<DevelopmentView />)).not.toThrow();
        expect(screen.getByText('Monitor de Sync')).toBeInTheDocument();
    });

    it('preserva o estado activeTab entre re-renders com config presente (hook order estável)', async () => {
        mockedUseDolibarr.mockReturnValue({
            config: { themeColor: 'indigo' },
            currentUser: { id: '1', login: 'admin', admin: 1 },
        });
        const user = userEvent.setup();
        const { rerender } = render(<DevelopmentView />);

        // Troca para a aba "Auditoria do Sistema" para setar activeTab.
        await user.click(screen.getByText('Auditoria do Sistema'));
        expect(screen.getByTestId('audit-tab')).toBeInTheDocument();

        // Re-render simulando nova referência de config (mesmo conteúdo) — o state
        // deve persistir porque useState foi chamado no mesmo lugar nos dois renders.
        mockedUseDolibarr.mockReturnValue({
            config: { themeColor: 'indigo' },
            currentUser: { id: '1', login: 'admin', admin: 1 },
        });
        rerender(<DevelopmentView />);
        expect(screen.getByTestId('audit-tab')).toBeInTheDocument();
    });
});
