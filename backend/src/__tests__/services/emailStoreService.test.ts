import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';

vi.mock('fs');
vi.mock('../../utils/atomicWrite', () => ({
    atomicWriteSync: vi.fn(),
}));

vi.mock('../../utils/crypto', () => ({
    encrypt: (v: string) => `enc:${v}`,
    decrypt: (v: string) => v.replace('enc:', ''),
    isEncrypted: (v: string) => v.startsWith('enc:'),
}));

const mockedFs = (fs as any);

describe('emailStoreService', () => {
    let emailStoreService: any;

    beforeEach(async () => {
        vi.clearAllMocks();
        vi.resetModules();
        mockedFs.existsSync.mockReturnValue(false);
        const mod = await import('../../services/emailStoreService');
        emailStoreService = mod.emailStoreService;
    });

    const makeAccount = (overrides: any = {}) => ({
        id: 'acc_1',
        name: 'Test Account',
        email: 'test@example.com',
        imapHost: 'imap.example.com',
        imapPort: 993,
        imapUser: 'test@example.com',
        imapPassword: 'plainpass',
        imapTls: true,
        smtpHost: 'smtp.example.com',
        smtpPort: 465,
        smtpUser: 'test@example.com',
        smtpPassword: 'smtppass',
        smtpSecure: true,
        ...overrides,
    });

    describe('constructor / load', () => {
        it('creates data dir on module load', () => {
            expect(mockedFs.mkdirSync).toHaveBeenCalledWith(expect.any(String), { recursive: true });
        });

        it('loads accounts and metadata from files', async () => {
            vi.clearAllMocks();
            vi.resetModules();

            mockedFs.existsSync.mockReturnValue(true);

            const accountData = [makeAccount({ imapPassword: 'enc:mypass', smtpPassword: 'enc:smtpass' })];
            const metadata = { assignments: { t1: 'u1' }, threadSettings: {}, userSettings: {}, templates: [] };

            mockedFs.readFileSync
                .mockReturnValueOnce(JSON.stringify(accountData))
                .mockReturnValueOnce(JSON.stringify(metadata));

            const mod = await import('../../services/emailStoreService');
            const svc = mod.emailStoreService;

            expect(svc.getAccount('acc_1')).toBeDefined();
            expect(svc.getAssignment('t1')).toBe('u1');
        });

        it('handles load error for accounts', async () => {
            vi.clearAllMocks();
            vi.resetModules();

            mockedFs.existsSync.mockReturnValue(true);
            mockedFs.readFileSync
                .mockImplementationOnce(() => { throw new Error('fail'); })
                .mockReturnValueOnce(JSON.stringify({}));

            const mod = await import('../../services/emailStoreService');
            const svc = mod.emailStoreService;
            expect(svc.getAllAccounts()).toEqual([]);
        });

        it('handles load error for metadata', async () => {
            vi.clearAllMocks();
            vi.resetModules();

            mockedFs.existsSync.mockReturnValue(true);
            mockedFs.readFileSync
                .mockReturnValueOnce(JSON.stringify([]))
                .mockImplementationOnce(() => { throw new Error('fail'); });

            const mod = await import('../../services/emailStoreService');
            const svc = mod.emailStoreService;
            expect(svc.getAssignment('any')).toBeUndefined();
        });

        it('migrates plain-text passwords on load', async () => {
            vi.clearAllMocks();
            vi.resetModules();

            mockedFs.existsSync.mockReturnValue(true);

            const accountData = [makeAccount({ imapPassword: 'plainpass', smtpPassword: 'plainpass' })];
            mockedFs.readFileSync
                .mockReturnValueOnce(JSON.stringify(accountData))
                .mockReturnValueOnce(JSON.stringify({ assignments: {}, threadSettings: {}, userSettings: {}, templates: [] }));

            const { atomicWriteSync } = await import('../../utils/atomicWrite');
            const mod = await import('../../services/emailStoreService');
            const svc = mod.emailStoreService;

            expect(atomicWriteSync).toHaveBeenCalled();
            const accounts = svc.getAllAccounts();
            expect(accounts[0].imapPassword).toBe('plainpass');
        });

        it('does not migrate already encrypted passwords', async () => {
            vi.clearAllMocks();
            vi.resetModules();

            mockedFs.existsSync.mockReturnValue(true);

            const accountData = [makeAccount({ imapPassword: 'enc:already', smtpPassword: 'enc:already2' })];
            mockedFs.readFileSync
                .mockReturnValueOnce(JSON.stringify(accountData))
                .mockReturnValueOnce(JSON.stringify({ assignments: {}, threadSettings: {}, userSettings: {}, templates: [] }));

            const { atomicWriteSync } = await import('../../utils/atomicWrite');
            const mod = await import('../../services/emailStoreService');
            const svc = mod.emailStoreService;

            expect(atomicWriteSync).not.toHaveBeenCalled();
        });

        it('skips migration when password is empty', async () => {
            vi.clearAllMocks();
            vi.resetModules();

            mockedFs.existsSync.mockReturnValue(true);

            const accountData = [makeAccount({ imapPassword: '', smtpPassword: '' })];
            mockedFs.readFileSync
                .mockReturnValueOnce(JSON.stringify(accountData))
                .mockReturnValueOnce(JSON.stringify({ assignments: {}, threadSettings: {}, userSettings: {}, templates: [] }));

            const { atomicWriteSync } = await import('../../utils/atomicWrite');
            const mod = await import('../../services/emailStoreService');
            const svc = mod.emailStoreService;

            expect(atomicWriteSync).not.toHaveBeenCalled();
        });
    });

    describe('getAllAccounts', () => {
        it('returns empty array initially', () => {
            expect(emailStoreService.getAllAccounts()).toEqual([]);
        });

        it('returns decrypted accounts', () => {
            emailStoreService.addAccount(makeAccount({ id: 'a1' }));
            const accounts = emailStoreService.getAllAccounts();
            expect(accounts).toHaveLength(1);
            expect(accounts[0].imapPassword).toBe('plainpass');
            expect(accounts[0].smtpPassword).toBe('smtppass');
        });
    });

    describe('getAccount', () => {
        it('returns undefined for non-existent account', () => {
            expect(emailStoreService.getAccount('nonexistent')).toBeUndefined();
        });

        it('returns decrypted account', () => {
            emailStoreService.addAccount(makeAccount({ id: 'a1' }));
            const acc = emailStoreService.getAccount('a1');
            expect(acc).toBeDefined();
            expect(acc.imapPassword).toBe('plainpass');
        });
    });

    describe('addAccount', () => {
        it('adds account and returns id', () => {
            const id = emailStoreService.addAccount(makeAccount({ id: 'myacc' }));
            expect(id).toBe('myacc');
            expect(emailStoreService.getAccount('myacc')).toBeDefined();
        });

        it('generates id when not provided', () => {
            const id = emailStoreService.addAccount(makeAccount({ id: '' }));
            expect(id).toMatch(/^acc_/);
        });

        it('throws on duplicate id', () => {
            emailStoreService.addAccount(makeAccount({ id: 'dup' }));
            expect(() => emailStoreService.addAccount(makeAccount({ id: 'dup' }))).toThrow('Account ID already exists');
        });
    });

    describe('updateAccount', () => {
        it('updates account fields', () => {
            emailStoreService.addAccount(makeAccount({ id: 'a1' }));
            emailStoreService.updateAccount('a1', { name: 'Updated' });
            expect(emailStoreService.getAccount('a1').name).toBe('Updated');
        });

        it('throws for non-existent account', () => {
            expect(() => emailStoreService.updateAccount('nonexistent', { name: 'X' })).toThrow('Account not found');
        });

        it('encrypts new passwords on update', () => {
            emailStoreService.addAccount(makeAccount({ id: 'a1', imapPassword: 'enc:old', smtpPassword: 'enc:old' }));
            emailStoreService.updateAccount('a1', { imapPassword: 'newplain' });
            const acc = emailStoreService.getAllAccounts().find((a: any) => a.id === 'a1');
            expect(acc.imapPassword).toBe('newplain');
        });
    });

    describe('deleteAccount', () => {
        it('removes account', () => {
            emailStoreService.addAccount(makeAccount({ id: 'a1' }));
            emailStoreService.deleteAccount('a1');
            expect(emailStoreService.getAccount('a1')).toBeUndefined();
        });

        it('does nothing for non-existent account', () => {
            emailStoreService.deleteAccount('nonexistent');
        });
    });

    describe('assignThread', () => {
        it('assigns thread to user', () => {
            emailStoreService.assignThread('t1', 'u1');
            expect(emailStoreService.getAssignment('t1')).toBe('u1');
        });

        it('removes assignment when userId is null', () => {
            emailStoreService.assignThread('t1', 'u1');
            emailStoreService.assignThread('t1', null);
            expect(emailStoreService.getAssignment('t1')).toBeUndefined();
        });
    });

    describe('updateThreadSettings / getThreadSettings', () => {
        it('returns empty object for unknown thread', () => {
            expect(emailStoreService.getThreadSettings('unknown')).toEqual({});
        });

        it('updates and retrieves thread settings', () => {
            emailStoreService.updateThreadSettings('t1', { autoReply: true });
            expect(emailStoreService.getThreadSettings('t1')).toEqual({ autoReply: true });
        });

        it('merges thread settings', () => {
            emailStoreService.updateThreadSettings('t1', { key1: 'val1' });
            emailStoreService.updateThreadSettings('t1', { key2: 'val2' });
            expect(emailStoreService.getThreadSettings('t1')).toEqual({ key1: 'val1', key2: 'val2' });
        });
    });

    describe('updateUserSettings / getUserSettings', () => {
        it('returns empty object for unknown user', () => {
            expect(emailStoreService.getUserSettings('unknown')).toEqual({});
        });

        it('updates and retrieves user settings', () => {
            emailStoreService.updateUserSettings('u1', { signature: 'Sig', pollInterval: 30 });
            expect(emailStoreService.getUserSettings('u1')).toEqual({ signature: 'Sig', pollInterval: 30 });
        });

        it('merges user settings', () => {
            emailStoreService.updateUserSettings('u1', { signature: 'Sig' });
            emailStoreService.updateUserSettings('u1', { pollInterval: 60 });
            expect(emailStoreService.getUserSettings('u1')).toEqual({ signature: 'Sig', pollInterval: 60 });
        });
    });

    describe('templates', () => {
        it('returns empty templates initially', () => {
            expect(emailStoreService.getTemplates()).toEqual([]);
        });

        it('adds a template', () => {
            const id = emailStoreService.addTemplate({
                name: 'Welcome',
                subject: 'Hello',
                body: 'Welcome!',
                createdBy: 'admin',
            });
            expect(id).toMatch(/^tpl_/);
            const templates = emailStoreService.getTemplates();
            expect(templates).toHaveLength(1);
            expect(templates[0].name).toBe('Welcome');
            expect(templates[0].createdAt).toBeDefined();
            expect(templates[0].updatedAt).toBeDefined();
        });

        it('updates a template', () => {
            const id = emailStoreService.addTemplate({
                name: 'Welcome',
                subject: 'Hello',
                body: 'Welcome!',
                createdBy: 'admin',
            });
            emailStoreService.updateTemplate(id, { name: 'Updated', body: 'New body' });
            const tpl = emailStoreService.getTemplates().find((t: any) => t.id === id);
            expect(tpl.name).toBe('Updated');
            expect(tpl.body).toBe('New body');
            expect(tpl.subject).toBe('Hello');
            expect(tpl.updatedAt).toBeDefined();
        });

        it('throws when updating non-existent template', () => {
            expect(() => emailStoreService.updateTemplate('nonexistent', { name: 'X' })).toThrow('Template not found');
        });

        it('deletes a template', () => {
            const id = emailStoreService.addTemplate({
                name: 'Delete Me',
                subject: 'Bye',
                body: 'Goodbye',
                createdBy: 'admin',
            });
            emailStoreService.deleteTemplate(id);
            expect(emailStoreService.getTemplates()).toHaveLength(0);
        });

        it('deleteTemplate does nothing for non-existent template', () => {
            emailStoreService.deleteTemplate('nonexistent');
        });

        it('handles null templates array on addTemplate', async () => {
            vi.clearAllMocks();
            vi.resetModules();
            mockedFs.existsSync.mockReturnValue(false);
            const mod = await import('../../services/emailStoreService');
            const svc = mod.emailStoreService;
            (svc as any).metadata.templates = null as any;
            const id = svc.addTemplate({ name: 'T', subject: 'S', body: 'B', createdBy: 'u' });
            expect(id).toMatch(/^tpl_/);
        });

        it('getTemplates returns empty array when templates is null', async () => {
            vi.clearAllMocks();
            vi.resetModules();
            mockedFs.existsSync.mockReturnValue(false);
            const mod = await import('../../services/emailStoreService');
            const svc = mod.emailStoreService;
            (svc as any).metadata.templates = null as any;
            expect(svc.getTemplates()).toEqual([]);
        });

        it('updateTemplate returns early if templates is null', async () => {
            vi.clearAllMocks();
            vi.resetModules();
            mockedFs.existsSync.mockReturnValue(false);
            const mod = await import('../../services/emailStoreService');
            const svc = mod.emailStoreService;
            (svc as any).metadata.templates = null as any;
            svc.updateTemplate('any', { name: 'X' });
        });

        it('deleteTemplate returns early if templates is null', async () => {
            vi.clearAllMocks();
            vi.resetModules();
            mockedFs.existsSync.mockReturnValue(false);
            const mod = await import('../../services/emailStoreService');
            const svc = mod.emailStoreService;
            (svc as any).metadata.templates = null as any;
            svc.deleteTemplate('any');
        });
    });

    describe('decryptAccount with empty passwords', () => {
        it('handles empty imapPassword', () => {
            emailStoreService.addAccount(makeAccount({ id: 'a1', imapPassword: '', smtpPassword: '' }));
            const acc = emailStoreService.getAccount('a1');
            expect(acc.imapPassword).toBe('');
            expect(acc.smtpPassword).toBe('');
        });
    });

    describe('encryptPasswords with already encrypted', () => {
        it('does not re-encrypt already encrypted passwords', () => {
            emailStoreService.addAccount(makeAccount({ id: 'a1', imapPassword: 'enc:already', smtpPassword: 'enc:already2' }));
            const acc = emailStoreService.getAccount('a1');
            expect(acc.imapPassword).toBe('already');
            expect(acc.smtpPassword).toBe('already2');
        });
    });
});
