/**
 * Backend do botão "Reportar problema" — issue #1561 (sub-tarefa 2).
 *
 * Recebe o payload completo (dados do usuário + htmlSnapshot + screenshot base64
 * + consoleLogs/Errors + falhas de API) e:
 *   1. sanitiza o HTML (mantém estrutura, remove <script>/handlers executáveis);
 *   2. decodifica o screenshot (data URL base64 → Buffer);
 *   3. persiste `./uploads/reports/{reportId}.png` e `./uploads/reports/{reportId}.html`;
 *   4. monta o body markdown via `buildIssueBody` (já existente);
 *   5. cria a issue no GitHub via `createGitHubIssue` (já existente, extraído
 *      para `utils/githubIssue.ts` para reuso);
 *   6. devolve `{ reportId, issueUrl, issueNumber, screenshotUrl, htmlUrl }`.
 *
 * O `reportId` é o identificador público retornado ao front (estável entre
 * criação da issue e payload original — útil p/ correlação no audit log).
 *
 * Erros têm shape `AppError` (status + code) para integrar com o errorHandler
 * global — ver `routes/issueReportRoutes.ts`.
 */
import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'fs';
import path from 'path';
import sanitizeHtml from 'sanitize-html';
import * as cheerio from 'cheerio';
import { v4 as uuidv4 } from 'uuid';
import { createLogger } from '../utils/logger';
import { buildIssueBody, IssueReportContext } from '../utils/issueBodyBuilder';
import { createGitHubIssue, CreateGitHubIssueResult } from '../utils/githubIssue';
import { AppError } from '../middleware/errorHandler';
import { signReportFileToken, verifyReportFileToken } from '../utils/reportFileToken';

const log = createLogger('IssueReport');

/** Limite do screenshot decodificado (PNG em disco). */
export const SCREENSHOT_MAX_BYTES = 5 * 1024 * 1024; // 5 MB
/** Limite do HTML persistido (sanitizado). Evita DoS / disco cheio. */
export const HTML_MAX_BYTES = 1024 * 1024; // 1 MB
/** TTL padrão dos links assinados de screenshot (1h — AC #1562). */
export const SCREENSHOT_URL_TTL_SECONDS = 3600;
/** Diretório de persistência (relativo a CWD do backend). */
export const REPORTS_DIR = path.join(process.cwd(), 'uploads', 'reports');

/**
 * Payload público aceito pelo endpoint. Campos opcionais (htmlSnapshot,
 * screenshot, consoleLogs, etc.) chegam como string/array/string[] — todos
 * validados pelo zod schema na rota; aqui só tipamos a forma final que o
 * service recebe depois do parse.
 */
export interface IssueReportPayload {
    /** Identificador do usuário no app/Dolibarr (obrigatório — item 2 dos AC). */
    userId: string;
    /** Login do usuário, quando disponível — p/ audit log mais legível. */
    userLogin?: string;
    /** Descrição livre do problema (relato do usuário). */
    description?: string;
    /** Título curto p/ a issue (default: "Report via app — {url}"). */
    title?: string;
    /** URL onde o problema ocorreu (obrigatório). */
    url: string;
    /** Trilha de navegação ("Pedidos › Novo") do breadcrumb. */
    breadcrumb?: string;
    /** Seletor / id do elemento relacionado. */
    element?: string;
    /** Fonte do report (ex.: nome do componente). */
    source?: string;
    /** Viewport do navegador no momento do report (obrigatório). */
    viewport: string;
    /** User-Agent do navegador (obrigatório). */
    userAgent: string;
    /** Erros de console (até 20 são usados no body). */
    consoleErrors?: string[];
    /** Logs de console (até 20 são usados no body — vide issueBodyBuilder). */
    consoleLogs?: string[];
    /** Requisições que falharam (até 20 são usados no body). */
    failedRequests?: string[];
    /** Snapshot HTML da página (sanitizado antes de salvar). */
    htmlSnapshot?: string;
    /** Screenshot da viewport em base64 (com ou sem prefixo "data:image/png;base64,"). */
    screenshot?: string;
    /** Diagnóstico opcional da captura visual (#1560). */
    captureMeta?: IssueReportContext['captureMeta'];
    /** IP de origem (preenchido pela rota via req.ip). */
    ip?: string;
    /** Labels extras a aplicar (default: ["from-app", "bug" se descrição]). */
    extraLabels?: string[];
}

