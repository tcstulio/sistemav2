// Tokens de deeplink assinados (HMAC-SHA256) com expiração — stateless.
// Usados pelas ferramentas de ESCRITA do agente (#57 Peça 2): o agente NÃO escreve
// direto no ERP; ele gera um deeplink assinado que pré-preenche uma tela do sistemav2,
// onde o usuário REVISA e CONFIRMA (HITL) usando a própria autenticação.
//
// Formato do token: base64url(payload).base64url(hmac(payload))
//   payload = { kind, data, iat, exp }
// O segredo (config.deeplinkSecret) nunca sai do backend; a verificação acontece aqui.
import crypto from 'crypto';
import { config } from '../config/env';
import { createLogger } from './logger';

const log = createLogger('DeeplinkToken');

// Fallback de DEV apenas: em produção deve haver DEEPLINK_TOKEN_SECRET ou ADMIN_KEY.
const DEV_FALLBACK = 'dev-insecure-deeplink-secret-troque-em-producao';

function secret(): string {
    if (!config.deeplinkSecret) {
        // Em produção, recusar o fallback conhecido (qualquer um assinaria deeplinks de escrita).
        if (process.env.NODE_ENV === 'production') {
            throw new Error('DEEPLINK_TOKEN_SECRET (ou ADMIN_KEY) é obrigatório em produção — recusando usar fallback inseguro.');
        }
        log.warn('Usando segredo de DEV para deeplink. Defina DEEPLINK_TOKEN_SECRET (ou ADMIN_KEY) no .env.');
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

export interface DeeplinkPayload<T = any> {
    kind: string;
    data: T;
    iat: number; // emitido em (segundos epoch)
    exp: number; // expira em (segundos epoch)
}

/** Assina um deeplink. `ttlSeconds` padrão = 30 min. */
export function signDeeplink(kind: string, data: any, ttlSeconds = 1800): string {
    const now = Math.floor(Date.now() / 1000);
    const payload: DeeplinkPayload = { kind, data, iat: now, exp: now + ttlSeconds };
    const body = b64url(Buffer.from(JSON.stringify(payload)));
    return `${body}.${hmac(body)}`;
}

/** Verifica assinatura + expiração + tipo. Retorna o payload ou null se inválido. */
export function verifyDeeplink<T = any>(token: string, expectedKind?: string): DeeplinkPayload<T> | null {
    if (!token || typeof token !== 'string' || !token.includes('.')) return null;
    const [body, sig] = token.split('.');
    if (!body || !sig) return null;

    // Comparação timing-safe da assinatura
    const expected = hmac(body);
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

    let payload: DeeplinkPayload<T>;
    try {
        payload = JSON.parse(b64urlDecode(body).toString('utf8'));
    } catch {
        return null;
    }
    if (expectedKind && payload.kind !== expectedKind) return null;
    if (!payload.exp || Math.floor(Date.now() / 1000) > payload.exp) return null;
    return payload;
}
