import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockDolibarr = vi.hoisted(() => ({
    listAllUsers: vi.fn(async (): Promise<any[]> => []),
    getThirdPartyByPhone: vi.fn(async (): Promise<any> => null),
}));
vi.mock('../../services/dolibarrService', () => ({ dolibarrService: mockDolibarr }));

import { whatsappIdentityService } from '../../services/whatsappIdentityService';

const USERS = [
    { id: 7, login: 'tulio', firstname: 'Túlio', lastname: 'Silva', statut: '1', user_mobile: '+55 11 98678-1025' },
    { id: 8, login: 'ana', firstname: 'Ana', lastname: '', statut: '1', phone_mobile: '11 91234-5678' },
    { id: 9, login: 'inativo', firstname: 'Ex', lastname: 'Func', statut: '0', user_mobile: '11 99999-0000' },
];

describe('whatsappIdentityService.identifySender', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        whatsappIdentityService.clearCache();
        mockDolibarr.listAllUsers.mockResolvedValue(USERS);
        mockDolibarr.getThirdPartyByPhone.mockResolvedValue(null);
    });

    it('identifica funcionário por user_mobile pelo número COMPLETO (normaliza +/espaço/DDI)', async () => {
        const id = await whatsappIdentityService.identifySender('5511986781025@c.us');
        expect(id).toEqual({ kind: 'employee', userId: '7', displayName: 'Túlio Silva', matchStrength: 'full' });
    });

    it('identifica funcionário por phone_mobile (BR sem DDI no cadastro normaliza p/ 55)', async () => {
        const id = await whatsappIdentityService.identifySender('5511912345678@c.us');
        expect(id).toEqual({ kind: 'employee', userId: '8', displayName: 'Ana', matchStrength: 'full' });
    });

    it('usuário INATIVO (statut 0) não conta como funcionário', async () => {
        const id = await whatsappIdentityService.identifySender('5511999990000@c.us');
        expect(id.kind).not.toBe('employee');
    });

    it('match ambíguo (2 usuários com o mesmo sufixo) ⇒ fail-closed, não é funcionário', async () => {
        mockDolibarr.listAllUsers.mockResolvedValue([
            { id: 1, statut: '1', user_mobile: '11 98678-1025' },
            { id: 2, statut: '1', phone_mobile: '+55 11 98678 1025' },
        ]);
        const id = await whatsappIdentityService.identifySender('5511986781025@c.us');
        expect(id.kind).not.toBe('employee');
    });

    it('funcionário tem precedência sobre cliente com o mesmo telefone', async () => {
        mockDolibarr.getThirdPartyByPhone.mockResolvedValue({ id: 42, name: 'ACME' });
        const id = await whatsappIdentityService.identifySender('5511986781025@c.us');
        expect(id.kind).toBe('employee');
    });

    it('cliente via getThirdPartyByPhone quando não é funcionário', async () => {
        mockDolibarr.getThirdPartyByPhone.mockResolvedValue({ id: 42, name: 'ACME' });
        const id = await whatsappIdentityService.identifySender('5511900001111@c.us');
        expect(id).toEqual({ kind: 'customer', thirdpartyId: '42', name: 'ACME' });
    });

    it('@lid não resolvido ⇒ unknown sem consultar o Dolibarr (fail-closed)', async () => {
        const id = await whatsappIdentityService.identifySender('59936436445425@lid');
        expect(id).toEqual({ kind: 'unknown' });
        expect(mockDolibarr.listAllUsers).not.toHaveBeenCalled();
        expect(mockDolibarr.getThirdPartyByPhone).not.toHaveBeenCalled();
    });

    it('grupo, vazio e undefined ⇒ unknown', async () => {
        expect(await whatsappIdentityService.identifySender('123456-789@g.us')).toEqual({ kind: 'unknown' });
        expect(await whatsappIdentityService.identifySender('')).toEqual({ kind: 'unknown' });
        expect(await whatsappIdentityService.identifySender(undefined)).toEqual({ kind: 'unknown' });
    });

    it('número curto demais (<8 dígitos) ⇒ unknown', async () => {
        expect(await whatsappIdentityService.identifySender('1234567@c.us')).toEqual({ kind: 'unknown' });
        expect(mockDolibarr.listAllUsers).not.toHaveBeenCalled();
    });

    it('cacheia o resultado por telefone: 2ª chamada não reconsulta o Dolibarr', async () => {
        await whatsappIdentityService.identifySender('5511986781025@c.us');
        await whatsappIdentityService.identifySender('5511986781025@c.us');
        expect(mockDolibarr.listAllUsers).toHaveBeenCalledTimes(1);
    });

    it('lista de usuários vazia (falha transitória) não vira cache de lista: outro fone reconsulta', async () => {
        mockDolibarr.listAllUsers.mockResolvedValue([]);
        const id = await whatsappIdentityService.identifySender('5511986781025@c.us');
        expect(id.kind).toBe('unknown');
        await whatsappIdentityService.identifySender('5511912345678@c.us');
        expect(mockDolibarr.listAllUsers).toHaveBeenCalledTimes(2);
    });

    it('erro no lookup de cliente ⇒ unknown (não explode)', async () => {
        mockDolibarr.getThirdPartyByPhone.mockRejectedValue(new Error('Dolibarr caiu'));
        const id = await whatsappIdentityService.identifySender('5511900001111@c.us');
        expect(id).toEqual({ kind: 'unknown' });
    });

    // #segurança — a elevação exige o número COMPLETO (E.164), não os 8 dígitos finais.
    describe('anti-spoof: só o número completo eleva (sufixo-8 não basta)', () => {
        it('mesmo sufixo-8 mas DDD diferente (5521…) ⇒ NÃO é funcionário', async () => {
            // id 7 é 5511986781025; este é 5521986781025 (DDD 21) — mesmos 8 finais 86781025.
            const id = await whatsappIdentityService.identifySender('5521986781025@c.us');
            expect(id.kind).not.toBe('employee');
        });

        it('mesmo sufixo-8 mas DDI estrangeiro ⇒ NÃO é funcionário', async () => {
            // 1 999 86781025 (11 díg começando por 1, não-BR) — mesmos 8 finais que o dono.
            const id = await whatsappIdentityService.identifySender('19998678 1025'.replace(/\s/g, '') + '@c.us');
            expect(id.kind).not.toBe('employee');
        });

        it('spoof com mesmo sufixo NÃO herda a identidade do cache do número verdadeiro', async () => {
            // 1º: número verdadeiro do dono ⇒ employee (cacheado pelo número COMPLETO)
            const real = await whatsappIdentityService.identifySender('5511986781025@c.us');
            expect(real.kind).toBe('employee');
            // 2º: spoof com o mesmo sufixo-8 (DDD 21) NÃO pode cair no cache do verdadeiro
            const spoof = await whatsappIdentityService.identifySender('5521986781025@c.us');
            expect(spoof.kind).not.toBe('employee');
        });

        it('número completo com + e espaços normaliza e eleva (matchStrength full)', async () => {
            const id = await whatsappIdentityService.identifySender('5511986781025@c.us');
            expect(id).toMatchObject({ kind: 'employee', userId: '7', matchStrength: 'full' });
        });
    });
});
