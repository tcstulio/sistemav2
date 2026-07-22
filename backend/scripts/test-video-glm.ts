/**
 * Spike #1029 — Validar suporte a `video_url` no glm-4.6v (base Coding).
 *
 * OBJETIVO: mapear empiricamente o que o endpoint `/chat/completions` do GLM-4.6V
 * aceita quando o `content` inclui um bloco do tipo `video_url`. Hoje (#1029,
 * 2026-07-22) o `LocalProvider` (#934) usa só `image_url` para OCR/análise de
 * imagem. Antes de implementar análise de VÍDEO (sub-tarefa 2 do #937), precisamos
 * saber se o modelo aceita `video_url` e em que formatos/tamanhos — ou se isso
 * é BLOQUEADO e a feature segue fora do roadmap.
 *
 * ============================================================================
 * README — como rodar:
 * ============================================================================
 *
 *   1. Apontar para a base CODING (a default de dev, mas vale conferir):
 *        export ZAI_VISION_BASE_URL=https://api.z.ai/api/coding/paas/v4
 *      Para testar PaaS, basta sobrescrever antes de rodar (a base PaaS exige
 *      saldo separado — ver `backend/src/config/env.ts`).
 *
 *   2. Garantir a chave:
 *        export ZAI_API_KEY=...
 *
 *   3. Sub-tarefa 2B (gera MP4 e manda p/ a API):
 *        npx tsx backend/scripts/test-video-glm.ts
 *
 *      Sub-tarefa 2A (só gera os MP4, sem chamada HTTP — útil para CI):
 *        npx tsx backend/scripts/test-video-glm.ts --dry-run
 *
 *      Sub-tarefa 3 (auto-emite o bloco DECISÃO dentro deste arquivo com
 *      SUPORTA/BLOQUEADO + evidência HTTP; falha se não houver 3 resultados
 *      coletados antes):
 *        npx tsx backend/scripts/test-video-glm.ts --emit-decision
 *
 *   Sem `ZAI_API_KEY` o script sai (exit 1) com mensagem clara — sem gastar
 *   rede de vídeo. Com `--dry-run`, gera os MP4 e os descarta, sem HTTP.
 *
 * ============================================================================
 * O QUE O SCRIPT FAZ (mapeamento de formatos/tamanhos):
 * ============================================================================
 *
 *   Caso 1: vídeo curto (~3s, ≤2 MB) embutido como data URI        → `video_url`
 *   Caso 2: vídeo apontado por URL pública (HTTP placeholder)       → `video_url`
 *   Caso 3: vídeo maior (~8 MB) embutido como data URI             → `video_url`
 *
 * Cada caso loga: HTTP status, headers relevantes (apenas Content-Type/Model),
 * corpo CRU da resposta (sem mascarar nada), `usage.total_tokens` quando
 * presente, elapsed time. Erros 401/400/413/timeout são logados EXATAMENTE
 * como a API devolveu (código + `error.response.data` em JSON quando existir).
 *
 * ============================================================================
 * REUSO DE CONFIG (#1029 critério explícito):
 * ============================================================================
 *
 *   NÃO duplica `ZAI_VISION_BASE_URL` / `ZAI_VISION_MODEL` / `ZAI_API_KEY`.
 *   Importa do módulo `backend/src/services/visionService.ts`, que por sua
 *   vez lê de `backend/src/config/env.ts` — mesma fonte do `LocalProvider`
 *   em `backend/src/services/aiService.ts` (método `describeImage`).
 *
 *   Resultado prático: se uma env var mudar, o spike e a produção andam
 *   juntos. Zero duplicação de URL/chave/modelo.
 *
 * ============================================================================
 * DECISÃO (bloco ao final do arquivo):
 * ============================================================================
 *
 *   O spike não consegue "decidir sozinho" (precisa de rede e API key). O
 *   que ele FAZ é transformar a saída em evidência estruturada e — com a
 *   flag `--emit-decision` — gravar a SUGESTÃO no bloco DECISÃO no fim
 *   deste arquivo. O reviewer valida e, se necessário, ajusta o texto.
 */

import axios from 'axios';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import {
    callVisionChat,
    describeVisionError,
    getVisionClientConfig,
    getVisionHeaders,
    isCodingBase,
    redactApiKey,
} from '../src/services/visionService';

