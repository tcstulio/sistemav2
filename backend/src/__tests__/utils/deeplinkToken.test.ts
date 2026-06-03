import { describe, it, expect, vi } from 'vitest';

vi.mock('../../config/env', () => ({
    config: { deeplinkSecret: 'test-secret-deeplink-1234567890' },
}));

import { signDeeplink, verifyDeeplink } from '../../utils/deeplinkToken';

describe('deeplinkToken (HMAC HITL #57 Peça 2)', () => {
    it('assina e verifica (roundtrip) preservando os dados', () => {
        const token = signDeeplink('create_ticket', { subject: 'X', message: 'Y', socid: '42' }, 600);
        const payload = verifyDeeplink<{ subject: string; message: string; socid: string }>(token, 'create_ticket');
        expect(payload).not.toBeNull();
        expect(payload!.kind).toBe('create_ticket');
        expect(payload!.data.subject).toBe('X');
        expect(payload!.data.message).toBe('Y');
        expect(payload!.data.socid).toBe('42');
        expect(payload!.exp).toBeGreaterThan(payload!.iat);
    });

    it('rejeita quando o kind não confere', () => {
        const token = signDeeplink('create_ticket', { a: 1 });
        expect(verifyDeeplink(token, 'create_invoice')).toBeNull();
    });

    it('rejeita token adulterado (assinatura inválida)', () => {
        const token = signDeeplink('create_ticket', { subject: 'orig' });
        const [body, sig] = token.split('.');
        const tampered = `${body.slice(0, -2)}XX.${sig}`;
        expect(verifyDeeplink(tampered, 'create_ticket')).toBeNull();
    });

    it('rejeita token expirado', () => {
        const token = signDeeplink('create_ticket', { a: 1 }, -10); // exp no passado
        expect(verifyDeeplink(token, 'create_ticket')).toBeNull();
    });

    it('rejeita entradas malformadas', () => {
        expect(verifyDeeplink('garbage', 'create_ticket')).toBeNull();
        expect(verifyDeeplink('', 'create_ticket')).toBeNull();
        expect(verifyDeeplink('semponto', 'create_ticket')).toBeNull();
        expect(verifyDeeplink('.', 'create_ticket')).toBeNull();
    });
});
