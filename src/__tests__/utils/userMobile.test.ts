import { describe, it, expect } from 'vitest';
import { resolveUserMobile } from '../../utils/userMobile';

describe('resolveUserMobile', () => {
    it('prioriza phone_mobile', () => {
        expect(resolveUserMobile({ phone_mobile: '+5511999990000', user_mobile: '+551188880000' }))
            .toBe('+5511999990000');
    });

    it('cai para user_mobile quando phone_mobile esta vazio', () => {
        expect(resolveUserMobile({ phone_mobile: '', user_mobile: '+5511999990000' }))
            .toBe('+5511999990000');
    });

    it('cai para user_mobile quando phone_mobile e null', () => {
        expect(resolveUserMobile({ phone_mobile: null, user_mobile: '+5511999990000' }))
            .toBe('+5511999990000');
    });

    it('usa user_mobile quando phone_mobile esta ausente', () => {
        expect(resolveUserMobile({ user_mobile: '+5511999990000' })).toBe('+5511999990000');
    });

    it('retorna undefined quando ambos estao vazios/ausentes', () => {
        expect(resolveUserMobile({ phone_mobile: '', user_mobile: '' })).toBeUndefined();
        expect(resolveUserMobile({})).toBeUndefined();
        expect(resolveUserMobile(null)).toBeUndefined();
        expect(resolveUserMobile(undefined)).toBeUndefined();
    });

    it('faz trim do valor', () => {
        expect(resolveUserMobile({ phone_mobile: '  +55 11 99999-0000  ' }))
            .toBe('+55 11 99999-0000');
    });
});
