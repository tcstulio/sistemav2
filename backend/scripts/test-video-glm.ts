/**
 * Spike #1029 — suporte a `video_url` no glm-4.6v da base Coding.
 *
 * Como executar a partir da raiz do projeto:
 *   ZAI_API_KEY=... npx tsx backend/scripts/test-video-glm.ts
 *   ZAI_API_KEY=... npx tsx backend/scripts/test-video-glm.ts --emit-decision
 *   npx tsx backend/scripts/test-video-glm.ts --dry-run
 *
 * `--emit-decision` executa os três casos e atualiza somente o bloco DECISÃO no
 * final deste arquivo. `--dry-run` valida a geração dos MP4 sem chamar a API.
 * A URL, o modelo e a chave são obtidos de `visionService.ts`; este script não
 * duplica a configuração do cliente GLM.
 *
 * Casos executados:
 *   1. MP4 de 3 segundos, 15 fps e no máximo 2 MiB como data URL;
 *   2. MP4 disponível em URL pública;
 *   3. MP4 maior, de 12 segundos e 30 fps, como data URL.
 *
 * Cada chamada imprime status HTTP, corpo bruto, tokens e tempo. Em erros HTTP,
 * imprime sem alteração o corpo disponibilizado pelo Axios, além de status e
 * código; em timeout, imprime o código e a mensagem originais.
 */

import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import ffmpegPath from 'ffmpeg-static';
import {
    callVisionChat,
    describeVisionError,
    getVisionClientConfig,
    isCodingBase,
} from '../src/services/visionService';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const emitDecision = args.includes('--emit-decision');
const timeoutMs = 120_000;
const prompt = 'Descreva brevemente o que aparece neste vídeo em português (1 frase).';
const publicVideoUrl = 'https://raw.githubusercontent.com/mediaelement/mediaelement-files/master/big_buck_bunny.mp4';
const decisionMarker = 'spike-decision';
const decisionBegin = ` * === BEGIN ${decisionMarker} ===`;
const decisionEnd = ` * === END ${decisionMarker} ===`;

interface GeneratedVideo {
    buffer: Buffer;
    durationSec: number;
    fps: number;
    format: 'mp4';
}

interface CaseResult {
    label: string;
    source: 'data-url' | 'public-url';
    ok: boolean;
    elapsedMs: number;
    status?: number;
    code?: string;
    body?: string;
    message?: string;
    totalTokens?: number;
    videoBytes?: number;
    durationSec?: number;
    fps?: number;
    format: 'mp4';
}

interface VideoSpec {
    label: string;
    targetBytes: number;
    durationSec: number;
    fps: number;
    width: number;
    height: number;
}

function printHelp(): void {
    console.log([
        'Uso: npx tsx backend/scripts/test-video-glm.ts [opções]',
        '',
        '  --dry-run        Gera e valida os vídeos sem chamar a API',
        '  --emit-decision  Registra SUPORTA/BLOQUEADO no comentário final',
        '  --help, -h       Exibe esta ajuda',
    ].join('\n'));
}

