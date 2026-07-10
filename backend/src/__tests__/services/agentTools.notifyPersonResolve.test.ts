import { describe, it, expect, vi, beforeEach } from 'vitest';

// Feature: o agente resolve o contato de um USUÁRIO do sistema (userId/nome) para mandar
// WhatsApp/email sem o LLM saber o número. Cobre os riscos da análise adversarial:
// ambiguidade de nome, usuário sem celular, office_phone ignorado, phone explícito vence.
vi.mock('../../config/env', () => ({ config: { deeplinkSecret: 'test-secret-resolve' } }));

const mockDolibarr = vi.hoisted(() => ({
    getUserById: vi.fn(),
    listUsers: vi.fn(),
}));
vi.mock('../../services/dolibarrService', () => ({ dolibarrService: mockDolibarr }));
vi.mock('../../services/scraperService', () => ({ ScraperService: {} }));
vi.mock('../../utils/urlValidation', () => ({ isValidExternalUrl: () => true }));

const { mockNotifyPerson } = vi.hoisted(() => ({ mockNotifyPerson: vi.fn().mockResolvedValue({ id: 'n1' }) }));
vi.mock('../../services/notificationService', () => ({ notificationService: { notifyPerson: mockNotifyPerson } }));

import { executeTool, runWithToolContext, resolveUserContact } from '../../services/agentTools';

describe('resolveUserContact (helper)', () => {
    beforeEach(() => { vi.clearAllMocks(); });

    it('por userId: telefone (do celular) + email + displayName', async () => {
        mockDolibarr.getUserById.mockResolvedValue({ id: '5', firstname: 'João', lastname: 'Silva', user_mobile: '(11) 98765-4321', email: 'joao@x.com' });
        const r = await resolveUserContact({ userId: '5' });
        expect(r).toEqual({ userId: '5', phone: '11987654321', email: 'joao@x.com', displayName: 'João Silva' });
    });

    it('userId inexistente → erro', async () => {
        mockDolibarr.getUserById.mockResolvedValue(null);
        expect(await resolveUserContact({ userId: '999' })).toHaveProperty('error');
    });

    it('nome único → resolve', async () => {
        mockDolibarr.listUsers.mockResolvedValue([{ id: '7', firstname: 'Maria', lastname: 'Souza', user_mobile: '11911112222', email: 'm@x.com' }]);
        expect(await resolveUserContact({ name: 'Maria' })).toMatchObject({ userId: '7', phone: '11911112222' });
    });

    it('nome ambíguo (>1) → NÃO adivinha, erro pedindo o userId', async () => {
        mockDolibarr.listUsers.mockResolvedValue([{ id: '7', firstname: 'Maria', lastname: 'A' }, { id: '8', firstname: 'Maria', lastname: 'B' }]);
        const r = await resolveUserContact({ name: 'Maria' });
        expect(r).toHaveProperty('error');
        expect((r as any).error).toMatch(/id/i);
    });

    it('nome sem match → erro', async () => {
        mockDolibarr.listUsers.mockResolvedValue([]);
        expect(await resolveUserContact({ name: 'Ninguém' })).toHaveProperty('error');
    });

    it('telefone só de campos móveis: office_phone é ignorado (não vira WhatsApp)', async () => {
        mockDolibarr.getUserById.mockResolvedValue({ id: '5', office_phone: '1133334444', user_mobile: '', phone_mobile: '' });
        expect((await resolveUserContact({ userId: '5' }) as any).phone).toBe('');
    });
});

describe('notify_person — resolução de contato para canais externos', () => {
    beforeEach(() => { vi.clearAllMocks(); mockNotifyPerson.mockResolvedValue({ id: 'n1' }); });

    it('whatsapp com recipient(userId) e SEM phone → resolve o número do cadastro', async () => {
        mockDolibarr.getUserById.mockResolvedValue({ id: '5', firstname: 'João', lastname: 'Silva', user_mobile: '11987654321' });
        const out = await runWithToolContext({ userId: '1' }, () =>
            executeTool('notify_person', { name: 'João', recipient: '5', message: 'Oi', channels: ['whatsapp'] }));
        expect(mockNotifyPerson).toHaveBeenCalledWith(expect.objectContaining({ recipientPhone: '11987654321', recipient: '5' }));
        expect(out).toMatch(/enviada/i);
    });

    it('whatsapp por NOME único e sem phone → resolve', async () => {
        mockDolibarr.listUsers.mockResolvedValue([{ id: '9', firstname: 'Ana', lastname: 'Lima', user_mobile: '11955556666' }]);
        await runWithToolContext({ userId: '1' }, () =>
            executeTool('notify_person', { name: 'Ana', message: 'Oi', channels: ['whatsapp'] }));
        expect(mockNotifyPerson).toHaveBeenCalledWith(expect.objectContaining({ recipientPhone: '11955556666', recipient: '9' }));
    });

    it('whatsapp com nome ambíguo → erro, NÃO envia', async () => {
        mockDolibarr.listUsers.mockResolvedValue([{ id: '9', firstname: 'Ana', lastname: 'A' }, { id: '10', firstname: 'Ana', lastname: 'B' }]);
        const out = await runWithToolContext({ userId: '1' }, () =>
            executeTool('notify_person', { name: 'Ana', message: 'Oi', channels: ['whatsapp'] }));
        expect(out).toMatch(/id/i);
        expect(mockNotifyPerson).not.toHaveBeenCalled();
    });

    it('usuário sem celular → mensagem clara, NÃO envia', async () => {
        mockDolibarr.getUserById.mockResolvedValue({ id: '5', firstname: 'Sem', lastname: 'Celular', user_mobile: '', phone_mobile: '' });
        const out = await runWithToolContext({ userId: '1' }, () =>
            executeTool('notify_person', { name: 'Sem Celular', recipient: '5', message: 'Oi', channels: ['whatsapp'] }));
        expect(out).toMatch(/não há whatsapp/i);
        expect(mockNotifyPerson).not.toHaveBeenCalled();
    });

    it('phone explícito vence e NÃO dispara resolução (caso cliente/externo intacto)', async () => {
        await runWithToolContext({ userId: '1' }, () =>
            executeTool('notify_person', { name: 'Cliente Externo', message: 'Oi', channels: ['whatsapp'], phone: '5511999998888' }));
        expect(mockDolibarr.getUserById).not.toHaveBeenCalled();
        expect(mockDolibarr.listUsers).not.toHaveBeenCalled();
        expect(mockNotifyPerson).toHaveBeenCalledWith(expect.objectContaining({ recipientPhone: '5511999998888' }));
    });

    it('whatsapp + in-app: a resolução também popula o recipient in-app', async () => {
        mockDolibarr.getUserById.mockResolvedValue({ id: '5', firstname: 'João', lastname: 'Silva', user_mobile: '11987654321' });
        await runWithToolContext({ userId: '1' }, () =>
            executeTool('notify_person', { name: 'João', recipient: '5', message: 'Oi', channels: ['whatsapp', 'in-app'] }));
        expect(mockNotifyPerson).toHaveBeenCalledWith(expect.objectContaining({ recipient: '5', recipientPhone: '11987654321' }));
    });
});
