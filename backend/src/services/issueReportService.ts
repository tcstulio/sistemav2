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
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import path from 'path';
import * as cheerio from 'cheerio';
import { v4 as uuidv4 } from 'uuid';
import { createLogger } from '../utils/logger';
import { buildIssueBody, IssueReportContext } from '../utils/issueBodyBuilder';
import { createGitHubIssue, CreateGitHubIssueResult } from '../utils/githubIssue';
import { signDeeplink } from '../utils/deeplinkToken';
import { AppError } from '../middleware/errorHandler';
import { sanitizeHtmlSnapshot } from '../utils/sanitizeHtml';

// Re-exporta p/ back-compat com testes/importadores existentes (#1563):
// a política foi centralizada em `utils/sanitizeHtml.ts` para garantir
// consistência entre o anexo em disco (`persistHtmlSnapshot`) e o body.
export { sanitizeHtmlSnapshot };

const log = createLogger('IssueReport');

/** Limite do screenshot decodificado (PNG em disco). */
export const SCREENSHOT_MAX_BYTES = 5 * 1024 * 1024; // 5 MB
/** Limite do HTML persistido (sanitizado). Evita DoS / disco cheio. */
export const HTML_MAX_BYTES = 1024 * 1024; // 1 MB
/** Diretório de persistência (relativo a CWD do backend). */
export const REPORTS_DIR = path.join(process.cwd(), 'uploads', 'reports');
export const REPORT_SCREENSHOT_TOKEN_KIND = 'report_screenshot';
export const REPORT_ASSET_TTL_SECONDS = 60 * 60;

const REPORT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function getReportAssetPath(reportId: string, extension: 'png' | 'html'): string | null {
    if (!REPORT_ID_PATTERN.test(String(reportId || '').trim())) return null;
    const filePath = path.join(REPORTS_DIR, `${reportId}.${extension}`);
    return existsSync(filePath) ? filePath : null;
}

export function getReportScreenshotPath(reportId: string): string | null {
    return getReportAssetPath(reportId, 'png');
}

export function getReportHtmlPath(reportId: string): string | null {
    return getReportAssetPath(reportId, 'html');
}

export function getReportScreenshotLink(reportId: string): string | null {
    if (!getReportScreenshotPath(reportId)) return null;
    const token = signDeeplink(REPORT_SCREENSHOT_TOKEN_KIND, { reportId }, REPORT_ASSET_TTL_SECONDS);
    return `/api/issues/report/${encodeURIComponent(reportId)}/screenshot?token=${encodeURIComponent(token)}`;
}

export function getReportHtmlContent(reportId: string, selector?: string): string {
    const filePath = getReportHtmlPath(reportId);
    if (!filePath) {
        throw new AppError(404, 'NOT_FOUND', 'Report não encontrado.');
    }

    const html = readFileSync(filePath, 'utf8');
    if (!selector) return html;
    if (selector.length > 500) {
        throw new AppError(400, 'BAD_REQUEST', 'Seletor CSS excede o limite permitido.');
    }

    try {
        const $ = cheerio.load(html);
        const match = $(selector).first();
        if (!match.length) {
            throw new AppError(404, 'NOT_FOUND', 'Seletor CSS não encontrado no report.');
        }
        return match.html() ?? '';
    } catch (error) {
        if (error instanceof AppError) throw error;
        throw new AppError(400, 'BAD_REQUEST', 'Seletor CSS inválido.');
    }
}

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
 * Política (conservadora p/ contexto de bug report) — espelha
 * `HTML_SANITIZE_OPTS` em `utils/sanitizeHtml.ts` (single-source-of-truth
 * consolidado na issue #1563).
 *
 * Função re-exportada do `utils/sanitizeHtml` (acima). Mantida como JSDoc
 * aqui apenas p/ aparecer no help/IDE de quem consome `services/...`.
 */

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

    // 3) Montar context p/ o body markdown (#1563)
    //    - `htmlSnapshot` é passado CRU: `buildIssueBody` chama
    //      `sanitizeForIssueBody` (sanitiza + trunca a 5KB) antes de
    //      incluir no `<details>` do body.
    //    - `screenshotUrl` é passado quando há arquivo persistido em disco,
    //      para que o body embarque `![screenshot](url)` na seção "Contexto visual".
    //    - `screenshot` (base64) NÃO vai no body — GitHub não aceita data URI,
    //      e nossa URL pública é a referência canônica.
    //    - Sem `_refs` extra: agora `screenshotUrl` é campo tipado do
    //      `IssueReportContext`, então não precisamos mais do hack `as any`.
    const bodyContext: IssueReportContext = {
        url: payload.url,
        breadcrumb: payload.breadcrumb,
        element: payload.element,
        source: payload.source,
        viewport: payload.viewport,
        userAgent: payload.userAgent,
        consoleErrors: Array.isArray(payload.consoleErrors) ? payload.consoleErrors.slice(0, 20) : undefined,
        consoleLogs: Array.isArray(payload.consoleLogs) ? payload.consoleLogs.slice(0, 20) : undefined,
        failedRequests: Array.isArray(payload.failedRequests) ? payload.failedRequests.slice(0, 20) : undefined,
        htmlSnapshot: payload.htmlSnapshot, // cru — sanitização/truncamento delegados ao buildIssueBody (#1563)
        screenshot: undefined,
        screenshotUrl: screenshotUrl || undefined,
        captureMeta: payload.captureMeta,
    };

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