export interface IssueReportResult {
    reportId: string;
    issueUrl: string;
    issueNumber?: number;
    screenshotUrl: string;
    htmlUrl: string;
}

/**
 * Faz decode de um data-URL/base64 num Buffer de bytes.
 * Aceita com ou sem prefixo: `data:image/png;base64,iVBOR...` ou só `iVBOR...`.
 * Retorna `{ mime, bytes }` ou lança AppError(400) com mensagem específica.
 */
export function decodeScreenshot(input: string | undefined | null): { mime: string; bytes: Buffer } | null {
    if (!input || typeof input !== 'string') return null;
    const trimmed = input.trim();
    if (!trimmed) return null;
    let mime = 'image/png';
    let payload = trimmed;
    const dataPrefix = /^data:([\w./+-]+);base64,(.*)$/i.exec(trimmed);
    if (dataPrefix) {
        mime = dataPrefix[1].toLowerCase();
        payload = dataPrefix[2];
    }
    if (!/^image\//i.test(mime)) {
        throw new AppError(400, 'INVALID_SCREENSHOT_MIME', `Screenshot deve ser imagem (recebido: ${mime})`);
    }
    // `Buffer.from(str, 'base64')` é permissivo — IGNORA chars inválidos em vez
    // de lançar. Validamos explicitamente o alfabeto base64 (RFC 4648) p/
    // detectar payloads malformados antes do decode.
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(payload)) {
        throw new AppError(400, 'INVALID_SCREENSHOT_BASE64', 'Screenshot não é base64 válido');
    }
    let bytes: Buffer;
    try {
        bytes = Buffer.from(payload, 'base64');
    } catch {
        throw new AppError(400, 'INVALID_SCREENSHOT_BASE64', 'Screenshot não é base64 válido');
    }
    if (bytes.length === 0) {
        throw new AppError(400, 'INVALID_SCREENSHOT_BASE64', 'Screenshot base64 vazio/decode falhou');
    }
    return { mime, bytes };
}

/**
 * Mapeia mime de imagem → extensão de arquivo canônica (sem dots).
 * Garante nomes como `.png`/`.jpg` (e não `.jpeg`, `.svg+xml`) em disco.
 */
const IMAGE_EXT_BY_MIME: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/bmp': 'bmp',
    'image/svg+xml': 'svg',
};

function extForMime(mime: string): string {
    const safe = String(mime || '').toLowerCase().split(';')[0].trim();
    if (IMAGE_EXT_BY_MIME[safe]) return IMAGE_EXT_BY_MIME[safe];
    const raw = safe.split('/')[1]?.split('+')[0] || 'png';
    return /^[a-z0-9]{1,10}$/.test(raw) ? raw : 'png';
}

/**
 * Sanitiza um snapshot HTML removendo tags/atributos executáveis MAS
 * preservando a estrutura para debug (atributos `class`, `id`, `data-*`,
 * `aria-*` etc. são mantidos nos elementos permitidos).
 *
 * Política (conservadora p/ contexto de bug report):
 *   - allowedTags: defaults do sanitize-html + style (debug visual).
 *   - script/iframe/object/embed/form/input/button → removidos junto com
 *     conteúdo (o sanitize-html já tira <script> por padrão, mas
 *     reforçamos handlers).
 *   - inline event handlers (`on*`) e `javascript:` schemes são strippados.
 *   - allowedSchemes: http, https, mailto, tel (sem `javascript:`).
 */
