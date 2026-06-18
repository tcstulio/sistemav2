import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';

vi.mock('fs');
vi.mock('../../utils/atomicWrite', () => ({ atomicWriteSync: vi.fn() }));
vi.mock('../../utils/crypto', () => ({
    encrypt: (v: string) => `enc:${v}`,
    decrypt: (v: string) => v.replace('enc:', ''),
    isEncrypted: (v: string) => v.startsWith('enc:'),
}));

const mockedFs = fs as any;

/** Recria o singleton do zero, opcionalmente com um arquivo já existente. */
async function freshStore(fileContent?: any) {
    vi.resetModules();
    vi.clearAllMocks();
    if (fileContent !== undefined) {
        mockedFs.existsSync.mockReturnValue(true);
        mockedFs.readFileSync.mockReturnValue(JSON.stringify(fileContent));
    } else {
        mockedFs.existsSync.mockReturnValue(false);
    }
    const aw = await import('../../utils/atomicWrite');
    const mod = await import('../../services/bankingCredentialsStore');
    return { store: mod.bankingCredentialsStore, atomicWriteSync: aw.atomicWriteSync as any };
}

describe('bankingCredentialsStore (#45)', () => {
    let store: any;
    let atomicWriteSync: any;

    beforeEach(async () => {
        ({ store, atomicWriteSync } = await freshStore());
    });

    it('cifra o clientSecret ao salvar e decifra só no getClientSecret (uso interno)', () => {
        store.setCredentials('inter', { clientId: 'cid', clientSecret: 'segredo', sandbox: true });
        expect(store.getClientSecret('inter')).toBe('segredo');
        expect(store.getClientId('inter')).toBe('cid');
        expect(store.getSandbox('inter')).toBe(true);
        // o que foi PERSISTIDO tem o secret cifrado (prefixo enc:)
        const persisted = atomicWriteSync.mock.calls.at(-1)[1];
        expect(persisted.inter.clientSecret).toBe('enc:segredo');
    });

    it('getStatus retorna só flags e NUNCA o secret', () => {
        store.setCredentials('inter', { clientId: 'cid', clientSecret: 'topsecret', sandbox: false });
        const status = store.getStatus('inter');
        expect(status).toMatchObject({ configured: true, hasClientId: true, hasClientSecret: true, environment: 'production' });
        expect(JSON.stringify(status)).not.toContain('topsecret');
        expect(status.clientSecret).toBeUndefined();
    });

    it('salvar sem clientSecret PRESERVA o secret existente', () => {
        store.setCredentials('itau', { clientId: 'c1', clientSecret: 'sec1' });
        store.setCredentials('itau', { clientId: 'c2' }); // sem secret
        expect(store.getClientId('itau')).toBe('c2');
        expect(store.getClientSecret('itau')).toBe('sec1');
    });

    it('persiste e expõe contaCorrente/agencia do Itaú', () => {
        store.setCredentials('itau', { contaCorrente: '12345', agencia: '0001' });
        expect(store.getContaCorrente('itau')).toBe('12345');
        expect(store.getAgencia('itau')).toBe('0001');
        expect(store.getStatus('itau').contaCorrente).toBe(true);
    });

    it('migra secret em claro para enc: na carga', async () => {
        const { store: s, atomicWriteSync: aw } = await freshStore({ inter: { clientId: 'x', clientSecret: 'plainSecret' } });
        expect(aw).toHaveBeenCalled(); // regravou cifrado
        expect(s.getClientSecret('inter')).toBe('plainSecret');
    });

    it('não re-cifra um secret já cifrado na carga', async () => {
        const { atomicWriteSync: aw } = await freshStore({ itau: { clientId: 'x', clientSecret: 'enc:already' } });
        expect(aw).not.toHaveBeenCalled();
    });

    it('clearCredentials remove o banco (volta ao fallback do .env)', () => {
        store.setCredentials('inter', { clientId: 'c', clientSecret: 's' });
        store.clearCredentials('inter');
        expect(store.getClientId('inter')).toBeUndefined();
        expect(store.getStatus('inter').configured).toBe(false);
    });
});
