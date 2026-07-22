import { describe, it, expect } from 'vitest';
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