// -----------------------------------------------------------------------------
// Sinais de linha de comando (parsed uma vez).
// -----------------------------------------------------------------------------
const ARGS = process.argv.slice(2);
const DRY_RUN = ARGS.includes('--dry-run');
const EMIT_DECISION = ARGS.includes('--emit-decision');
const HELP = ARGS.includes('--help') || ARGS.includes('-h');

if (HELP) {
    console.log(`
Uso: npx tsx backend/scripts/test-video-glm.ts [opções]

Opções:
  --dry-run        Gera os MP4 e monta os bodies, mas NÃO chama a API.
  --emit-decision  Após rodar, grava SUGESTÃO DE DECISÃO no fim deste arquivo.
  -h, --help       Mostra esta ajuda.

Env vars (obrigatórias para chamada HTTP):
  ZAI_API_KEY            Chave da Z.AI
  ZAI_VISION_BASE_URL    Default: https://api.z.ai/api/coding/paas/v4
  ZAI_VISION_MODEL       Default: glm-4.6v
`);
    process.exit(0);
}

const TEXT_PROMPT = 'Descreva brevemente o que aparece neste vídeo em português (1 frase).';

// -----------------------------------------------------------------------------
// Config do cliente de visão — importada do visionService (sem duplicação).
// -----------------------------------------------------------------------------
const visionCfg = getVisionClientConfig();
const apiKey = visionCfg.apiKey;
const baseUrl = visionCfg.baseUrl;
const model = visionCfg.model;
const headers = getVisionHeaders();

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
const colorKeys = Object.keys(C) as (keyof typeof C)[];
type ColorKey = (typeof colorKeys)[number];
const log = (label: string, body = '', color: ColorKey = 'reset'): void => {
    console.log(`${C[color]}${label}${body}${C.reset}`);
};
const section = (title: string): void => log(`\n${'='.repeat(72)}\n  ${title}\n${'='.repeat(72)}\n`, '', 'cyan');

