import { describe, it, expect, vi } from 'vitest';

// segredo determinístico p/ o roundtrip sign->verify
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

        it('não sugere mais os códigos baunilha do Dolibarr (AC_RDV/AC_TEL/AC_EMAIL/AC_OTH)', () => {
            for (const t of VANILLA_DOLIBARR_TYPES) {
                expect(desc).not.toContain(t);
            }
        });

        it('inclui a semântica de cada tipo (visita técnica, prospecto, etc.)', () => {
            expect(desc).toMatch(/visita t[ée]cnica/i);
            expect(desc).toMatch(/prospecto|d[uú]vidas/i);
            expect(desc).toMatch(/ensaio/i);
            expect(desc).toMatch(/montagem/i);
        });
    });

    describe('TOOLS_PROMPT — prepare_edit_event', () => {
        const desc = extractToolDescription(TOOLS_PROMPT, 'prepare_edit_event');

        it('não sugere mais os códigos baunilha do Dolibarr', () => {
            for (const t of VANILLA_DOLIBARR_TYPES) {
                expect(desc).not.toContain(t);
            }
        });

        it('referencia os type_codes reais CoolGroove como vocabulário', () => {
            for (const t of REAL_COOLGROOVE_TYPES) {
                expect(desc).toContain(t);
            }
        });
    });

    describe('handler — passthrough de type_code', () => {
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

        it('prepare_create_event aceita outros type_codes reais (Contratado, montagem_agenda, ...)', async () => {
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

        it('type_code continua sendo passthrough sem alterar comportamento do handler', async () => {
            const out1 = await executeTool('prepare_create_event', { label: 'X', date_start: '2025-06-15T14:30' });
            const out2 = await executeTool('prepare_create_event', { label: 'X', date_start: '2025-06-15T14:30', type_code: 'ta_duvidas' });
            expect(out1).toMatch(/\/agenda\/new\?prefill=/);
            expect(out2).toMatch(/\/agenda\/new\?prefill=/);
        });
    });
});
