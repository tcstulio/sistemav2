/**
 * #1546 — Testes do serviço `describeVideo` (análogo a `describeImage`, mas para vídeos
 * via glm-4.6v `video_url`). Cobre:
 *
 *   - Sem API key configurada → retorna null (visão indisponível, degradação graciosa).
 *   - Input como Buffer → data URL com o mime correto é enviada ao LLM.
 *   - Input como filePath → lê o arquivo do disco e envia com o mime correto.
 *   - Mensagem segue o contrato OpenAI-compat: text + video_url com data URL.
 *   - `userHint` é concatenado ao prompt base.
 *   - Erro do LLM (4xx/5xx/timeout) retorna null (NÃO lança) — mesmo padrão do describeImage.
 *   - Resposta sem `choices[0].message.content` retorna null.
 *
 * Estratégia: mockamos o `callVisionChat` (injetável via options) pra isolar da API real;
 * o axios/setup global já está mockado, mas bypassamos ele pelo caller injetável.
 * O `fs/promises` é REAL (não está no mock global de `fs`), então o caso filePath
 * opera contra um arquivo temporário real — mas com cleanup explícito no afterEach.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fsp from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

// Constantes usadas dentro do factory do vi.mock — vi.hoisted garante que sejam
// inicializadas ANTES do hoisting do vi.mock (que move a chamada p/ o topo do arquivo).
const mockCfg = vi.hoisted(() => ({
    zaiApiKey: 'test-zai-key',
    zaiVisionBaseUrl: 'https://example.test/v4',
    zaiVisionModel: 'glm-4.6v-test',
}));

// Mockamos o config do env antes de importar o serviço — assim `config.zaiApiKey` reflete
// o estado controlado por teste. O setup global já mocka logger/sentry, então só precisamos
// cobrir o config.
vi.mock('../../config/env', () => ({
    config: mockCfg,
}));

import { describeVideo, SUPPORTED_VIDEO_MIMES } from '../../services/describeVideo';

const callVisionChat = vi.fn();

describe('describeVideo (#1546)', () => {
    beforeEach(() => {
        callVisionChat.mockReset();
        callVisionChat.mockResolvedValue({
            data: {
                choices: [{ message: { content: 'descrição do vídeo em português' } }],
            },
        });
    });

    it('retorna null quando ZAI_API_KEY está ausente (visão indisponível)', async () => {
        // Sobrescreve o mock do config só para este teste.
        const original = mockCfg.zaiApiKey;
        try {
            mockCfg.zaiApiKey = '';
            const out = await describeVideo({ buffer: Buffer.from('xxx'), mimeType: 'video/mp4' });
            expect(out).toBeNull();
            expect(callVisionChat).not.toHaveBeenCalled();
        } finally {
            mockCfg.zaiApiKey = original;
        }
    });

    it('recebe Buffer e envia data URL com mime correto (video/mp4)', async () => {
        const buffer = Buffer.from('fake-mp4-bytes');
        const out = await describeVideo({ buffer, mimeType: 'video/mp4' }, undefined, { callVisionChat });

        expect(out).toBe('descrição do vídeo em português');
        expect(callVisionChat).toHaveBeenCalledTimes(1);
        const [messages, opts] = callVisionChat.mock.calls[0];
        expect(opts).toMatchObject({ baseUrl: mockCfg.zaiVisionBaseUrl, model: mockCfg.zaiVisionModel, apiKey: mockCfg.zaiApiKey });
        // Mensagem no formato OpenAI-compat: array com 1 mensagem (role user, content array).
        expect(Array.isArray(messages)).toBe(true);
        const msg = (messages as unknown[])[0] as { role: string; content: unknown[] };
        expect(msg.role).toBe('user');
        expect(Array.isArray(msg.content)).toBe(true);
        // 2 parts: text + video_url.
        const parts = msg.content as Array<Record<string, unknown>>;
        expect(parts).toHaveLength(2);
        expect(parts[0].type).toBe('text');
        expect(typeof parts[0].text).toBe('string');
        expect(parts[1].type).toBe('video_url');
        const videoUrlPart = parts[1].video_url as { url: string };
        expect(videoUrlPart.url.startsWith('data:video/mp4;base64,')).toBe(true);
        // A base64 do buffer deve estar presente.
        const expectedB64 = buffer.toString('base64');
        expect(videoUrlPart.url.endsWith(expectedB64)).toBe(true);
    });

    it('usa extensão .mov na URL quando mime é video/quicktime', async () => {
        const out = await describeVideo({ buffer: Buffer.from('mov-bytes'), mimeType: 'video/quicktime' }, undefined, { callVisionChat });
        expect(out).toBe('descrição do vídeo em português');
        const [, opts] = callVisionChat.mock.calls[0];
        const msg = (callVisionChat.mock.calls[0][0] as unknown[])[0] as { content: Array<Record<string, unknown>> };
        const videoUrlPart = msg.content[1].video_url as { url: string };
        expect(videoUrlPart.url.startsWith('data:video/quicktime;base64,')).toBe(true);
        // Sanity: opts.timeoutMs default = 180000.
        expect((opts as { timeoutMs: number }).timeoutMs).toBe(180000);
    });

    it('lê arquivo do disco quando recebe filePath', async () => {
        // Cria arquivo temporário real (fs/promises NÃO é mockado globalmente).
        const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'dv-test-'));
        const filePath = path.join(dir, 'sample.mp4');
        const bytes = Buffer.from('real-file-mp4-content');
        await fsp.writeFile(filePath, bytes);
        try {
            const out = await describeVideo({ filePath, mimeType: 'video/mp4' }, undefined, { callVisionChat });
            expect(out).toBe('descrição do vídeo em português');
            const [, ] = callVisionChat.mock.calls[0];
            const msg = (callVisionChat.mock.calls[0][0] as unknown[])[0] as { content: Array<Record<string, unknown>> };
            const videoUrlPart = msg.content[1].video_url as { url: string };
            expect(videoUrlPart.url.startsWith('data:video/mp4;base64,')).toBe(true);
            expect(videoUrlPart.url.endsWith(bytes.toString('base64'))).toBe(true);
        } finally {
            await fsp.rm(dir, { recursive: true, force: true });
        }
    });

    it('retorna null quando o filePath não existe (não lança)', async () => {
        const out = await describeVideo(
            { filePath: path.join(os.tmpdir(), 'does-not-exist-12345.mp4'), mimeType: 'video/mp4' },
            undefined,
            { callVisionChat }
        );
        expect(out).toBeNull();
        expect(callVisionChat).not.toHaveBeenCalled();
    });

    it('inclui userHint no prompt quando fornecido', async () => {
        await describeVideo(
            { buffer: Buffer.from('x'), mimeType: 'video/mp4' },
            'este vídeo mostra um comprovante',
            { callVisionChat }
        );
        const msg = (callVisionChat.mock.calls[0][0] as unknown[])[0] as { content: Array<Record<string, unknown>> };
        const textPart = msg.content[0].text as string;
        expect(textPart).toMatch(/Analise este v[íi]deo em detalhes, em portugu[êe]s/);
        expect(textPart).toContain('Contexto do usuário: este vídeo mostra um comprovante');
    });

    it('retorna null quando o LLM devolve 4xx (não propaga o erro)', async () => {
        callVisionChat.mockRejectedValueOnce({
            isAxiosError: true,
            message: 'Request failed with status code 400',
            response: { data: { error: { message: 'invalid video_url' } } },
        });
        const out = await describeVideo({ buffer: Buffer.from('x'), mimeType: 'video/mp4' }, undefined, { callVisionChat });
        expect(out).toBeNull();
    });

    it('retorna null quando o LLM devolve 5xx', async () => {
        callVisionChat.mockRejectedValueOnce({
            isAxiosError: true,
            message: 'Request failed with status code 500',
            response: { data: 'internal error' },
        });
        const out = await describeVideo({ buffer: Buffer.from('x'), mimeType: 'video/mp4' }, undefined, { callVisionChat });
        expect(out).toBeNull();
    });

    it('retorna null quando a resposta não tem choices[0].message.content', async () => {
        callVisionChat.mockResolvedValueOnce({ data: { choices: [] } });
        const out = await describeVideo({ buffer: Buffer.from('x'), mimeType: 'video/mp4' }, undefined, { callVisionChat });
        expect(out).toBeNull();
    });

    it('respeita timeoutMs customizado passado via options', async () => {
        await describeVideo({ buffer: Buffer.from('x'), mimeType: 'video/mp4' }, undefined, { callVisionChat, timeoutMs: 12345 });
        const opts = callVisionChat.mock.calls[0][1] as { timeoutMs: number };
        expect(opts.timeoutMs).toBe(12345);
    });

    it('SUPPORTED_VIDEO_MIMES inclui exatamente os MIME da issue', () => {
        expect([...SUPPORTED_VIDEO_MIMES].sort()).toEqual(['video/mp4', 'video/quicktime']);
    });
});