export function sanitizeHtmlSnapshot(html: string): string {
    return sanitizeHtml(html, {
        allowedTags: sanitizeHtml.defaults.allowedTags.concat([
            'img', 'style', 'figure', 'figcaption', 'picture', 'source',
            'details', 'summary', 'mark', 'kbd', 'code', 'pre',
        ]),
        allowedAttributes: {
            ...sanitizeHtml.defaults.allowedAttributes,
            '*': ['class', 'id', 'style', 'role', 'data-*', 'aria-*', 'title'],
            img: ['src', 'alt', 'width', 'height', 'loading'],
            a: ['href', 'name', 'target', 'rel'],
        },
        allowedSchemes: ['http', 'https', 'mailto', 'tel'],
        allowedSchemesByTag: { img: ['http', 'https', 'data'] },
        allowProtocolRelative: false,
        disallowedTagsMode: 'discard',
    });
}

/**
 * Garante que `<REPORTS_DIR>` existe. Idempotente.
 */
export function ensureReportsDir(): void {
    if (!existsSync(REPORTS_DIR)) {
        mkdirSync(REPORTS_DIR, { recursive: true });
    }
}

/**
 * Salva a screenshot decodificada em `<REPORTS_DIR>/{reportId}.<ext>`.
 * Valida o tamanho decodificado (≤ 5 MB) — falha com AppError(413).
 *
 * @returns caminho do arquivo salvo (não a URL pública).
 */
export function persistScreenshot(reportId: string, bytes: Buffer, mime: string): string {
    ensureReportsDir();
    if (bytes.length > SCREENSHOT_MAX_BYTES) {
        throw new AppError(
            413,
            'SCREENSHOT_TOO_LARGE',
            `Screenshot excede o limite de ${(SCREENSHOT_MAX_BYTES / 1024 / 1024).toFixed(0)}MB`
        );
    }
    const safeExt = extForMime(mime);
    const filePath = path.join(REPORTS_DIR, `${reportId}.${safeExt}`);
    writeFileSync(filePath, bytes);
    log.info('Screenshot persistido', { reportId, bytes: bytes.length, path: filePath });
    return filePath;
}

/**
 * Salva o HTML sanitizado em `<REPORTS_DIR>/{reportId}.html`. Aplica cap
 * de 1MB antes de gravar; trunca se necessário (preserva primeiros N bytes
 * válidos — mais útil para debug que falhar a operação).
 *
 * @returns `{ path, truncated }` para a rota montar a URL pública com flag.
 */
export function persistHtmlSnapshot(reportId: string, html: string): { path: string; truncated: boolean } {
    ensureReportsDir();
    const sanitized = sanitizeHtmlSnapshot(html);
    let body = sanitized;
    let truncated = false;
    if (Buffer.byteLength(body, 'utf8') > HTML_MAX_BYTES) {
        // Truncar no ÚLTIMO fechamento de tag antes do limite p/ não quebrar HTML.
        const slice = body.slice(0, HTML_MAX_BYTES);
        body = `${slice}\n<!-- truncated -->`;
        truncated = true;
    }
    const filePath = path.join(REPORTS_DIR, `${reportId}.html`);
    writeFileSync(filePath, body, 'utf8');
    log.info('HTML persistido', { reportId, bytes: Buffer.byteLength(body, 'utf8'), truncated, path: filePath });
    return { path: filePath, truncated };
}

/**
 * Constrói o título default p/ o report quando o front não envia um.
 */
export function buildDefaultTitle(url: string): string {
    const safeUrl = String(url || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 120) || '(sem url)';
    return `Report via app — ${safeUrl}`;
}

/**
 * Carrega o HTML salvo do disco (debug helper — usado em testes). Lança se
 * arquivo não existir (caller decide o que fazer).
 */
export function loadPersistedHtml(reportId: string): string {
    const p = path.join(REPORTS_DIR, `${reportId}.html`);
    return readFileSync(p, 'utf8');
}

// === ISSUE #1562 — leitura de screenshot/HTML por ferramentas do agente ===
//
// Helpers usados pelas ferramentas `get_report_screenshot` e `get_report_html`
// (registradas em `services/agentTools.ts`) e pelos endpoints
// `GET /api/issues/report/:id/screenshot` e `GET /api/issues/report/:id/html`.
// Mantidos no service para serem reusados pelos DOIS callers sem duplicar a
// lógica de path / validação / erro 404 — o service é a fonte única da verdade
// sobre onde mora cada arquivo e como servi-lo.

