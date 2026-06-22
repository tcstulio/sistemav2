import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AgentActivityFeed } from '../../components/Agent/AgentActivityFeed';

const okJson = (body: any) => Promise.resolve({ ok: true, status: 200, json: async () => body });

describe('AgentActivityFeed — atribuição de autor (#544)', () => {
    beforeEach(() => { vi.clearAllMocks(); });

    it('exibe o nome real do usuário quando presente', async () => {
        (global.fetch as any).mockResolvedValue(okJson({
            activities: [{ id: '1', tool: 'list_user_tasks', action: 'read', description: 'Consultou tarefas', result: 'success', userName: 'João Silva', durationMs: 100, createdAt: Date.now() }],
        }));
        render(<AgentActivityFeed />);
        expect(await screen.findByText(/Consultou tarefas/)).toBeTruthy();
        expect(screen.getByText(/João Silva/)).toBeTruthy();
    });

    it('NÃO exibe "unknown"; mostra "Agente" quando userName está ausente', async () => {
        (global.fetch as any).mockResolvedValue(okJson({
            activities: [{ id: '2', tool: 'create_invoice', action: 'create', description: 'Criou fatura', result: 'success', userName: '', durationMs: 50, createdAt: Date.now() }],
        }));
        const { container } = render(<AgentActivityFeed />);
        await screen.findByText(/Criou fatura/);
        expect(screen.getByText(/Agente/)).toBeTruthy();
        expect(container.textContent).not.toContain('unknown');
    });

    it('NÃO exibe "unknown"; mostra "Agente" quando userName === "unknown"', async () => {
        (global.fetch as any).mockResolvedValue(okJson({
            activities: [{ id: '3', tool: 'send_whatsapp', action: 'notify', description: 'Enviou WhatsApp', result: 'success', userName: 'unknown', durationMs: 10, createdAt: Date.now() }],
        }));
        const { container } = render(<AgentActivityFeed />);
        await screen.findByText(/Enviou WhatsApp/);
        expect(screen.getByText(/Agente/)).toBeTruthy();
        expect(container.textContent).not.toContain('unknown');
    });
});
