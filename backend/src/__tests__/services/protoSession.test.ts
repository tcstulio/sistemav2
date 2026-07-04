/**
 * Testes do cofre de sessões (protoSession) — #1003.
 * Garante que phone_mobile/user_mobile/fax do usuário Dolibarr são persistidos
 * no userData da sessão, base do endpoint GET /api/users/me. Sem isto o celular
 * do usuário logado era descartado no login/backfill.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';

vi.mock('fs');
vi.mock('../../utils/atomicWrite', () => ({
    atomicWriteSync: vi.fn(),
}));
vi.mock('../../utils/logger', () => ({
    createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

const mockedFs = vi.mocked(fs);

describe('protoSession — persistência de phone_mobile (#1003)', () => {
    let protoSession: typeof import('../../services/protoSession');

    beforeEach(async () => {
        vi.clearAllMocks();
        vi.resetModules();
        // Nada carregado do disco no boot.
        mockedFs.existsSync.mockReturnValue(false);

        protoSession = await import('../../services/protoSession');
    });

    it('createProtoSession persiste phone_mobile/user_mobile/fax no userData', () => {
        const token = protoSession.createProtoSession('tulio.silva', 'DOLAPIKEY-X', {
            id: 17,
            login: 'tulio.silva',
            firstname: 'Tulio',
            lastname: 'Silva',
            email: 'tulio@x.com',
            job: 'Produtor',
            admin: '0',
            phone_mobile: '+55 11 99999-0000',
            user_mobile: '+55 11 99999-0000',
            fax: '+55 11 3333-0001',
            office_phone: '+55 11 3333-0000',
            photo: 'pic.jpg',
        });

        const s = protoSession.getProtoSession(token);
        expect(s).not.toBeNull();
        expect(s!.userData?.phone_mobile).toBe('+55 11 99999-0000');
        expect(s!.userData?.user_mobile).toBe('+55 11 99999-0000');
        expect(s!.userData?.fax).toBe('+55 11 3333-0001');
        expect(s!.userData?.office_phone).toBe('+55 11 3333-0000');
    });

    it('getProtoSession expõe o celular que o /me consome', () => {
        const token = protoSession.createProtoSession('ana', 'DOLAPIKEY-Y', {
            id: 9,
            login: 'ana',
            phone_mobile: '11988887777',
        });
        const s = protoSession.getProtoSession(token);
        const mobile = s!.userData?.phone_mobile || s!.userData?.user_mobile || null;
        expect(mobile).toBe('11988887777');
    });

    it('setProtoSessionUserData (backfill do middleware) copia os campos de celular', () => {
        // Sessão criada sem celular (ex.: getUserByKey falhou no login).
        const token = protoSession.createProtoSession('bob', 'DOLAPIKEY-Z', { id: 3, login: 'bob' });
        expect(protoSession.getProtoSession(token)!.userData?.phone_mobile).toBeUndefined();

        // Backfill posterior traz o perfil completo do Dolibarr.
        protoSession.setProtoSessionUserData(token, {
            id: 3,
            login: 'bob',
            user_mobile: '11977776666',
            fax: '1133334444',
        });

        const s = protoSession.getProtoSession(token);
        expect(s!.userData?.user_mobile).toBe('11977776666');
        expect(s!.userData?.fax).toBe('1133334444');
    });

    it('getProtoSession rejeita tokens fora do formato sess_', () => {
        expect(protoSession.getProtoSession('not-a-session')).toBeNull();
        expect(protoSession.getProtoSession('')).toBeNull();
    });
});