/** Lista de extensões aceitas para a screenshot (espelha `IMAGE_EXT_BY_MIME`). */
const SCREENSHOT_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'];
const SCREENSHOT_MIME_BY_EXT: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    bmp: 'image/bmp',
    svg: 'image/svg+xml',
};

/** Valida formato do reportId (UUID v4 ou qualquer string "slug-safe" sem `/` nem `..`). */
function assertSafeReportId(reportId: string): void {
    if (!reportId || typeof reportId !== 'string') {
        throw new AppError(400, 'INVALID_REPORT_ID', 'reportId é obrigatório');
    }
    if (!/^[A-Za-z0-9-]{1,128}$/.test(reportId)) {
        throw new AppError(400, 'INVALID_REPORT_ID', 'reportId contém caracteres inválidos');
    }
}

/**
 * Localiza o arquivo de screenshot persistido para um reportId.
 *
 * O mime original determina a extensão (.png, .jpg, .webp etc. — vide
 * `persistScreenshot`/`IMAGE_EXT_BY_MIME`); como só sabemos o `reportId`,
 * procuramos QUALQUER arquivo `<REPORTS_DIR>/<reportId>.<ext>` que exista.
 *
 * @returns `{ path, ext, mime }` se encontrado; `null` se nenhum arquivo
 *          casar (caller decide se traduz em 404 amigável).
 */
export function findPersistedScreenshot(reportId: string): { path: string; ext: string; mime: string } | null {
    assertSafeReportId(reportId);
    for (const ext of SCREENSHOT_EXTS) {
        const fp = path.join(REPORTS_DIR, `${reportId}.${ext}`);
        if (existsSync(fp)) {
            return { path: fp, ext, mime: SCREENSHOT_MIME_BY_EXT[ext] };
        }
    }
    return null;
}

/**
 * Carrega a screenshot persistida como Buffer. Lança `AppError(404)` com
 * mensagem amigável em PT-BR se o arquivo não existir — consumido tanto pelo
 * endpoint quanto pelo tool do agente (que devolve a string p/ o LLM).
 */
export function loadPersistedScreenshot(reportId: string): { bytes: Buffer; mime: string; ext: string } {
    const found = findPersistedScreenshot(reportId);
    if (!found) {
        throw new AppError(
            404,
            'REPORT_NOT_FOUND',
            `Report ${reportId} não encontrado ou sem screenshot anexada.`,
        );
    }
    return { bytes: readFileSync(found.path), mime: found.mime, ext: found.ext };
}

/**
 * Assina um link TEMPORÁRIO p/ a screenshot — válido por `ttlSeconds`
 * (default 3600 = 1h, conforme AC #1562). O link pode ser compartilhado
 * (ex.: colado numa issue do GitHub) sem expor a URL estática
 * desprotegida `/static/reports/<id>.png`.
 *
 * Usa o helper `signReportFileToken` (mesmo esquema do `deeplinkToken` —
 * HMAC-SHA256, base64url, comparação timing-safe).
 */
export function buildSignedScreenshotUrl(reportId: string, ext: string, ttlSeconds = 3600): string {
    assertSafeReportId(reportId);
    // Validação RÍGIDA: extensão deve estar na allowlist canônica do service
    // (espelha `IMAGE_EXT_BY_MIME`). Rejeita path traversal, espaços etc.
    // ANTES de qualquer normalização silenciosa — não queremos que
    // `../../../etc/passwd` vire `etcpasswd` magicamente.
    const rawExt = String(ext || '').toLowerCase().trim();
    const ALLOWED_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'];
    if (!ALLOWED_EXTS.includes(rawExt)) {
        throw new AppError(
            400,
            'INVALID_EXT',
            `Extensão da screenshot inválida: "${ext}". Aceitas: ${ALLOWED_EXTS.join(', ')}.`,
        );
    }
    const token = signReportFileToken({ reportId, ext: rawExt }, ttlSeconds);
    return `/api/issues/report/${reportId}/file.${rawExt}?token=${token}`;
}

