/**
 * Migração one-off: mensagens de chat antigas AC_OTH -> AC_CHAT
 *
 * As mensagens do chat interno foram gravadas como agendaevents com
 * type_code AC_OTH (label "Comentário em <tipo>"). Este script as localiza
 * e migra para AC_CHAT, para unificar com as novas e permitir ocultá-las.
 *
 * Credenciais: lê DOLIBARR_API_URL / DOLIBARR_API_KEY do ambiente; se ausentes,
 * reutiliza as já presentes em src/scripts/compare_tasks.ts (não imprime a key).
 *
 * Uso:
 *   npx tsx scripts/migrate-chat-events.ts            # dry-run (não altera nada)
 *   npx tsx scripts/migrate-chat-events.ts --apply    # executa a migração
 *   (INSECURE_TLS=1 ... )                             # só se o host tiver cert inválido
 *
 * (scripts/ é excluído do tsconfig — não afeta o type-check do app.)
 */
import axios from 'axios';
import https from 'https';
import fs from 'fs';
import path from 'path';

const APPLY = process.argv.includes('--apply');
const OLD_CODE = 'AC_OTH';
const NEW_CODE = 'AC_CHAT';
const LABEL_PREFIX = 'Comentário em'; // padrão usado pelo ChatInterface

// --- Credenciais (sem expor a key na linha de comando) ---
function credsFromCompareTasks(): { url?: string; key?: string } {
    try {
        const p = path.join(process.cwd(), 'src', 'scripts', 'compare_tasks.ts');
        const txt = fs.readFileSync(p, 'utf8');
        return {
            url: txt.match(/const API_URL\s*=\s*'([^']+)'/)?.[1],
            key: txt.match(/const API_KEY\s*=\s*'([^']+)'/)?.[1],
        };
    } catch {
        return {};
    }
}
const fallback = credsFromCompareTasks();
const API_URL = process.env.DOLIBARR_API_URL || fallback.url;
const API_KEY = process.env.DOLIBARR_API_KEY || fallback.key;

if (!API_URL || !API_KEY) {
    console.error('ERRO: credenciais não encontradas (DOLIBARR_API_URL/KEY ou compare_tasks.ts).');
    process.exit(1);
}

const api = axios.create({
    httpsAgent: new https.Agent({ rejectUnauthorized: process.env.INSECURE_TLS !== '1' }),
    headers: { DOLAPIKEY: API_KEY },
});

interface AgendaEvent {
    id: string;
    label?: string;
    type_code?: string;
    code?: string;
    elementtype?: string;
    fk_element?: string;
    datep?: number;
}

const isChatMessage = (ev: AgendaEvent): boolean => {
    const code = (ev.type_code || ev.code || '').toUpperCase();
    const label = ev.label || '';
    return code === OLD_CODE && label.trim().startsWith(LABEL_PREFIX);
};

async function fetchAllOldEvents(): Promise<AgendaEvent[]> {
    const out: AgendaEvent[] = [];
    const limit = 100;
    let page = 0;
    const sqlfilters = encodeURIComponent(`(t.code:=:'${OLD_CODE}')`);

    while (true) {
        const url = `${API_URL}/agendaevents?sortfield=t.id&sortorder=ASC&limit=${limit}&page=${page}&sqlfilters=${sqlfilters}`;
        let data: AgendaEvent[] = [];
        try {
            const res = await api.get<AgendaEvent[]>(url);
            data = res.data;
        } catch (e) {
            if (axios.isAxiosError(e) && e.response?.status === 404) break; // sem (mais) registros
            throw e;
        }
        if (!Array.isArray(data) || data.length === 0) break;
        out.push(...data);
        if (data.length < limit) break;
        page++;
        if (page > 500) { console.warn('Parando: passou de 500 páginas.'); break; }
    }
    return out;
}

async function main() {
    console.log(`\n[${APPLY ? 'APPLY' : 'DRY-RUN'}] Migração ${OLD_CODE} -> ${NEW_CODE}`);
    console.log(`Servidor: ${API_URL}\n`);

    const all = await fetchAllOldEvents();
    const matches = all.filter(isChatMessage);

    console.log(`Total de eventos ${OLD_CODE} no servidor: ${all.length}`);
    console.log(`Identificados como mensagem de chat (label "${LABEL_PREFIX}..."): ${matches.length}\n`);

    matches.slice(0, 15).forEach(m =>
        console.log(`  #${m.id}  [${m.elementtype || '?'}/${m.fk_element || '?'}]  "${m.label}"`)
    );
    if (matches.length > 15) console.log(`  ... e mais ${matches.length - 15}`);

    if (!APPLY) {
        console.log(`\nDRY-RUN: nada foi alterado. Revise a lista acima.`);
        console.log(`Para executar: adicione --apply ao comando.`);
        return;
    }

    console.log(`\nMigrando ${matches.length} eventos...`);
    let ok = 0, fail = 0;
    for (const m of matches) {
        try {
            await api.put(`${API_URL}/agendaevents/${m.id}`, { type_code: NEW_CODE });
            ok++;
            if (ok % 20 === 0) console.log(`  ${ok}/${matches.length}...`);
        } catch (e) {
            fail++;
            const msg = axios.isAxiosError(e) ? `${e.response?.status} ${JSON.stringify(e.response?.data)}` : (e as Error).message;
            console.error(`  Falha no #${m.id}: ${msg}`);
        }
    }
    console.log(`\nConcluído: ${ok} migrados, ${fail} falhas.`);
}

main().catch(e => {
    console.error('Erro fatal:', axios.isAxiosError(e) ? `${e.response?.status} ${e.message}` : e.message);
    process.exit(1);
});
