import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';

// fs é mockado globalmente (setup.ts); mockamos atomicWrite p/ espiar a persistência.
vi.mock('../../utils/atomicWrite', () => ({ atomicWriteSync: vi.fn() }));
import { atomicWriteSync } from '../../utils/atomicWrite';

const mockedFs = vi.mocked(fs);
const mockedWrite = vi.mocked(atomicWriteSync);

import { UiConfigService } from '../../services/uiConfigService';

describe('uiConfigService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockedFs.existsSync.mockReturnValue(false); // padrão: sem arquivo
    });

    it('retorna defaults quando não há arquivo', () => {
        const svc = new UiConfigService('ui.json');
        expect(svc.get()).toEqual({
            companyName: 'CoolGroove',
            logoText: 'D',
            themeColor: 'indigo',
            menu: { hidden: [], order: [] },
            dashboard: { hidden: [], order: [] },
            screenPermissions: { groups: {}, users: {} },
            customPages: [],
        });
    });

    it('update aplica e persiste campos válidos', () => {
        const svc = new UiConfigService('ui.json');
        const out = svc.update({ companyName: 'ACME', logoText: 'A', themeColor: 'emerald' });
        expect(out.companyName).toBe('ACME');
        expect(out.logoText).toBe('A');
        expect(out.themeColor).toBe('emerald');
        expect(mockedWrite).toHaveBeenCalled();
    });

    it('rejeita themeColor fora da allowlist (mantém o atual)', () => {
        const svc = new UiConfigService('ui.json');
        const out = svc.update({ themeColor: 'hackcolor; content:url()' });
        expect(out.themeColor).toBe('indigo');
    });

    it('limita o tamanho de companyName/logoText', () => {
        const svc = new UiConfigService('ui.json');
        const out = svc.update({ companyName: 'x'.repeat(200), logoText: 'ABCDEFGHIJ' });
        expect(out.companyName.length).toBe(100);
        expect(out.logoText.length).toBe(8);
    });

    it('update sanitiza screenPermissions (#112)', () => {
        const svc = new UiConfigService('ui.json');
        const out = svc.update({
            screenPermissions: {
                groups: { '5': { hidden: ['invoices', 'invoices', ''], allowed: ['simulator'] } },
                users: { '12': { hidden: ['orders'] } as any },
            } as any,
        });
        expect(out.screenPermissions.groups['5']).toEqual({ hidden: ['invoices'], allowed: ['simulator'] });
        expect(out.screenPermissions.users['12']).toEqual({ hidden: ['orders'], allowed: [] });
        expect(mockedWrite).toHaveBeenCalled();
    });

    it('update sanitiza customPages (#113): slug seguro, embed só https, blocos válidos', () => {
        const svc = new UiConfigService('ui.json');
        const out = svc.update({
            customPages: [
                {
                    title: 'Portal RH', slug: 'Portal RH!!', icon: 'Users',
                    visibility: { groups: ['3'], users: [] },
                    blocks: [
                        { id: 'a', type: 'richtext', html: '<b>oi</b>' },
                        { id: 'b', type: 'embed', embedUrl: 'javascript:alert(1)', height: 99999 },
                        { id: 'c', type: 'embed', embedUrl: 'https://ok.com', height: 600 },
                        { id: 'd', type: 'links', links: [{ label: 'Site', url: 'https://x.com' }, { label: '', url: '' }] },
                        { type: 'invalid' },
                    ],
                },
                { title: '' }, // descartada (sem título)
            ],
        } as any);
        expect(out.customPages).toHaveLength(1);
        const page = out.customPages[0];
        expect(page.slug).toBe('portal-rh');
        expect(page.visibility).toEqual({ groups: ['3'], users: [] });
        // bloco embed inválido fica com url vazia; height limitado; bloco 'invalid' removido; link vazio removido
        expect(page.blocks.map((b) => b.type)).toEqual(['richtext', 'embed', 'embed', 'links']);
        expect(page.blocks[1].embedUrl).toBe('');
        expect(page.blocks[1].height).toBe(2000);
        expect(page.blocks[2].embedUrl).toBe('https://ok.com');
        expect(page.blocks[3].links).toHaveLength(1);
    });

    it('update aplica menu/dashboard (#110/#111)', () => {
        const svc = new UiConfigService('ui.json');
        const out = svc.update({ menu: { hidden: ['chat'], order: ['dashboard', 'agenda'] } });
        expect(out.menu).toEqual({ hidden: ['chat'], order: ['dashboard', 'agenda'] });
        expect(out.dashboard).toEqual({ hidden: [], order: [] }); // intacto
    });

    it('carrega do arquivo quando existe (preenche defaults faltantes)', () => {
        mockedFs.existsSync.mockReturnValue(true);
        mockedFs.readFileSync.mockReturnValue(JSON.stringify({ companyName: 'Loaded', themeColor: 'rose' }) as any);
        const svc = new UiConfigService('ui.json');
        expect(svc.get().companyName).toBe('Loaded');
        expect(svc.get().themeColor).toBe('rose');
        expect(svc.get().logoText).toBe('D'); // default preenchido
    });
});
