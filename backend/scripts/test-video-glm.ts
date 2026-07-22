/**
 * Spike #1029 — Validar suporte a `video_url` no glm-4.6v (base Coding).
 *
 * README — como rodar:
 *   1. Apontar para a base CODING (a padrão de dev é essa, mas vale conferir):
 *        export ZAI_VISION_BASE_URL=https://api.z.ai/api/coding/paas/v4
 *      Se quiser testar também na PaaS, basta sobrescrever a env var antes de rodar.
 *   2. Garantir a chave da Z.AI:
 *        export ZAI_API_KEY=...
 *   3. Executar:
 *        npx tsx backend/scripts/test-video-glm.ts
 *
 *   Sem ZAI_API_KEY o script sai com mensagem clara (exit 1) sem gastar rede
 *   de vídeo. Para só validar a geração do MP4 de teste (sem chamada HTTP),
 *   rodar com --dry-run.
 *
 * O que ele faz (mapeamento de formatos/tamanhos):
 *   Caso 1: vídeo curto (~3s, ≤2 MB) embutido como data URI        → `video_url`
 *   Caso 2: vídeo apontado por URL pública (HTTP placeholder)       → `video_url`
 *   Caso 3: vídeo maior (~8 MB) embutido como data URI             → `video_url`
 *
 * Cada caso loga: HTTP status, headers relevantes, corpo CRU da resposta
 * (sem mascarar nada), `usage.total_tokens` quando presente, e o tempo
 * decorrido. Erros 401/400/413/timeout são logados EXATAMENTE como a API
 * devolveu (código + `error.response.data` em JSON quando existir).
 *
 * Reuso de config: NÃO duplica ZAI_VISION_BASE_URL / ZAI_VISION_MODEL /
 * ZAI_API_KEY — importa de `backend/src/config/env.ts`, mesma fonte que
 * o LocalProvider.useCase(`aiService.ts`) usa para o OCR de imagem.
 * Resultado: se uma variável mudar, o spike e a produção andam juntos.
 *
 * Suporte a `visionService.ts`: o serviço descrito no card (#1029) ainda
 * não existe (visão vive dentro de `aiService.ts` como `LocalProvider`).
 * O spike REUTILIZA o cliente já configurado para visão (mesmo endpoint
 * `/chat/completions`, mesma auth, mesma base URL) sem instanciar nada
 * novo — portanto, não duplica config.
 *
 * Após rodar, ver o bloco "DECISÃO" no fim do arquivo e preencher com
 * SUPORTA ou BLOQUEADO + evidência (status HTTP + trecho da mensagem).
 * Esse preenchimento é manual, porque o script é a EVIDÊNCIA — o que vai
 * pra cá é o OUTPUT do script, não algo que ele inventa sozinho.
 */

import axios from 'axios';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { config } from '../src/config/env';

// -----------------------------------------------------------------------------
// Reuso do cliente GLM/Z.AI — NADA de config duplicada.
// `config.zaiVisionBaseUrl` / `config.zaiVisionModel` vêm do mesmo env.ts que
// o `LocalProvider` em `backend/src/services/aiService.ts` usa para OCR.
// -----------------------------------------------------------------------------
const apiKey = config.zaiApiKey;
const baseUrlRaw = config.zaiVisionBaseUrl || 'https://api.z.ai/api/coding/paas/v4';
const baseUrl = baseUrlRaw.replace(/\/+$/, '');
const model = config.zaiVisionModel || 'glm-4.6v';
const DRY_RUN = process.argv.includes('--dry-run');

const TEXT_PROMPT = 'Descreva brevemente o que aparece neste vídeo em português (1 frase).';

// -----------------------------------------------------------------------------
// Cores (mesmo padrão do `backend/scripts/test-integration.ts`).
// -----------------------------------------------------------------------------
const C = {
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m',
    gray: '\x1b[90m',
    bold: '\x1b[1m',
    reset: '\x1b[0m',
} as const;
const log = (label: string, body = '', color: keyof typeof C = 'reset') => {
    console.log(`${C[color]}${label}${body}${C.reset}`);
};
const section = (title: string) => log(`\n${'='.repeat(72)}\n  ${title}\n${'='.repeat(72)}\n`, '', 'cyan');

