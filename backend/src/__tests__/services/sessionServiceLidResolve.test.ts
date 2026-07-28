import { describe, it, expect } from 'vitest';
import { vi } from 'vitest';

vi.mock('whatsapp-web.js', () => ({ Client: vi.fn(), LocalAuth: vi.fn(), MessageMedia: vi.fn() }));
vi.mock('qrcode', () => ({ toDataURL: vi.fn(async () => 'data:'), toString: vi.fn(async () => '') }));
vi.mock('../../services/socketService', () => ({ socketService: { emit: vi.fn() } }));
vi.mock('../../services/botService', () => ({ botService: { processMessage: vi.fn() } }));
vi.mock('../../utils/processTree', () => ({ killChromesByProfile: vi.fn(async () => {}) }));

import { sessionService } from '../../services/legacy/sessionService';
const svc = sessionService as any;

const mkMsg = (from: string, contact: any) => ({ from, getContact: async () => contact });

// Verificado ao vivo 22/07: um @lid do WhatsApp (ex.: 59936436445425@lid) carrega o número REAL
// em contact.id (_serialized="5511986781025@c.us" / user="5511986781025"), NÃO em contact.number
// (que devolve o próprio @lid). Antes o código usava contact.number → o funcionário nunca casava
// o cadastro Dolibarr → "Remetente não identificado".
describe('resolveRealSender — @lid resolve pro número REAL (contact.id)', () => {
    it('@lid: usa contact.id._serialized (número real @c.us), não o @lid de contact.number', async () => {
        const msg = mkMsg('59936436445425@lid', { number: '59936436445425', id: { _serialized: '5511986781025@c.us', user: '5511986781025' } });
        expect(await svc.resolveRealSender(msg)).toBe('5511986781025@c.us');
    });

    it('@lid sem _serialized @c.us: monta do id.user', async () => {
        const msg = mkMsg('59936436445425@lid', { number: '59936436445425', id: { user: '5511986781025' } });
        expect(await svc.resolveRealSender(msg)).toBe('5511986781025@c.us');
    });

    it('@lid fallback legado: só contact.number disponível → number@c.us', async () => {
        const msg = mkMsg('123@lid', { number: '5511999999999', id: {} });
        expect(await svc.resolveRealSender(msg)).toBe('5511999999999@c.us');
    });

    it('não-@lid: devolve msg.from inalterado (nem chama getContact)', async () => {
        const msg = mkMsg('5511986781025@c.us', null);
        expect(await svc.resolveRealSender(msg)).toBe('5511986781025@c.us');
    });

    it('getContact lança → devolve o from (@lid) inalterado (fail-safe, não quebra)', async () => {
        const msg = { from: '59936436445425@lid', getContact: async () => { throw new Error('boom'); } };
        expect(await svc.resolveRealSender(msg)).toBe('59936436445425@lid');
    });
});

// #1723 — id do payload do message_create: p/ @lid, msg.id._serialized vem UNDEFINED e o id real
// fica em $1. Sem fallback, o bot chamava getMessageMedia(undefined) → mídia nunca baixava.
describe('message_create payload id — @lid usa $1 quando _serialized é undefined', () => {
    it('id vem de msg.id.$1 quando _serialized é undefined (destrava mídia recebida)', async () => {
        const { botService } = await import('../../services/botService');
        (botService.processMessage as any).mockReset();
        (botService.processMessage as any).mockResolvedValue(undefined);
        vi.spyOn(svc, 'resolveRealSender').mockResolvedValue('5511986781025@c.us');
        vi.spyOn(svc, 'resolveSenderName').mockResolvedValue('Tulio');
        const handlers: Record<string, any> = {};
        const mockClient: any = { on: (ev: string, fn: any) => { handlers[ev] = fn; } };
        svc.setupEvents(mockClient, 'sess1');
        const msg: any = {
            from: '59936436445425@lid', to: 'me', body: '', fromMe: false,
            timestamp: 1700000000, hasMedia: true, type: 'image',
            id: { $1: 'false_59936436445425@lid_REALID' }, // @lid: sem _serialized
            _data: {},
        };
        await handlers['message_create'](msg);
        const payload = (botService.processMessage as any).mock.calls.at(-1)[0];
        expect(payload.id).toBe('false_59936436445425@lid_REALID'); // usou o $1 (antes: undefined)
    });

    it('id normal (@c.us) segue vindo de _serialized', async () => {
        const { botService } = await import('../../services/botService');
        (botService.processMessage as any).mockReset();
        (botService.processMessage as any).mockResolvedValue(undefined);
        vi.spyOn(svc, 'resolveRealSender').mockResolvedValue('5511@c.us');
        vi.spyOn(svc, 'resolveSenderName').mockResolvedValue('X');
        const handlers: Record<string, any> = {};
        const mockClient: any = { on: (ev: string, fn: any) => { handlers[ev] = fn; } };
        svc.setupEvents(mockClient, 'sess2');
        const msg: any = {
            from: '5511@c.us', to: 'me', body: 'oi', fromMe: false, timestamp: 1700000000,
            hasMedia: false, type: 'chat', id: { _serialized: 'false_5511@c.us_ABC' }, _data: {},
        };
        await handlers['message_create'](msg);
        const payload = (botService.processMessage as any).mock.calls.at(-1)[0];
        expect(payload.id).toBe('false_5511@c.us_ABC');
    });
});