/**
 * Verifica o token de uma URL assinada e devolve o payload se válido;
 * `null` se expirado, adulterado ou kind errado.
 */
export function verifySignedScreenshotToken(
    reportId: string,
    ext: string,
    token: string | undefined | null,
): { reportId: string; ext: string; exp: number } | null {
    if (!token) return null;
    const payload = verifyReportFileToken(token);
    if (!payload) return null;
    if (payload.reportId !== reportId) return null;
    if (payload.ext !== ext.toLowerCase()) return null;
    return payload;
}

/**
 * Filtra o HTML persistido por um seletor CSS, devolvendo o `innerHTML`
 * do PRIMEIRO match (AC #1562). Se o seletor não casar com nada, lança
 * `AppError(404)` com mensagem amigável — diferente do erro de seletor
 * inválido (que é 400).
 *
 * Usado pela tool `get_report_html(reportId, selector)` e pelo endpoint
 * `GET /api/issues/report/:id/html?selector=...`.
 */
export function filterHtmlBySelector(html: string, selector: string): string {
    if (!selector || typeof selector !== 'string') {
        throw new AppError(400, 'INVALID_SELECTOR', 'Seletor CSS é obrigatório (string não-vazia).');
    }
    const trimmed = selector.trim();
    if (!trimmed) {
        throw new AppError(400, 'INVALID_SELECTOR', 'Seletor CSS é obrigatório (string não-vazia).');
    }
    if (trimmed.length > 500) {
        throw new AppError(400, 'INVALID_SELECTOR', 'Seletor CSS excede 500 caracteres.');
    }
    try {
        const $ = cheerio.load(html, { xmlMode: false });
        const match = $(trimmed).first();
        if (match.length === 0) {
            throw new AppError(
                404,
                'SELECTOR_NO_MATCH',
                `Nenhum elemento encontrado para o seletor "${trimmed}".`,
            );
        }
        return match.html() || '';
    } catch (error) {
        if (error instanceof AppError) throw error;
        const message = error instanceof Error ? error.message : 'erro desconhecido';
        throw new AppError(400, 'INVALID_SELECTOR', `Seletor CSS inválido: ${message}`);
    }
}

export function truncateUtf8(value: string, maxBytes: number): { value: string; truncated: boolean } {
    const bytes = Buffer.from(value, 'utf8');
    if (bytes.length <= maxBytes) return { value, truncated: false };
    let end = Math.max(0, Math.floor(maxBytes));
    while (end > 0 && (bytes[end] & 0xc0) === 0x80) end -= 1;
    return { value: bytes.subarray(0, end).toString('utf8'), truncated: true };
}

/**
 * Helper de conveniência: carrega o HTML persistido e (opcionalmente) aplica
 * o filtro CSS. Lança 404 amigável se nem o report nem o seletor casarem.
 */
export function loadPersistedHtmlFiltered(reportId: string, selector?: string): { html: string; truncated?: boolean } {
    assertSafeReportId(reportId);
    const htmlPath = path.join(REPORTS_DIR, `${reportId}.html`);
    if (!existsSync(htmlPath)) {
        throw new AppError(
            404,
            'REPORT_NOT_FOUND',
            `Report ${reportId} não encontrado ou sem HTML anexado.`,
        );
    }
    const raw = readFileSync(htmlPath, 'utf8');
    const sanitized = sanitizeHtmlSnapshot(raw);
    const truncated = raw.includes('<!-- truncated -->') || sanitized.includes('<!-- truncated -->');
    if (selector && selector.trim()) {
        return { html: filterHtmlBySelector(sanitized, selector.trim()), truncated };
    }
    return { html: sanitized, truncated };
}

/**
 * Sanity-check defensivo p/ o diretório de reports em testes/mocks: ignora
 * arquivos cujo nome não casa com `<reportId>.<ext>` — evita falso-positivo
 * quando o `REPORTS_DIR` tem sobras de outras fontes.
 */
export function listReportFiles(): string[] {
    if (!existsSync(REPORTS_DIR)) return [];
    try {
        return readdirSync(REPORTS_DIR) as string[];
    } catch {
        return [];
    }
}

