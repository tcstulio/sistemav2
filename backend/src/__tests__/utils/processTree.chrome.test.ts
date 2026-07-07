import { describe, it, expect } from 'vitest';
import { pickChromeProfileTargets } from '../../utils/processTree';

// #896/#1174 — o seletor de chromes por perfil é ESTRITO: chrome é o navegador PESSOAL do
// usuário; na dúvida NÃO mata (inverso do killOpencodeOrphans, onde over-matar é seguro).
describe('pickChromeProfileTargets (kill estrito por perfil do WhatsApp)', () => {
    const NEEDLE = '.wwebjs_auth\\session-v4_1747';
    const CL_ZUMBI = 'chrome.exe --headless=new --user-data-dir=C:\\Projetos\\sistemav2\\backend\\.wwebjs_auth\\session-v4_1747';
    const CL_PESSOAL = 'chrome.exe --user-data-dir=C:\\Users\\x\\AppData\\Local\\Google\\Chrome\\User Data';
    const CL_OUTRA_SESSAO = 'chrome.exe --user-data-dir=C:\\Projetos\\sistemav2\\backend\\.wwebjs_auth\\session-teste_4756';

    it('mata SÓ quem tem CommandLine casando o perfil da sessão', () => {
        const cls = new Map<number, string>([
            [10, CL_ZUMBI],        // zumbi do perfil → mata
            [20, CL_PESSOAL],      // navegador pessoal → NUNCA
            [30, CL_OUTRA_SESSAO], // outra sessão (pode estar ATIVA) → não
        ]);
        expect(pickChromeProfileTargets([10, 20, 30], cls, NEEDLE)).toEqual([10]);
    });

    it('CommandLine vazia/desconhecida → NÃO mata (estrito — inverso do opencode)', () => {
        const cls = new Map<number, string>([
            [10, ''],          // vazia → poupa
            [20, CL_ZUMBI],    // conhecida e casa → mata
        ]);
        // pid 30 nem está no Map (desconhecida) → poupa
        expect(pickChromeProfileTargets([10, 20, 30], cls, NEEDLE)).toEqual([20]);
    });

    it('WMI indisponível (cls null) → lista VAZIA (nada é morto)', () => {
        expect(pickChromeProfileTargets([10, 20], null, NEEDLE)).toEqual([]);
    });

    it('sem processos → vazio', () => {
        expect(pickChromeProfileTargets([], new Map(), NEEDLE)).toEqual([]);
    });
});
