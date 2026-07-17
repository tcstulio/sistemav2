import { describe, it, expect, vi } from 'vitest';

// #1493 — agente vinha sugerindo type_codes BAUNILHA do Dolibarr (AC_RDV/AC_TEL/AC_EMAIL/AC_OTH)
// que NÃO são usados pela CoolGroove (0 eventos AC_RDV na base), então o LLM criava evento
// com o tipo errado. A spec é trocar a lista no TOOLS_PROMPT pelos type_codes reais do negócio
// (ta_vt, ta_duvidas, Contratado, Contratado_externa, Contratado_fechadoaopublico,
// agenda_ensaios, montagem_agenda) com a semântica de cada um.
//
// Este arquivo de teste afirma:
//   (1) o prompt NÃO sugere mais os códigos baunilha;
//   (2) o prompt lista os códigos reais COM semântica;
//   (3) o handler continua sendo passthrough (o campo já era tratado como string, sem lista de
//       bloqueio no agentTools).

// segredo determinístico p/ o roundtrip sign->verify dos deeplinks
vi.mock('../../config/env', () => ({ config: { deeplinkSecret: 'test-secret-event-typecodes' } }));
// agentTools importa estes no topo; mockamos para não carregar os serviços reais.
vi.mock('../../services/dolibarrService', () => ({ dolibarrService: {} }));
vi.mock('../../services/scraperService', () => ({ ScraperService: {} }));
vi.mock('../../utils/urlValidation', () => ({ isValidExternalUrl: () => true }));

import { executeTool, TOOLS_PROMPT } from '../../services/agentTools';
import { verifyDeeplink } from '../../utils/deeplinkToken';

const REAL_COOLGROOVE_TYPES = [
    'ta_vt',
    'ta_duvidas',
    'Contratado',
    'Contratado_externa',
    'Contratado_fechadoaopublico',
    'agenda_ensaios',
    'montagem_agenda',
];

const VANILLA_DOLIBARR_TYPES = ['AC_RDV', 'AC_TEL', 'AC_EMAIL', 'AC_OTH'];

/**
 * Extrai a descrição (texto após ` - `) de uma ferramenta `<name>(...)` no TOOLS_PROMPT.
 * Inclui tudo até o fim da linha, igualando o que o LLM efetivamente consome.
 */
function extractToolDescription(prompt: string, toolName: string): string {
    const re = new RegExp(`${toolName}\\([^)]*\\)\\s*-\\s*([^\\n]+)`);
    const m = prompt.match(re);
    if (!m) throw new Error(`tool '${toolName}' não encontrada no TOOLS_PROMPT`);
    return m[1];
}

describe('agentTools — type_codes de evento (#1493)', () => {
    describe('TOOLS_PROMPT — prepare_create_event', () => {
        const desc = extractToolDescription(TOOLS_PROMPT, 'prepare_create_event');

        it('lista todos os type_codes reais da CoolGroove', () => {
            for (const t of REAL_COOLGROOVE_TYPES) {
                expect(desc).toContain(t);
            }
        });

        it('não sugere os códigos baunilha do Dolibarr como padrão', () => {
            for (const t of VANILLA_DOLIBARR_TYPES) {
                expect(desc).not.toContain(t);
            }
        });

        it('inclui a semântica de cada tipo (visita técnica, prospecto/dúvidas, ensaio, montagem)', () => {
            expect(desc).toMatch(/visita t[ée]cnica/i);
            expect(desc).toMatch(/prospecto|d[uú]vidas/i);
            expect(desc).toMatch(/ensaio/i);
            expect(desc).toMatch(/montagem/i);
        });

        it('explica explicitamente que NÃO deve usar códigos baunilha do Dolibarr', () => {
            expect(desc).toMatch(/coolgroove|não.*usad|n[ãa]o use/i);
        });
    });

    describe('TOOLS_PROMPT — prepare_edit_event', () => {
        const desc = extractToolDescription(TOOLS_PROMPT, 'prepare_edit_event');

        it('não sugere os códigos baunilha do Dolibarr', () => {
            for (const t of VANILLA_DOLIBARR_TYPES) {
                expect(desc).not.toContain(t);
            }
        });

        it('referencia os type_codes reais CoolGroove como vocabulário válido', () => {
            for (const t of REAL_COOLGROOVE_TYPES) {
                expect(desc).toContain(t);
            }
        });

        it('esclarece que type_code NÃO é editável (a edição não troca esse campo)', () => {
            expect(desc).toMatch(/n[ãa]o\s+[eé]\s+edit[áa]vel|n[ãa]o\s+troca\s+o\s+type_code|criação/i);
        });
    });

    describe('handler — passthrough de type_code (#1493)', () => {
        it('prepare_create_event repassa type_code real (ta_vt) para o deeplink', async () => {
            const out = await executeTool('prepare_create_event', {
                label: 'Visita técnica',
                date_start: '2025-06-15T14:30',
                type_code: 'ta_vt',
            });
            const m = out.match(/\/agenda\/new\?prefill=([A-Za-z0-9._-]+)/);
            expect(m).not.toBeNull();
            const payload = verifyDeeplink<Record<string, string>>(m![1], 'create_event');
            expect(payload).not.toBeNull();
            expect(payload!.data.type_code).toBe('ta_vt');
            expect(payload!.data.label).toBe('Visita técnica');
        });

        it('prepare_create_event aceita os demais type_codes reais (Contratado, montagem_agenda, ...)', async () => {
            for (const t of ['Contratado', 'Contratado_externa', 'agenda_ensaios', 'montagem_agenda']) {
                const out = await executeTool('prepare_create_event', {
                    label: 'X',
                    date_start: '2025-06-15T14:30',
                    type_code: t,
                });
                const m = out.match(/\/agenda\/new\?prefill=([A-Za-z0-9._-]+)/);
                expect(m).not.toBeNull();
                const payload = verifyDeeplink<Record<string, string>>(m![1], 'create_event');
                expect(payload!.data.type_code).toBe(t);
            }
        });

        it('prepare_create_event sem type_code também gera deeplink (campo é opcional)', async () => {
            const out = await executeTool('prepare_create_event', {
                label: 'Reunião qualquer',
                date_start: '2025-06-15T14:30',
            });
            expect(out).toMatch(/\/agenda\/new\?prefill=/);
        });

        it('a edição mantém o handler inalterado — type_code continua fora do editFields', async () => {
            const out = await executeTool('prepare_edit_event', { id: '15', label: 'R' });
            const m = out.match(/\/agenda\/15\/edit\?prefill=([A-Za-z0-9._-]+)/);
            expect(m).not.toBeNull();
            const payload = verifyDeeplink<Record<string, string>>(m![1], 'edit_event');
            expect(payload!.data.id).toBe('15');
            expect(payload!.data.type_code).toBeUndefined();
        });
    });
});
