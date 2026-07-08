import { describe, it, expect } from 'vitest';
import {
    normalizePhone, getWhatsappAllowlist, whatsappDestinationAllowed,
    externalChannelsOf, phoneBelongsToUser, emailBelongsToUser, socidOf,
} from '../../utils/actionGuards';

describe('actionGuards (Fase A governança)', () => {
    it('normalizePhone: só dígitos', () => {
        expect(normalizePhone('+55 (11) 99999-8888')).toBe('5511999998888');
        expect(normalizePhone(null)).toBe('');
    });

    it('getWhatsappAllowlist: defensivo (bloco ausente = [], normaliza, descarta curtos)', () => {
        expect(getWhatsappAllowlist(undefined)).toEqual([]);
        expect(getWhatsappAllowlist({})).toEqual([]); // #1200 ainda não mergeou
        expect(getWhatsappAllowlist({ actionGovernance: { whatsappDestinationAllowlist: ['+55 11 99999-8888', 'x', '123'] } }))
            .toEqual(['5511999998888']); // 'x'→'' e '123' (<8) descartados
    });

    it('whatsappDestinationAllowed: VAZIA permite tudo; não-vazia exige match', () => {
        expect(whatsappDestinationAllowed('5511999998888', [])).toBe(true);              // default: permite tudo
        expect(whatsappDestinationAllowed('5511999998888', ['5511999998888'])).toBe(true);
        expect(whatsappDestinationAllowed('5511000000000', ['5511999998888'])).toBe(false);
        expect(whatsappDestinationAllowed('+55 11 99999-8888', ['5511999998888'])).toBe(true); // compara normalizado
    });

    it('externalChannelsOf: só whatsapp/email', () => {
        expect(externalChannelsOf(['in-app', 'whatsapp', 'email', 'sms'])).toEqual(['whatsapp', 'email']);
        expect(externalChannelsOf(['in-app'])).toEqual([]);
        expect(externalChannelsOf(undefined)).toEqual([]);
    });

    it('phoneBelongsToUser / emailBelongsToUser: casa por dígitos / case-insensitive', () => {
        const users = [{ user_mobile: '(11) 99999-8888', email: 'A@Coolgroove.com' }];
        expect(phoneBelongsToUser('5511999998888', users)).toBe(false); // match é EXATO por dígitos (13 ≠ 11)
        expect(phoneBelongsToUser('11999998888', users)).toBe(true);
        expect(phoneBelongsToUser('11000000000', users)).toBe(false);
        expect(emailBelongsToUser('a@coolgroove.com', users)).toBe(true);
        expect(emailBelongsToUser('b@x.com', users)).toBe(false);
    });

    it('socidOf: extrai cliente de invoice/order/proposal', () => {
        expect(socidOf({ socid: 42 })).toBe('42');
        expect(socidOf({ fk_soc: '7' })).toBe('7');
        expect(socidOf({ id: 1 })).toBeNull();
    });
});