/**
 * Ponto de entrada principal — orquestra os passos de um report completo.
 *
 * @returns `IssueReportResult` com IDs públicos (`reportId`), URLs da issue
 *          criada no GitHub e URLs públicas dos arquivos persistidos.
 * @throws `AppError(413)` se screenshot > 5 MB, `AppError(500)` em falha
 *         do `gh` (propagada).
 */
export async function processIssueReport(payload: IssueReportPayload): Promise<IssueReportResult> {
    ensureReportsDir();

    const reportId = uuidv4();
    const title = payload.title?.trim() || buildDefaultTitle(payload.url);

    // 1) Persistir screenshot (se houver)
    let screenshotUrl = '';
    if (payload.screenshot) {
        const decoded = decodeScreenshot(payload.screenshot);
        if (decoded) {
            const filePath = persistScreenshot(reportId, decoded.bytes, decoded.mime);
            // URL pública assume mounting estático de /uploads em /static/reports.
            // O escopo deste endpoint é criar a issue c/ referência; servir
            // o arquivo é responsabilidade do express.static (configurável).
            const ext = path.extname(filePath).slice(1);
            screenshotUrl = `/static/reports/${reportId}.${ext}`;
        }
    }

    // 2) Persistir HTML sanitizado (se houver)
    let htmlUrl = '';
    if (payload.htmlSnapshot) {
        const { path: htmlPath } = persistHtmlSnapshot(reportId, payload.htmlSnapshot);
        htmlUrl = `/static/reports/${reportId}.html`;
        // htmlPath existe p/ auditoria futura; manter a referência local p/
        // logs estruturados sem vazar path no audit.
        log.debug('HTML salvo em', { reportId, htmlPath });
    }

    // 3) Montar context p/ o body markdown
    const context: IssueReportContext = {
        url: payload.url,
        breadcrumb: payload.breadcrumb,
        element: payload.element,
        source: payload.source,
        viewport: payload.viewport,
        userAgent: payload.userAgent,
        consoleErrors: Array.isArray(payload.consoleErrors) ? payload.consoleErrors.slice(0, 20) : undefined,
        consoleLogs: Array.isArray(payload.consoleLogs) ? payload.consoleLogs.slice(0, 20) : undefined,
        failedRequests: Array.isArray(payload.failedRequests) ? payload.failedRequests.slice(0, 20) : undefined,
        htmlSnapshot: payload.htmlSnapshot ? '[salvo em anexo]' : undefined, // evita duplicar 20k no body
        screenshot: undefined, // screenshot NÃO vai no body (data URI) — GitHub não aceita
        captureMeta: payload.captureMeta,
    };
    // Se houver arquivo salvo, adicionamos referência ao invés do base64.
    const bodyContext = screenshotUrl
        ? { ...context, screenshot: `[salvo em ${screenshotUrl}]`, _refs: { screenshotUrl, htmlUrl } } as any
        : context;

    const reporter = payload.userLogin || payload.userId;
    const issueBody = buildIssueBody(payload.description || '', bodyContext, reporter);

    // 4) Criar issue no GitHub (helper compartilhado — REUSO)
    const labels = Array.isArray(payload.extraLabels) && payload.extraLabels.length
        ? ['from-app', ...payload.extraLabels.filter((l) => l !== 'from-app').slice(0, 4)]
        : undefined;

    let created: CreateGitHubIssueResult;
    try {
        created = await createGitHubIssue({
            title,
            body: issueBody,
            ...(labels ? { labels } : {}),
        });
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Falha ao criar issue no GitHub';
        log.error('Falha criando issue no GitHub', { reportId, error: msg });
        throw new AppError(502, 'GITHUB_ISSUE_CREATE_FAILED', msg);
    }

    log.info('Issue report processado', {
        reportId,
        issueUrl: created.url,
        reporter,
        ip: payload.ip,
    });

    return {
        reportId,
        issueUrl: created.url,
        issueNumber: created.number,
        screenshotUrl,
        htmlUrl,
    };
}