// -----------------------------------------------------------------------------
// Geração de MP4 de teste via ffmpeg-static (já é dep do backend).
// `lavfi testsrc2` produz uma imagem animada sem precisar de asset. O
// tamanho-alvo é aproximado via `-fs N MiB` (file-size limit) — ffmpeg
// para no limite, então o MP4 fica próximo do alvo sem inflar.
// -----------------------------------------------------------------------------
function ffmpegBin(): string {
    // ffmpeg-static exporta o caminho do binário já resolvido pro SO atual.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const p = require('ffmpeg-static');
    if (!p) throw new Error('ffmpeg-static não resolveu um binário (SO/arch não suportado).');
    return String(p);
}

function generateTestMp4(targetSizeMB: number, durationSec: number, label: string): Buffer {
    const tmp = path.join(os.tmpdir(), `${label}.mp4`);
    const bin = ffmpegBin();
    // testsrc2 → padrão animado (cores+relógio). 320x240, yuv420p é o mínimo
    // compatível com quase todo encoder/decodor. bitrate controlado para
    // sair perto do targetSizeMB sem ser absurdo.
    const args = [
        '-y',
        '-loglevel', 'error',
        '-f', 'lavfi',
        '-i', `testsrc2=size=320x240:rate=15:duration=${durationSec}`,
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-pix_fmt', 'yuv420p',
        '-movflags', '+faststart',
        '-fs', `${targetSizeMB}M`,
        tmp,
    ];
    const r = spawnSync(bin, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    if (r.status !== 0) {
        throw new Error(`ffmpeg falhou (status=${r.status}):\nSTDOUT: ${r.stdout}\nSTDERR: ${r.stderr}`);
    }
    const buf = fs.readFileSync(tmp);
    fs.unlinkSync(tmp);
    return buf;
}

// -----------------------------------------------------------------------------
// Erros do axios → mantém o corpo EXATO que a API devolveu, sem truncar
// de forma que esconda info. Para 4xx/5xx imprime `error.response.data`
// como JSON; para timeout/DNS imprime `error.code` + message.
// -----------------------------------------------------------------------------
function describeAxiosError(err: unknown): { kind: string; status?: number; body?: string; elapsedMs: number } {
    const start = (err as any)?.__startMs as number | undefined;
    const elapsedMs = start != null ? Date.now() - start : 0;
    if (axios.isAxiosError(err)) {
        const ax = err as any;
        const status = ax.response?.status as number | undefined;
        const data = ax.response?.data;
        const body = data == null
            ? undefined
            : typeof data === 'string'
                ? data
                : (() => { try { return JSON.stringify(data); } catch { return String(data); } })();
        const code = ax.code || (err as Error).message;
        return { kind: status ? `HTTP_${status}` : (code || 'axios_error'), status, body, elapsedMs };
    }
    return { kind: (err as Error)?.message || String(err), elapsedMs };
}

// -----------------------------------------------------------------------------
// UMA chamada ao /chat/completions com o content-array fornecido. Devolve
// um objeto plano (sem throw) para o caller logar.
// -----------------------------------------------------------------------------
async function callOnce(label: string, contentParts: Array<Record<string, any>>) {
    const startMs = Date.now();
    const body = {
        model,
        messages: [{ role: 'user', content: contentParts }],
        temperature: 0.1,
    };
    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
    };

    log(`▶ Caso [${label}]`, '', 'bold');
    log(`   POST ${baseUrl}/chat/completions  model=${model}\n   parts=`, JSON.stringify(
        contentParts.map((p: any) => p.type === 'text' ? { type: 'text', len: (p.text || '').length } : p)
    , null, 2), 'gray');

    if (DRY_RUN) {
        log(`   ⏭  dry-run — pulando a chamada HTTP. Body montado acima.\n`, '', 'yellow');
        return { label, dryRun: true, elapsedMs: 0 } as const;
    }

    try {
        const resp = await axios.post(`${baseUrl}/chat/completions`, body, {
            headers,
            timeout: 120_000,
            // NÃO definir `maxContentLength`/`maxBodyLength` aqui: queremos ver
            // a resposta INTEIRA, mesmo em 413.
        });
        const elapsedMs = Date.now() - startMs;
        const usage = (resp.data as any)?.usage ?? null;
        const choice0 = (resp.data as any)?.choices?.[0];
        log(`   ✅ HTTP ${resp.status} em ${elapsedMs}ms`, '', 'green');
        log(`   📦 tokens: `, JSON.stringify(usage), 'gray');
        log(`   📝 choice[0]: `, JSON.stringify({
            finish_reason: choice0?.finish_reason,
            content: choice0?.message?.content,
        }), 'gray');
        log(`   🧾 body cru:\n`, JSON.stringify(resp.data, null, 2), 'gray');
        return { label, status: resp.status, usage, elapsedMs, data: resp.data } as const;
    } catch (errRaw: any) {
        const elapsedMs = Date.now() - startMs;
        const info = describeAxiosError(errRaw);
        const mark = info.status && info.status >= 500 ? 'red' : 'yellow';
        log(`   ❌ ${info.kind} em ${elapsedMs}ms`, '', mark);
        if (info.status != null) log(`   status=`, String(info.status), 'gray');
        if (info.body != null) log(`   body=`, info.body, 'gray');
        else log(`   message=`, (errRaw as Error)?.message || String(errRaw), 'gray');
        return { label, ok: false, ...info } as const;
    }
}

