import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('fs', () => ({
    existsSync: vi.fn(() => false),
    readFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    promises: {
        writeFile: vi.fn().mockResolvedValue(undefined),
        rename: vi.fn().mockResolvedValue(undefined),
    },
}));
vi.mock('../../utils/atomicWrite', () => ({ atomicWriteSync: vi.fn() }));
vi.mock('../../services/socketService', () => ({ socketService: { emit: vi.fn() } }));
vi.mock('../../services/channelRouter', () => ({ channelRouter: { sendWhatsApp: vi.fn(), sendEmail: vi.fn() } }));
vi.mock('../../utils/logger', () => ({ createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) }));

import { notificationService } from '../../services/notificationService';

const seed = (arr: any[]) => { (notificationService as any).data.notifications = arr; };

const fixture = () => ([
    { id: 'a', recipient: 'u1', read: false, event: 'task.assigned' },
    { id: 'b', recipient: 'u2', read: false, event: 'task.assigned' },
    { id: 'c', recipient: undefined, read: false, event: 'stock.low' }, // broadcast
    { id: 'd', recipient: 'all', read: false, event: 'custom' },        // broadcast
]);

describe('notificationService — isolamento por usuário (#519)', () => {
    beforeEach(() => seed(fixture()));

    it('getForUser retorna as do usuário + broadcasts, nunca as de outro', () => {
        const ids = notificationService.getForUser('u1').map(n => n.id);
        expect(ids).toEqual(['a', 'c', 'd']); // sem 'b' (de u2)
    });

    it('getUnreadCount conta só as visíveis ao usuário', () => {
        expect(notificationService.getUnreadCount('u1')).toBe(3); // a, c, d
    });

    it('delete só age em notificação visível ao usuário', () => {
        expect(notificationService.delete('b', 'u1')).toBe(false); // de u2 → bloqueado
        expect(notificationService.delete('a', 'u1')).toBe(true);  // própria → ok
    });

    it('markAsRead bloqueia notificação de outro usuário', () => {
        expect(notificationService.markAsRead('b', 'u1')).toBe(false);
        expect(notificationService.markAsRead('a', 'u1')).toBe(true);
    });

    it('markAllAsRead marca só as visíveis (não toca as de outro)', () => {
        const count = notificationService.markAllAsRead('u1');
        expect(count).toBe(3); // a, c, d
        const b = (notificationService as any).data.notifications.find((n: any) => n.id === 'b');
        expect(b.read).toBe(false); // a de u2 segue não-lida
    });

    it('deleteAllForUser limpa a visão do usuário: hard-delete das pessoais + oculta broadcasts via deletedBy (preserva de outros)', () => {
        const removed = notificationService.deleteAllForUser('u1');
        expect(removed).toBe(3); // 'a' (pessoal, removida do store) + 'c','d' (broadcasts ocultados p/ u1 via deletedBy)
        const ids = (notificationService as any).data.notifications.map((n: any) => n.id);
        expect(ids.sort()).toEqual(['b', 'c', 'd']); // 'b' (de u2) intacta; broadcasts seguem no store p/ outros usuários
    });

    it('sem userId, getForUser/getUnreadCount não filtram (compat)', () => {
        expect(notificationService.getForUser('').length).toBe(4);
        expect(notificationService.getUnreadCount()).toBe(4);
    });
});

describe('notificationService — notifyPerson + flush (#1004)', () => {
    beforeEach(() => seed([]));

    it('notifyPerson preserva recipient/senderId na notificação criada', async () => {
        const notif = await notificationService.notifyPerson({
            event: 'custom',
            title: 'T',
            message: 'M',
            channels: ['in-app'],
            recipient: 'u1',
            senderId: 'u1',
            senderName: 'Marciano',
        });
        expect(notif.recipient).toBe('u1');
        expect(notif.senderId).toBe('u1');
        expect(notif.senderName).toBe('Marciano');
    });

    it('notifyPerson persiste em disco (flush) antes de retornar', async () => {
        const fsMock: any = await import('fs');
        const before = (fsMock.promises.writeFile as any).mock.calls.length;
        await notificationService.notifyPerson({
            event: 'custom',
            title: 'T',
            message: 'M',
            channels: ['in-app'],
            recipient: 'u1',
        });
        // flush() cancela o debounce e chama performSave → writeFile + rename executados síncronamente
        expect((fsMock.promises.writeFile as any).mock.calls.length).toBeGreaterThan(before);
        expect((fsMock.promises.rename as any).mock.calls.length).toBeGreaterThan(0);
    });
});

describe('notificationService — #1205 falha de canal NÃO marca entregue (deliveredTo vs failedChannels)', () => {
    beforeEach(() => seed([]));

    it('WhatsApp com success=false → failedChannels, NÃO deliveredTo', async () => {
        const { channelRouter } = await import('../../services/channelRouter');
        (channelRouter.sendWhatsApp as any).mockResolvedValueOnce({ success: false, error: 'sessão caída' });
        const n = await notificationService.notifyPerson({
            event: 'custom', title: 'T', message: 'M', channels: ['whatsapp'],
            recipient: 'u1', recipientPhone: '5511999990000',
        } as any);
        expect(n.failedChannels).toContain('whatsapp');
        expect(n.deliveredTo).not.toContain('whatsapp');
    });

    it('WhatsApp com success=true → deliveredTo (caminho feliz preservado)', async () => {
        const { channelRouter } = await import('../../services/channelRouter');
        (channelRouter.sendWhatsApp as any).mockResolvedValueOnce({ success: true, messageId: 'x' });
        const n = await notificationService.notifyPerson({
            event: 'custom', title: 'T', message: 'M', channels: ['whatsapp'],
            recipient: 'u1', recipientPhone: '5511999990000',
        } as any);
        expect(n.deliveredTo).toContain('whatsapp');
        expect(n.failedChannels).not.toContain('whatsapp');
    });

    it('E-mail com success=false → failedChannels, NÃO deliveredTo', async () => {
        const { channelRouter } = await import('../../services/channelRouter');
        (channelRouter.sendEmail as any).mockResolvedValueOnce({ success: false, error: 'SMTP recusou' });
        const n = await notificationService.notifyPerson({
            event: 'custom', title: 'T', message: 'M', channels: ['email'],
            recipient: 'u1', recipientEmail: 'a@b.com',
        } as any);
        expect(n.failedChannels).toContain('email');
        expect(n.deliveredTo).not.toContain('email');
    });
});
