import { describe, beforeEach, it, expect } from 'vitest';
import { absolutizeLinksForWhatsApp } from '../../services/botService';

const B = 'https://app.coolgroove.com.br';

describe('absolutizeLinksForWhatsApp — links da resposta do WhatsApp', () => {
    it('link markdown relativo com label = id → só a URL pelada (sem redundância)', () => {
        expect(absolutizeLinksForWhatsApp('[65944](/agenda/65944)')).toBe(`${B}/agenda/65944`);
    });

    it('link markdown relativo com label de texto → "label: URL pelada"', () => {
        expect(absolutizeLinksForWhatsApp('[Ver proposta 303](/propostas/303)')).toBe(
            `Ver proposta 303: ${B}/propostas/303`,
        );
    });

    it('link markdown já absoluto → mantém label útil + URL pelada', () => {
        expect(absolutizeLinksForWhatsApp('[Abrir](https://app.coolgroove.com.br/agenda/1)')).toBe(
            `Abrir: ${B}/agenda/1`,
        );
    });

    it('caminho relativo SOLTO (fora de markdown) → absoluto', () => {
        expect(absolutizeLinksForWhatsApp('veja /faturas/12 aqui')).toBe(`veja ${B}/faturas/12 aqui`);
    });

    it('URL já pelada absoluta permanece intacta (idempotente)', () => {
        expect(absolutizeLinksForWhatsApp('abre https://app.coolgroove.com.br/x')).toBe(
            `abre ${B}/x`,
        );
    });

    it('linha de tabela real (o caso que o dono reportou) fica clicável no WhatsApp', () => {
        const inp = '| 1 | Pole Dance Divas 2 | [65944](/agenda/65944) | 30/11 |';
        expect(absolutizeLinksForWhatsApp(inp)).toBe(
            `| 1 | Pole Dance Divas 2 | ${B}/agenda/65944 | 30/11 |`,
        );
    });

    it('respeita FRONTEND_URL customizado e remove barra final', () => {
        // label "x" não é o id "9", então é mantido; a base perde a barra final
        expect(absolutizeLinksForWhatsApp('[x](/agenda/9)', 'https://meu.host/')).toBe(
            'x: https://meu.host/agenda/9',
        );
        // label = id → só a URL
        expect(absolutizeLinksForWhatsApp('[9](/agenda/9)', 'https://meu.host/')).toBe(
            'https://meu.host/agenda/9',
        );
    });

    it('não quebra texto sem links', () => {
        expect(absolutizeLinksForWhatsApp('oi, sem links aqui')).toBe('oi, sem links aqui');
    });

    it('string vazia passa incólume', () => {
        expect(absolutizeLinksForWhatsApp('')).toBe('');
    });
});

// A suite importa botService, que importa config/env, que roda dotenv.config() e lê o
// `.env` do disco. Numa máquina com FRONTEND_URL setado (todo ambiente real tem), a base
// deixava de ser o default e 4 testes quebravam — sem nenhuma mudança de código. Na CI não
// há `.env`, então isso só aparecia localmente. Fixar aqui torna a suíte determinística:
// os testes que querem base customizada passam por argumento, não por env.
beforeEach(() => {
    delete process.env.FRONTEND_URL;
});

describe('absolutizeLinksForWhatsApp — host inventado pelo modelo (#host-inventado)', () => {
    // Caso real (2026-07-30 23:58): perguntaram a agenda pelo WhatsApp e o agente respondeu
    // com `https://sistemav2/agenda/75528`. `sistemav2` é o NOME do sistema no prompt (5
    // ocorrências em agentTools.ts), não um domínio — o link não resolve em lugar nenhum e
    // saiu quebrado para o contato. O contrato é o modelo falar em caminho relativo; quando
    // ele entrega absoluto, o código precisa consertar em vez de confiar.
    it('rebaseia URL markdown com host sem ponto', () => {
        expect(absolutizeLinksForWhatsApp('[Ver evento](https://sistemav2/agenda/75528)'))
            .toBe(`Ver evento: ${B}/agenda/75528`);
    });

    it('rebaseia URL SOLTA (fora de markdown) com host sem ponto', () => {
        expect(absolutizeLinksForWhatsApp('olha aqui https://sistemav2/agenda/75528 valeu'))
            .toBe(`olha aqui ${B}/agenda/75528 valeu`);
    });

    it('preserva query e hash ao rebasear', () => {
        expect(absolutizeLinksForWhatsApp('https://sistemav2/agenda?dia=03#topo'))
            .toBe(`${B}/agenda?dia=03#topo`);
    });

    it('NÃO toca link externo legítimo — sequestrar seria pior que o defeito', () => {
        const externo = 'https://www.google.com/search?q=teste';
        expect(absolutizeLinksForWhatsApp(externo)).toBe(externo);
    });

    it('NÃO toca domínio nosso já correto', () => {
        expect(absolutizeLinksForWhatsApp(`${B}/agenda/1`)).toBe(`${B}/agenda/1`);
    });

    it('caminho relativo continua funcionando como antes', () => {
        expect(absolutizeLinksForWhatsApp('[Ver](/agenda/9)')).toBe(`Ver: ${B}/agenda/9`);
    });

    it('rebaseia também localhost (host sem ponto) — link de dev não vai para o cliente', () => {
        expect(absolutizeLinksForWhatsApp('http://localhost:5173/agenda/3'))
            .toBe(`${B}/agenda/3`);
    });
});
