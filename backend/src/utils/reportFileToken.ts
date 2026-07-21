// Tokens assinados p/ servir arquivos de report (screenshot) — issue #1562.
//
// Esquema idêntico ao `deeplinkToken.ts` (HMAC-SHA256, base64url, comparação
// timing-safe) mas com `kind` discriminado em `'report-file'` e payload
// `{ reportId, ext, iat, exp }`. Mantido em arquivo separado p/ (a) não
// misturar com HITL/deeplink (são canais de auth diferentes) e (b) deixar
// o contrato de "qualquer um com o link temporário pode baixar o print"
// explícito e auditável.
//
// NÃO confundir com `signDeeplink`: o token aqui NÃO autoriza escrita no
// ERP; só abre uma janela de leitura (1h) para o arquivo binário.
import crypto from 'crypto';
import { config } from '../config/env';
import { createLogger } from './logger';

const log = createLogger('ReportFileToken');

const DEV_FALLBACK = 'dev-insecure-deeplink-secret-troque-em-producao';

function secret(): string {
    if (!config.deeplinkSecret) {
        if (process.env.NODE_ENV === 'production') {
            throw new Error('DEEPLINK_TOKEN_SECRET (ou ADMIN_KEY) é obrigatório em produção — recusando usar fallback inseguro.');
        }
        log.warn('Usando segredo de DEV para tokens de report-file. Defina DEEPLINK_TOKEN_SECRET (ou ADMIN_KEY) no .env.');
        return DEV_FALLBACK;
    }
    return config.deeplinkSecret;
}

function b64url(buf: Buffer): string {
    return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(s: string): Buffer {
    let t = s.replace(/-/g, '+').replace(/_/g, '/');
    while (t.length % 4) t += '=';
    return Buffer.from(t, 'base64');
}

function hmac(body: string): string {
    return b64url(crypto.createHmac('sha256', secret()).update(body).digest());
}

export const REPORT_FILE_TOKEN_KIND = 'report-file';

export interface ReportFileTokenPayload {
    kind: typeof REPORT_FILE_TOKEN_KIND;
    reportId: string;
    ext: string;
    iat: number;
    exp: number;
}

/**
 * Assina um token de leitura para um arquivo de report.
 * `ttlSeconds` default = 3600 (1h) — atende o AC #1562.
 */
export function signReportFileToken(
    data: { reportId: string; ext: string },
    ttlSeconds = 3600,
): string {
    const now = Math.floor(Date.now() / 1000);
    const payload: ReportFileTokenPayload = {
        kind: REPORT_FILE_TOKEN_KIND,
        reportId: String(data.reportId),
        ext: String(data.ext).toLowerCase(),
        iat: now,
        exp: now + Math.max(1, Math.floor(ttlSeconds)),
    };
    const body = b64url(Buffer.from(JSON.stringify(payload)));
    return `${body}.${hmac(body)}`;
}

/**
 * Verifica assinatura, expiração e kind. Retorna o payload se válido,
 * `null` caso contrário. Comparação timing-safe da assinatura.
 */
export function verifyReportFileToken(token: string): ReportFileTokenPayload | null {
    if (!token || typeof token !== 'string') return null;
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const [body, sig] = parts;
    if (!body || !sig || !/^[A-Za-z0-9_-]+$/.test(body) || !/^[A-Za-z0-9_-]+$/.test(sig)) return null;

    const expected = hmac(body);
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

    let payload: ReportFileTokenPayload;
    try {
        payload = JSON.parse(b64urlDecode(body).toString('utf8'));
    } catch {
        return null;
    }
    if (
        payload.kind !== REPORT_FILE_TOKEN_KIND
        || typeof payload.reportId !== 'string'
        || typeof payload.ext !== 'string'
        || !Number.isInteger(payload.iat)
        || !Number.isInteger(payload.exp)
        || payload.exp <= payload.iat
    ) return null;
    if (Math.floor(Date.now() / 1000) >= payload.exp) return null;
    return payload;
}
