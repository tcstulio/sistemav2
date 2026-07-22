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