// -----------------------------------------------------------------------------
// MAIN
// -----------------------------------------------------------------------------
async function main() {
    section(`Spike #1029 — video_url no glm-4.6v (base Coding)`);
    log(`Base:    ${baseUrl}  (esperado Coding; PaaS exige saldo separado, ver backend/src/config/env.ts)\n`, '', 'gray');
    log(`Modelo:  ${model}\n`, '', 'gray');
    log(`Chave:   ${apiKey ? `definida (${apiKey.slice(0, 4)}…${apiKey.slice(-2)})` : 'AUSENTE — defina ZAI_API_KEY'}\n`, apiKey ? 'gray' : 'red');

    if (!apiKey && !DRY_RUN) {
        log(`\nNada a fazer sem ZAI_API_KEY. Saindo.\n`, '', 'yellow');
        process.exit(1);
    }

    // Sanidade: alerta se a base não parece "coding" (que é o alvo do card).
    if (!/\/coding\//.test(baseUrl)) {
        log(`\n⚠️  A base configurada não inclui "/coding/". O card #1029 quer validar a base CODING.\n` +
            `   Para forçar: export ZAI_VISION_BASE_URL=https://api.z.ai/api/coding/paas/v4\n`, '', 'yellow');
    }

    const results: unknown[] = [];

    // ------ Caso 1: vídeo curto, data URI ------
    section('CASO 1 — vídeo curto (≤2 MB, ~3s) embutido como data URI');
    try {
        const buf1 = generateTestMp4(2, 3, 'spike_small');
        const dataUri = `data:video/mp4;base64,${buf1.toString('base64')}`;
        log(`   arquivo gerado: ${(buf1.length / 1024).toFixed(1)} KiB\n`, '', 'gray');
        results.push(await callOnce('video_url data URI (≤2MB)', [
            { type: 'text', text: TEXT_PROMPT },
            { type: 'video_url', video_url: { url: dataUri } },
        ]));
    } catch (e: any) {
        log(`   ! falha ao gerar MP4 do caso 1: ${e?.message || e}\n`, '', 'red');
    }

    // ------ Caso 2: URL pública (placeholder) ------
    section('CASO 2 — vídeo por URL pública (HTTP placeholder)');
    // Não baixamos o arquivo: o spike testa se a API aceita o formato
    // `video_url` apontando para uma URL HTTP pública. Uma URL estável
    // controlada por nós (sample-videos.com / w3.org) seria ideal, mas
    // pra não criar dependência externa fixa usamos um placeholder do
    // github.com (404 esperado se a API tentar baixar) — o ponto é ver
    // se o PARSER da API aceita o formato, não se o vídeo carrega.
    const publicUrl = 'https://raw.githubusercontent.com/mediaelement/mediaelement-files/master/big_buck_bunny.mp4';
    results.push(await callOnce('video_url URL pública HTTP', [
        { type: 'text', text: TEXT_PROMPT },
        { type: 'video_url', video_url: { url: publicUrl } },
    ]));

    // ------ Caso 3: vídeo maior, data URI ------
    section('CASO 3 — vídeo maior (~8 MB) embutido como data URI (mapear limite)');
    try {
        const buf3 = generateTestMp4(8, 30, 'spike_large');
        const dataUri3 = `data:video/mp4;base64,${buf3.toString('base64')}`;
        log(`   arquivo gerado: ${(buf3.length / 1024 / 1024).toFixed(2)} MiB\n`, '', 'gray');
        results.push(await callOnce('video_url data URI (~8MB)', [
            { type: 'text', text: TEXT_PROMPT },
            { type: 'video_url', video_url: { url: dataUri3 } },
        ]));
    } catch (e: any) {
        log(`   ! falha ao gerar MP4 do caso 3: ${e?.message || e}\n`, '', 'red');
    }

    // ------ Resumo ------
    section('RESUMO');
    log(JSON.stringify(results.map((r: any) => ({
        label: r.label,
        status: r.status,
        ok: r.ok,
        kind: r.kind,
        totalTokens: r.usage?.total_tokens,
        elapsedMs: r.elapsedMs,
        body_excerpt: r.body ? String(r.body).slice(0, 200) : undefined,
    })), null, 2), '', 'gray');

    log(`\n📋 Próximo passo: copiar a saída acima para o bloco DECISÃO no fim deste arquivo.`, '', 'cyan');
    log(`   Formato esperado (preencher manualmente após rodar):`, '', 'cyan');
    log(`     DECISÃO: <SUPORTA|BLOQUEADO>`);
    log(`     EVIDÊNCIA: status=…  mensagem="…"`);
    log(`     LIMITES OBSERVADOS (se SUPORTA): tamanho máx, formatos, fps/duração`);
}

