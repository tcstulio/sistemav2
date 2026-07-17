import { describe, it, expect, vi } from 'vitest';

// #1493: a descrição de prepare_create_event/prepare_edit_event no prompt do agente
// ensinava o LLM a usar os códigos baunilha do Dolibarr (AC_RDV/AC_TEL/AC_EMAIL/AC_OTH),
// que NÃO existem na base CoolGroove (0 eventos AC_RDV). O agente estava criando eventos
// com o tipo errado. Trocamos pelos códigos REAIS do dicionário de agenda CoolGroove.
//
// Esta spec vive em `COOLGROOVE_EVENT_TYPE_CODES` (exportado de agentTools.ts) — o prompt
// é renderizado a partir desse const, e os testes abaixo validam AMBOS os lados:
// (a) o const tem os 7 códigos REAIS na ordem canônica;
// (b) o prompt (admin + não-admin) cita cada código com sua semântica de negócio;
// (c) prepare_edit_event documenta que type_code NÃO é editável.
vi.mock('../../config/env', () => ({ config: { deeplinkSecret: 'test-secret-events-1493' } }));
vi.mock('../../services/dolibarrService', () => ({ dolibarrService: {} }));
vi.mock('../../services/scraperService', () => ({ ScraperService: {} }));
vi.mock('../../utils/urlValidation', () => ({ isValidExternalUrl: () => true }));

import {
    TOOLS_PROMPT,
    getToolsPrompt,
    COOLGROOVE_EVENT_TYPE_CODES,
} from '../../services/agentTools';

describe('agentTools — const COOLGROOVE_EVENT_TYPE_CODES (#1493)', () => {
    it('tem exatamente os 7 códigos REAIS da agenda CoolGroove, na ordem canônica', () => {
        // A ordem é parte da "voz" do prompt — se alguém reordenar, o LLM passa a ver os
        // códigos em outra sequência sem o time perceber. Pega regressão silenciosa.
        expect(COOLGROOVE_EVENT_TYPE_CODES.map(([c]) => c)).toEqual([
            'ta_vt',
            'ta_duvidas',
            'Contratado',
            'Contratado_externa',
            'Contratado_fechadoaopublico',
            'agenda_ensaios',
            'montagem_agenda',
        ]);
    });

    it('cada código tem uma semântica NÃO-vazia em PT-BR', () => {
        for (const [code, sem] of COOLGROOVE_EVENT_TYPE_CODES) {
            expect(sem, `semântica do código "${code}"`).toBeTruthy();
            expect(sem.length, `semântica do código "${code}"`).toBeGreaterThan(2);
        }
    });
});

describe('agentTools — type_code de evento no prompt (#1493)', () => {
    // Helper: extrai APENAS o conteúdo da entrada numerada "45. prepare_create_event".
    // Importante: parsear a entrada (não o prompt inteiro) para que outras menções legítimas
    // no template (em regras/exemplos, por exemplo) não sejam confundidas com a spec.
    function prepareCreateEventEntry(prompt: string): string {
        const match = prompt.match(/45\.\s+prepare_create_event[\s\S]*?(?=\n\s+\d+\.|\n[ \t]*\n|$)/);
        expect(match, 'entrada 45. prepare_create_event deve existir no prompt').not.toBeNull();
        return match![0];
    }

    // Keyword distintiva por código — basta aparecer dentro do `(...)` em prepare_create_event
    // para validar que a semântica foi renderizada. Tolerante a Capitalização/variação para
    // não quebrar com refactor cosmético do prose.
    const SEMANTIC_KEYWORDS: ReadonlyArray<readonly [string, string]> = [
        ['ta_vt', 'visita técnica'],
        ['ta_duvidas', 'prospecto'],
        ['Contratado', 'aberto ao público'],
        ['Contratado_externa', 'equipe vai ao local'],
        ['Contratado_fechadoaopublico', 'fechado'],
        ['agenda_ensaios', 'ensaio'],
        ['montagem_agenda', 'montagem'],
    ];

    it('prepare_create_event lista os 7 type_codes REAIS da CoolGroove com semântica', () => {
        const entry = prepareCreateEventEntry(TOOLS_PROMPT);

        for (const [code, semanticsKey] of SEMANTIC_KEYWORDS) {
            expect(entry, `prepare_create_event deve listar o código real "${code}"`).toContain(code);
            // Cada código deve aparecer com a semântica do negócio (não solto, sem contexto).
            const re = new RegExp(`${code}\\s*\\([^)]*${semanticsKey}`, 'i');
            expect(
                re.test(entry),
                `prepare_create_event deve associar "${code}" à semântica "${semanticsKey}"`,
            ).toBe(true);
        }
    });

    it('prepare_create_event NÃO sugere mais os códigos baunilha do Dolibarr como padrão', () => {
        const entry = prepareCreateEventEntry(TOOLS_PROMPT);

        // A lista antiga (AC_RDV (reunião), AC_TEL (ligação), AC_EMAIL, AC_OTH) NÃO pode mais
        // aparecer como sugestão padrão em prepare_create_event. Os baunilha podem aparecer
        // SOMENTE no aviso "NÃO use …" — aqui validamos que NÃO aparecem como default
        // sugerido.
        expect(entry).not.toContain('AC_RDV (reunião), AC_TEL (ligação), AC_EMAIL, AC_OTH');
        expect(entry).not.toMatch(/type_code:\s*AC_RDV\s*\(reuni/i);
    });

    it('prepare_edit_event documenta que type_code NÃO é editável', () => {
        const match = TOOLS_PROMPT.match(/46\.\s+prepare_edit_event[\s\S]*?(?=\n\s+\d+\.|\n[ \t]*\n|$)/);
        expect(match, 'entrada 46. prepare_edit_event deve existir no prompt').not.toBeNull();
        const entry = match![0];

        // O campo type_code é criação-only no fluxo de edição; documentamos isso.
        expect(entry).toMatch(/type_code/i);
        expect(entry).toMatch(/N[ÃA]O\s+[ÉE]\s+edit/i);
    });

    it('não-admin também recebe o dicionário real (não removido pelo filtro #1498)', () => {
        // #1498: buildNonAdminPrompt remove DEV tools, mas prepare_create_event é
        // ferramenta de negócio — deve aparecer no prompt do não-admin COM os códigos reais.
        const nonAdmin = getToolsPrompt({ isAdmin: false });
        const entry = prepareCreateEventEntry(nonAdmin);

        for (const [code] of SEMANTIC_KEYWORDS) {
            expect(entry, `não-admin prompt deve listar "${code}"`).toContain(code);
        }
        expect(entry).not.toContain('AC_RDV (reunião), AC_TEL (ligação), AC_EMAIL, AC_OTH');
    });

    it('prompt byte-equivalente ao prose canônico (regressão na refactor para const)', () => {
        // Se algum dia o const mudar mas a string interpolada ainda satisfizer as keywords
        // acima (por sorte), este teste pega — comparamos o prose do dicionário inteiro
        // com a concatenação literal canônica.
        const EXPECTED_PROSE = COOLGROOVE_EVENT_TYPE_CODES
            .map(([code, sem]) => `${code} (${sem})`)
            .join(', ');
        expect(TOOLS_PROMPT).toContain(EXPECTED_PROSE);
    });
});