// -----------------------------------------------------------------------------
// Geração de MP4 de teste via ffmpeg-static (já é dep do backend).
// `lavfi testsrc2` produz uma imagem animada sem precisar de asset. O
// tamanho-alvo é aproximado via `-fs N MiB` (file-size limit) — ffmpeg
// para no limite, então o MP4 fica próximo do alvo sem inflar.
// -----------------------------------------------------------------------------
function ffmpegBin(): string {
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

interface VideoCallResult {
    label: string;
    ok: boolean;
    elapsedMs: number;
    /** HTTP status quando a API respondeu, mesmo que 4xx. */
    status?: number;
    /** 'HTTP_400' / 'ECONNABORTED' / 'axios_error' / texto livre. */
    kind?: string;
    /** Corpo cru da resposta (string ou JSON). */
    body?: string;
    /** `usage.total_tokens` se a API devolveu. */
    totalTokens?: number;
    /** Tamanho do vídeo enviado (MiB) — p/ mapear limite. */
    videoBytes?: number;
    /** Duração aproximada em segundos. */
    videoDurationSec?: number;
    /** Erro fatal local (geração de MP4, ffmpeg, etc). */
    fatalMessage?: string;
}

// -----------------------------------------------------------------------------
// UMA chamada ao /chat/completions com o content-array fornecido. Não lança:
// sempre devolve um objeto VideoCallResult para o main() agregar.
//
// BUG FIX vs. tentativa anterior: o `elapsedMs` é capturado em `startMs` no
// INÍCIO desta função (não lido de `err.__startMs`, que nunca era setado e
// sempre voltava 0 no caminho de erro). Funciona igual p/ sucesso e erro.
// -----------------------------------------------------------------------------
async function callOnce(
    label: string,
    contentParts: Array<Record<string, unknown>>,
    videoBytes?: number,
    videoDurationSec?: number
): Promise<VideoCallResult> {
    const startMs = Date.now();
    const messages = [{ role: 'user', content: contentParts }];

    log(`▶ Caso [${label}]`, '', 'bold');
    log(
        `   POST ${baseUrl}/chat/completions  model=${model}\n   parts=`,
        JSON.stringify(
            contentParts.map((p) =>
                p.type === 'text' ? { type: 'text', len: String(p.text ?? '').length } : p
            ),
            null,
            2
        ),
        'gray'
    );

    if (DRY_RUN) {
        log(`   ⏭  dry-run — pulando a chamada HTTP. Body montado acima.\n`, '', 'yellow');
        const elapsedMs = Date.now() - startMs;
        return { label, ok: true, elapsedMs, videoBytes, videoDurationSec };
    }

    try {
        const resp = await callVisionChat(messages, { timeoutMs: 120_000, origin: `spike:video:${label}` });
        const elapsedMs = Date.now() - startMs;
        const data = resp.data as { usage?: { total_tokens?: number }; choices?: Array<{ message?: { content?: unknown }; finish_reason?: string }> };
        const totalTokens = data?.usage?.total_tokens;
        const choice0 = data?.choices?.[0];
        log(`   ✅ HTTP ${resp.status} em ${elapsedMs}ms`, '', 'green');
        log(`   📦 tokens: `, JSON.stringify(data?.usage ?? null), 'gray');
        log(
            `   📝 choice[0]: `,
            JSON.stringify({ finish_reason: choice0?.finish_reason, content: choice0?.message?.content }),
            'gray'
        );
        log(`   🧾 body cru:\n`, JSON.stringify(resp.data, null, 2), 'gray');
        return { label, ok: true, elapsedMs, status: resp.status, totalTokens, videoBytes, videoDurationSec };
    } catch (err: unknown) {
        const elapsedMs = Date.now() - startMs;
        const info = describeVisionError(err);
        const mark: ColorKey = info.status && info.status >= 500 ? 'red' : 'yellow';
        log(`   ❌ ${info.kind} em ${elapsedMs}ms`, '', mark);
        if (info.status != null) log(`   status=`, String(info.status), 'gray');
        if (info.body != null) log(`   body=`, info.body, 'gray');
        else log(`   message=`, (err as Error)?.message || String(err), 'gray');
        return {
            label,
            ok: false,
            elapsedMs,
            status: info.status,
            kind: info.kind,
            body: info.body,
            videoBytes,
            videoDurationSec,
        };
    }
}

// -----------------------------------------------------------------------------
// Sugestão automática de DECISÃO com base nos resultados (SUPORTA/BLOQUEADO).
// Critério:
//   - SUPORTA: pelo menos o Caso 1 (data URI ≤2MB) terminou com 2xx.
//   - BLOQUEADO: Caso 1 terminou com 4xx/5xx/timeout (ex.: 400 "unsupported
//     content type", 413, 422). Evidência = status + body.
//   - Caso houver parcial (1 OK, 3 bloqueado por tamanho), anota limites.
// -----------------------------------------------------------------------------
function suggestDecision(results: VideoCallResult[]): { decision: 'SUPORTA' | 'BLOQUEADO' | 'INCONCLUSIVO'; evidence: string; notes: string[] } {
    const r1 = results.find((r) => r.label.includes('≤2MB') || r.label.includes('data URI (≤2MB)'));
    if (!r1) {
        return { decision: 'INCONCLUSIVO', evidence: 'caso 1 não executado', notes: [] };
    }
    if (r1.ok && r1.status && r1.status >= 200 && r1.status < 300) {
        const notes: string[] = [];
        const r3 = results.find((r) => r.label.includes('~8MB'));
        if (r3 && !(r3.ok && r3.status && r3.status >= 200 && r3.status < 300)) {
            notes.push(`Limite de tamanho: caso 3 (~8 MB) falhou com ${r3.kind ?? 'erro'} status=${r3.status}`);
        }
        return {
            decision: 'SUPORTA',
            evidence: `Caso 1: HTTP ${r1.status} em ${r1.elapsedMs}ms; tokens=${r1.totalTokens ?? 'n/a'}`,
            notes,
        };
    }
    return {
        decision: 'BLOQUEADO',
        evidence: `Caso 1 falhou: ${r1.kind ?? 'erro'} status=${r1.status ?? 'n/a'} body=${(r1.body ?? '').slice(0, 200)}`,
        notes: [],
    };
}

const DECISION_BEGIN = '=== BEGIN spike-decision ===';
const DECISION_END = '=== END spike-decision ===';

function buildDecisionBlock(results: VideoCallResult[]): string {
    const { decision, evidence, notes } = suggestDecision(results);
    const lines: string[] = [];
    lines.push(DECISION_BEGIN);
    lines.push(`Resultado: ${decision}    (auto-gerado por --emit-decision em ${new Date().toISOString()})`);
    lines.push('');
    lines.push('EVIDÊNCIA COLETADA (HTTP status + mensagem, copiar a partir do RESUMO):');
    for (const r of results) {
        const statusPart = r.status != null ? `status=${r.status}` : 'status=n/a';
        const bodyExcerpt = r.body ? r.body.slice(0, 200).replace(/\s+/g, ' ') : (r.ok ? 'OK' : (r.kind ?? 'sem corpo'));
        lines.push(`  - ${r.label}: ${statusPart}  body="${bodyExcerpt}"`);
    }
    lines.push('');
    lines.push('EVIDÊNCIA RESUMIDA (1 linha):');
    lines.push(`  ${evidence}`);
    if (decision === 'SUPORTA') {
        lines.push('');
        lines.push('LIMITES OBSERVADOS (preencher):');
        const r3 = results.find((r) => r.label.includes('~8MB'));
        lines.push(`  - Tamanho máx por arquivo: ____ MB (qualquer 413/422 define isso)`);
        if (r3) {
            lines.push(`  - Caso 3 (~8 MB) resultado: ${r3.ok ? `HTTP ${r3.status} OK` : `${r3.kind} status=${r3.status}`}`);
        }
        lines.push('  - Formatos: mp4 OK | webm NÃO | …');
        lines.push('  - fps: até ____ | duração: até ____s');
    } else if (decision === 'BLOQUEADO') {
        lines.push('');
        lines.push('AÇÃO (#937): comentar em #937 "limite do modelo: glm-4.6v na base Coding');
        lines.push('não aceita `video_url` (evidência acima)". Fechar o card sem nova implementação;');
        lines.push('vídeo segue não-suportado até a Z.AI expor suporte oficial. Em paralelo, se o 4xx');
        lines.push('vier por ENCODING/FORMATO diferente, explorar `image_url` com `data:video/mp4;base64,…`');
        lines.push('em spike futuro.');
    }
    if (notes.length) {
        lines.push('');
        lines.push('NOTAS ADICIONAIS:');
        for (const n of notes) lines.push(`  - ${n}`);
    }
    lines.push(DECISION_END);
    return lines.join('\n');
}

/**
 * Substitui o bloco DECISÃO entre DECISION_BEGIN / DECISION_END por novo conteúdo.
 * Se o bloco não existir (PR fresh), insere antes do `==` final do arquivo.
 * Não altera nada fora dessas âncoras — comentário-guia intocado.
 */
function emitDecisionToFile(results: VideoCallResult[]): void {
    const filePath = __filename;
    const src = fs.readFileSync(filePath, 'utf8');
    const block = buildDecisionBlock(results);
    const beginRe = /=== BEGIN spike-decision ===[\s\S]*?=== END spike-decision ===/;
    let next: string;
    if (beginRe.test(src)) {
        next = src.replace(beginRe, block);
    } else {
        // Sem bloco ainda: insere antes da última linha do arquivo (deve ser comentário).
        next = `${src.trimEnd()}\n\n${block}\n`;
    }
    fs.writeFileSync(filePath, next, 'utf8');
    log(`\n📝 Bloco DECISÃO atualizado em ${path.relative(process.cwd(), filePath)}.`, '', 'cyan');
}

// -----------------------------------------------------------------------------
// MAIN
// -----------------------------------------------------------------------------
async function main(): Promise<void> {
    section(`Spike #1029 — video_url no glm-4.6v (base Coding)`);
    log(`Base:    ${baseUrl}  ${isCodingBase() ? '(coding ✓)' : '(NÃO é coding — alvo do card é a base CODING)'}\n`, '', 'gray');
    log(`Modelo:  ${model}\n`, '', 'gray');
    log(
        `Chave:   ${apiKey ? `definida (${redactApiKey(apiKey)})` : 'AUSENTE — defina ZAI_API_KEY'}\n`,
        apiKey ? 'gray' : 'red'
    );

    if (!apiKey && !DRY_RUN) {
        log(`\nNada a fazer sem ZAI_API_KEY. Saindo.\n`, '', 'yellow');
        process.exit(1);
    }

    // Sanidade: alerta se a base não parece "coding" (que é o alvo do card).
    if (!isCodingBase()) {
        log(
            `\n⚠️  A base configurada não inclui "/coding/". O card #1029 quer validar a base CODING.\n` +
                `   Para forçar: export ZAI_VISION_BASE_URL=https://api.z.ai/api/coding/paas/v4\n`,
            '',
            'yellow'
        );
    }

    const results: VideoCallResult[] = [];

    // ------ Caso 1: vídeo curto, data URI ------
    section('CASO 1 — vídeo curto (≤2 MB, ~3s) embutido como data URI');
    try {
        const buf1 = generateTestMp4(2, 3, 'spike_small');
        const dataUri = `data:video/mp4;base64,${buf1.toString('base64')}`;
        log(`   arquivo gerado: ${(buf1.length / 1024).toFixed(1)} KiB\n`, '', 'gray');
        results.push(
            await callOnce(
                'video_url data URI (≤2MB)',
                [{ type: 'text', text: TEXT_PROMPT }, { type: 'video_url', video_url: { url: dataUri } }],
                buf1.length,
                3
            )
        );
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        log(`   ! falha ao gerar MP4 do caso 1: ${msg}\n`, '', 'red');
        results.push({ label: 'video_url data URI (≤2MB)', ok: false, elapsedMs: 0, fatalMessage: msg });
    }

    // ------ Caso 2: URL pública (placeholder) ------
    section('CASO 2 — vídeo por URL pública (HTTP placeholder)');
    // Não baixamos o arquivo: o spike testa se a API aceita o formato
    // `video_url` apontando para uma URL HTTP pública. Uma URL estável
    // controlada por nós (sample-videos.com / w3.org) seria ideal, mas
    // pra não criar dependência externa fixa usamos um placeholder do
    // github.com (404 esperado se a API tentar baixar) — o ponto é ver
    // se o PARSER da API aceita o formato, não se o vídeo carrega.
    const publicUrl =
        'https://raw.githubusercontent.com/mediaelement/mediaelement-files/master/big_buck_bunny.mp4';
    results.push(
        await callOnce('video_url URL pública HTTP', [
            { type: 'text', text: TEXT_PROMPT },
            { type: 'video_url', video_url: { url: publicUrl } },
        ])
    );

    // ------ Caso 3: vídeo maior, data URI ------
    section('CASO 3 — vídeo maior (~8 MB) embutido como data URI (mapear limite)');
    try {
        const buf3 = generateTestMp4(8, 30, 'spike_large');
        const dataUri3 = `data:video/mp4;base64,${buf3.toString('base64')}`;
        log(`   arquivo gerado: ${(buf3.length / 1024 / 1024).toFixed(2)} MiB\n`, '', 'gray');
        results.push(
            await callOnce(
                'video_url data URI (~8MB)',
                [{ type: 'text', text: TEXT_PROMPT }, { type: 'video_url', video_url: { url: dataUri3 } }],
                buf3.length,
                30
            )
        );
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        log(`   ! falha ao gerar MP4 do caso 3: ${msg}\n`, '', 'red');
        results.push({ label: 'video_url data URI (~8MB)', ok: false, elapsedMs: 0, fatalMessage: msg });
    }

    // ------ Resumo ------
    section('RESUMO');
    log(
        JSON.stringify(
            results.map((r) => ({
                label: r.label,
                ok: r.ok,
                status: r.status,
                kind: r.kind,
                totalTokens: r.totalTokens,
                elapsedMs: r.elapsedMs,
                videoBytes: r.videoBytes,
                videoDurationSec: r.videoDurationSec,
                body_excerpt: r.body ? r.body.slice(0, 200) : undefined,
            })),
            null,
            2
        ),
        '',
        'gray'
    );

    // ------ Sugestão automática de DECISÃO ------
    const sug = suggestDecision(results);
    log(`\n🔎 Sugestão de DECISÃO: ${sug.decision}`, '', 'cyan');
    log(`   ${sug.evidence}`, '', 'cyan');
    for (const n of sug.notes) log(`   • ${n}`, '', 'cyan');

    if (EMIT_DECISION) {
        if (!apiKey) {
            log(`\n--emit-decision requer ZAI_API_KEY (não dá p/ decidir sem coletar evidência).`, '', 'red');
            process.exit(1);
        }
        if (results.some((r) => r.fatalMessage && !r.body && r.status == null)) {
            log(`\n--emit-decision abortado: algum caso não conseguiu nem gerar MP4 (sem evidência HTTP).`, '', 'red');
            log(`   Resolva o ambiente (ffmpeg) e rode de novo.`, '', 'red');
            process.exit(1);
        }
        emitDecisionToFile(results);
        log(`\n📋 Próximo passo: revisar o bloco DECISÃO gerado (entre BEGIN/END), commitar e fechar #1029.\n`, '', 'cyan');
    } else {
        log(`\n📋 Próximo passo: copiar a saída acima para o bloco DECISÃO no fim deste arquivo,`, '', 'cyan');
        log(`   OU rodar com --emit-decision para auto-gravar (com ZAI_API_KEY setada).`, '', 'cyan');
        log(`   Formato esperado (preencher manualmente após rodar):`, '', 'cyan');
        log(`     Resultado: <SUPORTA|BLOQUEADO>`, '', 'cyan');
        log(`     EVIDÊNCIA: status=…  body="…"`, '', 'cyan');
        log(`     LIMITES OBSERVADOS (se SUPORTA): tamanho máx, formatos, fps/duração`, '', 'cyan');
    }

    // Export explícito p/ não deixar handles abertos (axios keep-alive) + sinaliza término limpo.
    if (typeof (axios as unknown as { defaults?: { agent?: unknown } }).defaults?.agent !== 'undefined') {
        // No-op: axios 1.x lida com cleanup via Agent keep-alive; esta linha só documenta a intenção.
    }
    process.exit(0);
}

main().catch((e: unknown) => {
    const msg = e instanceof Error ? (e.stack ?? e.message) : String(e);
    log(`\nFATAL: ${msg}\n`, '', 'red');
    process.exit(1);
});

/* =============================================================================
 * DECISÃO (preencher APÓS rodar o script — a saída acima é a evidência)
 *
 * Existem 3 formas de preencher este bloco (em ordem de preferência):
 *
 *   1. Auto: rode `npx tsx backend/scripts/test-video-glm.ts --emit-decision`
 *      com ZAI_API_KEY setada e a flag grava o resultado entre as âncoras
 *      BEGIN/END abaixo. O texto gerado é só uma SUGESTÃO — revisar antes
 *      de commitar.
 *
 *   2. Manual: copie o bloco entre BEGIN/END a partir do `🔎 Sugestão de
 *      DECISÃO` impresso no fim do script, ajuste o que precisar, commite.
 *
 *   3. Em outro pipeline (CI/admin): o operador que roda a spike cola o
 *      resultado aqui. Issue #1029 NÃO fecha sem este bloco preenchido.
 * =============================================================================
 *
 * Se BLOQUEADO — fechar o card #937 sem nova implementação.
 *   AÇÃO: comentar em #937 "limite do modelo: glm-4.6v na base Coding não
 *   aceita `video_url` (evidência: status XXX + mensagem acima)". Não abrir
 *   nenhuma sub-tarefa 2; vídeo segue não-suportado até a Z.AI expor suporte
 *   oficial. Adicionalmente, se o 4xx veio por ENCODING/FORMATO diferente,
 *   testar com `image_url` (data:video/mp4;base64,…) pode ser uma variação
 *   a explorar em spike futuro — manter decisão aqui.
 *
 * Se SUPORTA — anotar limites e abrir a sub-tarefa 2 (#937).
 *   LIMITES OBSERVADOS:
 *     - Tamanho máx por arquivo: ____ MB (qualquer 413 define isso)
 *     - Formatos: mp4 OK | webm NÃO | …
 *     - fps: até ____ | duração: até ____s
 *   NOTAS:
 *     - Se a base PaaS for diferente da Coding (config.zaiVisionBaseUrl),
 *       repetir o spike com ZAI_VISION_BASE_URL=https://api.z.ai/api/paas/v4
 *       para mapear se há diferença entre as bases.
 *
 * === BEGIN spike-decision ===
 * (vazio até a 1ª execução — preencher via --emit-decision ou manualmente)
 * === END spike-decision ===
 * =============================================================================
 */
