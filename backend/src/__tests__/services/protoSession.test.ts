/**
 * Testes do protoSession — persistência dos campos de contato (#1003).
 *
 * O userData é a fonte de `req.user` (spread em authMiddleware), que alimenta
 * GET /api/users/me. Antes desta correção, phone_mobile/user_mobile/fax/office_phone
 * eram descartados pelas whitelists fixas de createProtoSession/setProtoSessionUserData
 * — raiz do bug "celular não aparece". Aqui garantimos que eles atravessam.
 */
import { describe, it, expect, vi } from 'vitest';

// Mocks de I/O de disco para NUNCA tocar no proto_sessions.json real.
vi.mock('fs', () => ({
    default: {
        existsSync: () => false, // load() retorna cedo no boot
        readFileSync: () => '{}',
    },
}));
vi.mock('../../utils/atomicWrite', () => ({ atomicWriteSync: vi.fn() }));
vi.mock('../../utils/logger', () => ({
    createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import { createProtoSession, setProtoSessionUserData, getProtoSession } from '../../services/protoSession';

describe('protoSession — campos de contato (#1003)', () => {
    it('createProtoSession persiste phone_mobile/user_mobile/fax/office_phone', () => {
        const token = createProtoSession('tulio.silva', 'dolkey-abc', {
            id: 7,
            login: 'tulio.silva',
            firstname: 'Tulio',
            lastname: 'Silva',
            email: 'tulio@x.com',
            phone_mobile: '+55 11 99999-0000',
            user_mobile: '+5511999990000',
            fax: 'fax-1',
            office_phone: '+551133330000',
            // Campos que NÃO fazem parte do schema userData (não devem atravessar):
            api_key: 'NAO_DEVE_VAZAR',
            pass_crypted: 'segredo',
        });
        const s = getProtoSession(token);
        expect(s).not.toBeNull();
        expect(s!.userData!.phone_mobile).toBe('+55 11 99999-0000');
        expect(s!.userData!.user_mobile).toBe('+5511999990000');
        expect(s!.userData!.fax).toBe('fax-1');
        expect(s!.userData!.office_phone).toBe('+551133330000');
        expect(s!.userData).not.toHaveProperty('api_key');
        expect(s!.userData).not.toHaveProperty('pass_crypted');
    });

    it('setProtoSessionUserData copia phone_mobile (backfill do authMiddleware)', () => {
        const token = createProtoSession('jane', 'dolkey-jane', { id: 2, login: 'jane' });
        setProtoSessionUserData(token, {
            id: 2,
            login: 'jane',
            admin: '1' as unknown as boolean,
            phone_mobile: '+551188888000',
            user_mobile: '+551188888000',
            fax: undefined,
            office_phone: '+551133330000',
        });
        const s = getProtoSession(token);
        expect(s).not.toBeNull();
        expect(s!.userData!.phone_mobile).toBe('+551188888000');
        expect(s!.userData!.office_phone).toBe('+551133330000');
    });

    it('ausência dos campos não quebra (ficam undefined)', () => {
        const token = createProtoSession('nobody', 'dolkey-n', { id: 3, login: 'nobody' });
        const s = getProtoSession(token);
        expect(s).not.toBeNull();
        expect(s!.userData!.phone_mobile).toBeUndefined();
        expect(s!.userData!.user_mobile).toBeUndefined();
    });
});