main().catch((e) => {
    log(`\nFATAL: ${e?.stack || e?.message || e}\n`, '', 'red');
    process.exit(1);
});

/* =============================================================================
 * DECISÃO (preencher APÓS rodar o script — a saída acima é a evidência)
 * =============================================================================
 *
 * Resultado: <SUPORTA | BLOQUEADO>  (escolher um)
 *
 * EVIDÊNCIA COLETADA (HTTP status + mensagem, copiar a partir do RESUMO):
 *   - Caso 1 (video_url data URI ≤2MB):    status=____  body="…"
 *   - Caso 2 (video_url URL pública HTTP): status=____  body="…"
 *   - Caso 3 (video_url data URI ~8MB):    status=____  body="…"
 *
 * SE BLOQUEADO — fechar o card #937 sem nova implementação.
 *   AÇÃO: comentar em #937 "limite do modelo: glm-4.6v na base Coding não
 *   aceita `video_url` (evidência: status XXX + mensagem acima)". Não abrir
 *   nenhuma sub-tarefa 2; vídeo segue não-suportado até a Z.AI expor suporte
 *   oficial. Adicionalmente, se o 4xx veio por ENCODING/FORMATO diferente,
 *   testar com `image_url` (data:video/mp4;base64,…) pode ser uma variação
 *   a explorar em spike futuro — manter decisão aqui.
 *
 * SE SUPORTA — anotar limites e abrir a sub-tarefa 2 (#937).
 *   LIMITES OBSERVADOS:
 *     - Tamanho máx por arquivo: ____ MB (qualquer 413 define isso)
 *     - Formatos: mp4 OK | webm NÃO | …
 *     - fps: até ____ | duração: até ____s
 *   NOTAS:
 *     - Se a base PaaS for diferente da Coding (config.zaiVisionBaseUrl),
 *       repetir o spike com ZAI_VISION_BASE_URL=https://api.z.ai/api/paas/v4
 *       para mapear se há diferença entre as bases.
 * =============================================================================
 */