function generateMp4(spec: VideoSpec): GeneratedVideo {
    if (!ffmpegPath) {
        throw new Error('ffmpeg-static não disponibilizou um binário para esta plataforma.');
    }

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'glm-video-spike-'));
    const outputPath = path.join(tempDir, `${spec.label}.mp4`);
    const bitrateKbps = Math.max(128, Math.floor((spec.targetBytes * 8) / spec.durationSec / 1000));
    const ffmpegArgs = [
        '-y',
        '-loglevel', 'error',
        '-f', 'lavfi',
        '-i', `testsrc2=size=${spec.width}x${spec.height}:rate=${spec.fps}:duration=${spec.durationSec}`,
        '-an',
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-pix_fmt', 'yuv420p',
        '-b:v', `${bitrateKbps}k`,
        '-minrate', `${bitrateKbps}k`,
        '-maxrate', `${bitrateKbps}k`,
        '-bufsize', `${bitrateKbps * 2}k`,
        '-x264-params', 'nal-hrd=cbr:force-cfr=1',
        '-movflags', '+faststart',
        outputPath,
    ];

    try {
        const processResult = spawnSync(ffmpegPath, ffmpegArgs, {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        if (processResult.error) {
            throw processResult.error;
        }
        if (processResult.status !== 0) {
            throw new Error(
                `ffmpeg falhou (status=${processResult.status}): stdout=${processResult.stdout} stderr=${processResult.stderr}`
            );
        }
        return {
            buffer: fs.readFileSync(outputPath),
            durationSec: spec.durationSec,
            fps: spec.fps,
            format: 'mp4',
        };
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
}

function summarizeContent(parts: Array<Record<string, unknown>>): unknown[] {
    return parts.map((part) => {
        if (part.type === 'text') {
            return { type: 'text', characters: String(part.text ?? '').length };
        }
        const videoUrl = part.video_url as { url?: unknown } | undefined;
        const url = typeof videoUrl?.url === 'string' ? videoUrl.url : '';
        return {
            type: part.type,
            video_url: url.startsWith('data:')
                ? { scheme: 'data', encodedCharacters: url.length }
                : { url },
        };
    });
}

function stringifyRaw(value: unknown): string {
    if (typeof value === 'string') {
        return value;
    }
    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}

function responseDetails(data: unknown): { body: string; message?: string; totalTokens?: number } {
    const body = stringifyRaw(data);
    if (!data || typeof data !== 'object') {
        return { body };
    }
    const response = data as {
        usage?: { total_tokens?: number };
        choices?: Array<{ message?: { content?: unknown } }>;
    };
    const content = response.choices?.[0]?.message?.content;
    return {
        body,
        message: content == null ? undefined : stringifyRaw(content),
        totalTokens: response.usage?.total_tokens,
    };
}

async function callCase(
    label: string,
    source: CaseResult['source'],
    parts: Array<Record<string, unknown>>,
    video?: GeneratedVideo
): Promise<CaseResult> {
    console.log(`\n--- ${label} ---`);
    console.log(`request=${JSON.stringify(summarizeContent(parts))}`);

    if (dryRun) {
        console.log('dry-run: chamada HTTP ignorada');
        return {
            label,
            source,
            ok: true,
            elapsedMs: 0,
            videoBytes: video?.buffer.length,
            durationSec: video?.durationSec,
            fps: video?.fps,
            format: 'mp4',
        };
    }

    const startedAt = Date.now();
    try {
        const response = await callVisionChat([{ role: 'user', content: parts }], {
            timeoutMs,
            origin: `spike-1029:${label}`,
        });
        const elapsedMs = Date.now() - startedAt;
        const details = responseDetails(response.data);
        console.log(`status=${response.status}`);
        console.log(`elapsedMs=${elapsedMs}`);
        console.log(`tokens=${details.totalTokens ?? 'n/a'}`);
        console.log(`body=${details.body}`);
        return {
            label,
            source,
            ok: response.status >= 200 && response.status < 300,
            elapsedMs,
            status: response.status,
            ...details,
            videoBytes: video?.buffer.length,
            durationSec: video?.durationSec,
            fps: video?.fps,
            format: 'mp4',
        };
    } catch (error: unknown) {
        const elapsedMs = Date.now() - startedAt;
        const details = describeVisionError(error);
        const message = error instanceof Error ? error.message : String(error);
        console.error(`status=${details.status ?? 'n/a'}`);
        console.error(`code=${details.code ?? details.kind}`);
        console.error(`elapsedMs=${elapsedMs}`);
        if (details.body !== undefined) {
            console.error(`body=${details.body}`);
        } else {
            console.error(`message=${message}`);
        }
        return {
            label,
            source,
            ok: false,
            elapsedMs,
            status: details.status,
            code: details.code ?? details.kind,
            body: details.body,
            message,
            videoBytes: video?.buffer.length,
            durationSec: video?.durationSec,
            fps: video?.fps,
            format: 'mp4',
        };
    }
}

function conciseEvidence(result: CaseResult): string {
    const responseMessage = result.message ?? result.body ?? result.code ?? 'sem mensagem';
    const normalizedMessage = responseMessage.replace(/\s+/g, ' ').slice(0, 300);
    return `status=${result.status ?? 'n/a'}; mensagem=${normalizedMessage}`;
}

function commentLine(text = ''): string {
    return ` *${text ? ` ${text}` : ''}`;
}

function decisionLines(results: CaseResult[]): string[] {
    const shortDataUrl = results.find((result) => result.label.startsWith('1.'));
    if (!shortDataUrl || shortDataUrl.status === undefined) {
        throw new Error('Não há evidência HTTP do caso 1; a decisão não pode ser emitida.');
    }

    const supported = shortDataUrl.ok;
    const publicUrl = results.find((result) => result.label.startsWith('2.'));
    const largerDataUrl = results.find((result) => result.label.startsWith('3.'));
    const lines = [
        decisionBegin,
        commentLine(`Resultado: ${supported ? 'SUPORTA' : 'BLOQUEADO'}`),
        commentLine(`Base: ${getVisionClientConfig().baseUrl}`),
        commentLine(`Modelo: ${getVisionClientConfig().model}`),
        commentLine(`Caso 1 (data URL curta): ${conciseEvidence(shortDataUrl)}`),
    ];

    if (publicUrl) {
        lines.push(commentLine(`Caso 2 (URL pública): ${conciseEvidence(publicUrl)}`));
    }
    if (largerDataUrl) {
        lines.push(commentLine(`Caso 3 (data URL maior): ${conciseEvidence(largerDataUrl)}`));
    }

    lines.push(commentLine());
    if (supported) {
        const acceptedLarge = largerDataUrl?.ok === true;
        const shortMiB = ((shortDataUrl.videoBytes ?? 0) / 1024 / 1024).toFixed(2);
        const largeMiB = ((largerDataUrl?.videoBytes ?? 0) / 1024 / 1024).toFixed(2);
        lines.push(commentLine('Limites observados para a sub-tarefa 2 do #937:'));
        lines.push(commentLine(`- MP4 data URL: aceito com ${shortMiB} MiB, ${shortDataUrl.fps} fps e ${shortDataUrl.durationSec}s.`));
        lines.push(commentLine(`- MP4 por URL pública: ${publicUrl?.ok ? 'aceito' : 'não aceito no caso testado'}.`));
        lines.push(commentLine(
            acceptedLarge
                ? `- Tamanho: ao menos ${largeMiB} MiB aceitos (${largerDataUrl?.fps} fps, ${largerDataUrl?.durationSec}s); máximo exato não determinado.`
                : `- Tamanho: limite observado entre ${shortMiB} e ${largeMiB} MiB; caso maior foi rejeitado.`
        ));
        lines.push(commentLine('- Formato observado: MP4/H.264; WebM não foi testado.'));
    } else {
        lines.push(commentLine('Ação: documentar a limitação e fechar o card #937 sem nova implementação.'));
    }
    lines.push(decisionEnd);
    return lines;
}

function writeDecision(results: CaseResult[]): void {
    const source = fs.readFileSync(__filename, 'utf8');
    const replacement = decisionLines(results).join('\n');
    const pattern = / \* === BEGIN spike-decision ===[\s\S]*? \* === END spike-decision ===/;
    if (!pattern.test(source)) {
        throw new Error('Bloco de decisão não encontrado.');
    }
    fs.writeFileSync(__filename, source.replace(pattern, replacement), 'utf8');
    console.log('\nBloco DECISÃO atualizado com a evidência coletada.');
}

async function main(): Promise<void> {
    if (args.includes('--help') || args.includes('-h')) {
        printHelp();
        return;
    }
    if (dryRun && emitDecision) {
        throw new Error('--dry-run e --emit-decision não podem ser usados juntos.');
    }

    const config = getVisionClientConfig();
    console.log(`base=${config.baseUrl}`);
    console.log(`model=${config.model}`);
    console.log(`codingBase=${isCodingBase(config.baseUrl)}`);
    if (!isCodingBase(config.baseUrl) && !dryRun) {
        throw new Error('O spike deve ser executado na base Coding. Ajuste ZAI_VISION_BASE_URL.');
    }
    if (!config.apiKey && !dryRun) {
        throw new Error('ZAI_API_KEY não configurada.');
    }

    const shortVideo = generateMp4({
        label: 'short',
        targetBytes: 1024 * 1024,
        durationSec: 3,
        fps: 15,
        width: 640,
        height: 360,
    });
    if (shortVideo.buffer.length > 2 * 1024 * 1024) {
        throw new Error(`O vídeo curto excedeu 2 MiB: ${shortVideo.buffer.length} bytes.`);
    }
    const largerVideo = generateMp4({
        label: 'larger',
        targetBytes: 8 * 1024 * 1024,
        durationSec: 12,
        fps: 30,
        width: 1280,
        height: 720,
    });
    if (largerVideo.buffer.length <= shortVideo.buffer.length) {
        throw new Error('A variação maior não ficou maior que o vídeo curto.');
    }

    console.log(`shortVideoBytes=${shortVideo.buffer.length}`);
    console.log(`largerVideoBytes=${largerVideo.buffer.length}`);

    const results: CaseResult[] = [];
    results.push(await callCase(
        '1. video_url com data URL curta',
        'data-url',
        [
            { type: 'text', text: prompt },
            { type: 'video_url', video_url: { url: `data:video/mp4;base64,${shortVideo.buffer.toString('base64')}` } },
        ],
        shortVideo
    ));
    results.push(await callCase(
        '2. video_url com URL pública',
        'public-url',
        [
            { type: 'text', text: prompt },
            { type: 'video_url', video_url: { url: publicVideoUrl } },
        ]
    ));
    results.push(await callCase(
        '3. video_url com data URL maior',
        'data-url',
        [
            { type: 'text', text: prompt },
            { type: 'video_url', video_url: { url: `data:video/mp4;base64,${largerVideo.buffer.toString('base64')}` } },
        ],
        largerVideo
    ));

    console.log(`\nresumo=${JSON.stringify(results)}`);
    if (emitDecision) {
        writeDecision(results);
    }
}

main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
});

/*
 * DECISÃO registrada após execução real do spike.
 * === BEGIN spike-decision ===
 * Resultado: SUPORTA
 * Base: https://api.z.ai/api/coding/paas/v4
 * Modelo: glm-4.6v
 * Caso 1 (data URL curta): status=200; mensagem=O vídeo mostra barras verticais coloridas com formas geométricas em movimento e um cronômetro no canto superior esquerdo.
 * Caso 2 (URL pública): status=200; mensagem=O vídeo mostra uma animação de uma paisagem natural com um coelho saindo de sua toca, além de árvores, um riacho e um pássaro.
 * Caso 3 (data URL maior): status=200; mensagem=O vídeo apresenta uma animação abstrata com listras coloridas verticais e elementos gráficos em movimento, criando um efeito visual glitch.
 *
 * Limites observados para a sub-tarefa 2 do #937:
 * - MP4 data URL: aceito com 0,94 MiB, 15 fps e 3s.
 * - MP4 por URL pública: aceito.
 * - Tamanho: ao menos 8,47 MiB aceitos (30 fps, 12s); máximo exato não determinado.
 * - Formato observado: MP4/H.264; WebM não foi testado.
 * === END spike-decision ===
 */
