import type { Page, BrowserContext } from '@playwright/test';

/**
 * Harness de RENDER DETERMINÍSTICO.
 *
 * Ideia: renderizar uma tela real do app com dados que NÓS controlamos (vazio ou mockado),
 * interceptando TODA a rede — sem backend nem Dolibarr reais. Como o dado é conhecido, a saída é
 * verificável (visual E por asserção): é o oráculo de corretude. Roda na CI com zero infra.
 *
 * Duas peças:
 *  - seedAuth: semeia a sessão (currentUser admin) em localStorage['coolgroove_config'] ANTES do
 *    1º paint (via addInitScript) → o app não cai na tela de login.
 *  - stubNetwork: intercepta '/api/**' e devolve fixtures determinísticos. Os dados do Dolibarr
 *    (custom_sync?type=<entidade> ou /api/dolibarr/<entidade>) vêm de `dolibarrByType`; ui-config
 *    volta um default; qualquer outra chamada volta vazia (a tela renderiza sem backend real).
 */

export interface SeedOptions {
    /** admin=1 vê tudo (default). Para testar recorte por papel, passe rights/admin custom no futuro. */
    admin?: 0 | 1;
}

export async function seedAuth(context: BrowserContext, opts: SeedOptions = {}): Promise<void> {
    const admin = opts.admin ?? 1;
    await context.addInitScript((adminFlag) => {
        try {
            window.localStorage.setItem('coolgroove_config', JSON.stringify({
                apiKey: 'render-harness-key',
                apiUrl: 'https://sistema.coolgroove.com.br/api/index.php',
                currentUser: { id: '1', login: 'admin', admin: adminFlag, firstname: 'Render', lastname: 'Harness' },
                companyName: 'CoolGroove',
            }));
        } catch { /* storage bloqueado — ignora */ }
    }, admin);
}

export async function stubNetwork(page: Page, dolibarrByType: Record<string, unknown[]>): Promise<void> {
    // Predicado por PATHNAME: só chamadas reais de API (`/api/...`). NÃO casar `**/api/**` como glob —
    // isso pegaria os módulos-fonte do vite (`/src/services/api/core.ts`) e devolveria JSON no lugar
    // do script → o app não carrega (tela branca).
    await page.route((u) => u.pathname.startsWith('/api/'), (route) => {
        const url = route.request().url();
        const json = (body: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

        // Dados do Dolibarr: custom_sync?type=<entidade>  OU  /api/dolibarr/<entidade>
        if (/custom_sync|\/dolibarr\//i.test(url)) {
            const m = url.match(/[?&]type=([a-z_]+)/i) || url.match(/\/dolibarr\/([a-z_]+)/i);
            const type = m ? m[1].toLowerCase() : '';
            return json(dolibarrByType[type] ?? []);
        }
        // Config de UI: default mínimo (branding + permissões vazias = admin vê tudo).
        if (/ui-config/i.test(url)) {
            return json({ companyName: 'CoolGroove', taskAutomation: {}, screenPermissions: { groups: {}, users: {} } });
        }
        // Qualquer outra chamada /api (notifications, tasks, sessão…): vazia e benigna.
        return json([]);
    });
}
