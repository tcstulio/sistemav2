import { describe, it, expect, vi, beforeEach } from 'vitest';

// #1004: notify_person deve resolver o destinatário in-app para o usuário logado quando
// o agente notifica a si mesmo (evita virar broadcast de sistema) e repassar senderId p/ auditoria.
vi.mock('../../config/env', () => ({ config: { deeplinkSecret: 'test-secret-notify-person' } }));
vi.mock('../../services/dolibarrService', () => ({ dolibarrService: {} }));
vi.mock('../../services/scraperService', () => ({ ScraperService: {} }));
vi.mock('../../utils/urlValidation', () => ({ isValidExternalUrl: () => true }));

const { mockNotifyPerson } = vi.hoisted(() => ({
    mockNotifyPerson: vi.fn().mockResolvedValue({ id: 'n_1004' }),
}));
vi.mock('../../services/notificationService', () => ({ notificationService: { notifyPerson: mockNotifyPerson } }));

import { executeTool, runWithToolContext } from '../../services/agentTools';

describe('agentTools — notify_person (#1004)', () => {
    beforeEach(() => mockNotifyPerson.mockClear());

    it('resolve recipient = usuário logado quando não informado (auto-notificação cai em "Minhas")', async () => {
        const out = await runWithToolContext({ userId: '42' }, () =>
            executeTool('notify_person', { name: 'Eu Mesmo', message: 'teste', channels: ['in-app'] })
        );
        expect(mockNotifyPerson).toHaveBeenCalledWith(expect.objectContaining({
            recipient: '42',
            senderId: '42',
        }));
        expect(out).toContain('Eu Mesmo');
    });

    it('args.recipient explícito vence sobre o usuário logado', async () => {
        await runWithToolContext({ userId: '42' }, () =>
            executeTool('notify_person', { name: 'Alguém', message: 'oi', channels: ['in-app'], recipient: '99' })
        );
        expect(mockNotifyPerson).toHaveBeenCalledWith(expect.objectContaining({
            recipient: '99',
            senderId: '42',
        }));
    });

    it('exige nome da pessoa', async () => {
        const out = await executeTool('notify_person', { message: 'sem nome' });
        expect(out).toMatch(/name/i);
        expect(mockNotifyPerson).not.toHaveBeenCalled();
    });

    it('exige mensagem', async () => {
        const out = await executeTool('notify_person', { name: 'Fulano' });
        expect(out).toMatch(/message/i);
        expect(mockNotifyPerson).not.toHaveBeenCalled();
    });

    it('canal in-app sem destinatário resolvível não vira broadcast (#1004)', async () => {
        // Sem contexto (runWithToolContext) e sem args.recipient: notify_person não sabe para
        // quem é a notificação in-app. Em vez de cair num broadcast implícito (recipient undefined
        // → visível a todos), devolve um pedido de destinatário e NÃO persiste nada.
        const out = await executeTool('notify_person', { name: 'Fulano', message: 'oi', channels: ['in-app'] });
        expect(out).toMatch(/destinat/i);
        expect(mockNotifyPerson).not.toHaveBeenCalled();
    });

    it('canais externos (whatsapp) dispensam destinatário in-app', async () => {
        // Sem contexto/recipient, mas com canal só whatsapp + telefone: não há destinatário in-app
        // para resolver, então o guarda não deve disparar.
        const out = await runWithToolContext({}, () =>
            executeTool('notify_person', { name: 'Cliente', message: 'olá', channels: ['whatsapp'], phone: '5511999999999' })
        );
        expect(out).toMatch(/Notificação enviada/i);
        expect(mockNotifyPerson).toHaveBeenCalledWith(expect.objectContaining({ recipientPhone: '5511999999999' }));
    });
});
