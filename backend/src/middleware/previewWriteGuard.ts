import { Request, Response, NextFunction } from 'express';
import { createLogger } from '../utils/logger';

const log = createLogger('PreviewGuard');

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * #1377 fail-CLOSED: um backend de PREVIEW (PREVIEW_MODE=1) sem sandbox ativo
 * (PREVIEW_SANDBOX_ACTIVE!=1) NÃO pode escrever no Dolibarr — senão um POST manual na tela de
 * preview escreveria na PRODUÇÃO (o .env do preview aponta pra prod quando o sandbox não está
 * configurado). Retorna true quando a requisição é uma ESCRITA (não-GET) que deve ser bloqueada.
 * Fora de preview, ou com sandbox ativo, ou em leitura ⇒ false (não bloqueia).
 */
export function isPreviewWriteBlocked(method: string, env: NodeJS.ProcessEnv = process.env): boolean {
    const previewNoSandbox = env.PREVIEW_MODE === '1' && env.PREVIEW_SANDBOX_ACTIVE !== '1';
    const isWrite = !SAFE_METHODS.has(String(method || '').toUpperCase());
    return previewNoSandbox && isWrite;
}

/** Middleware que aplica o fail-closed de #1377 no proxy /api/dolibarr. */
export function previewWriteGuard(req: Request, res: Response, next: NextFunction): void {
    if (isPreviewWriteBlocked(req.method)) {
        log.warn(`Preview fail-closed: ${req.method} ${req.originalUrl} em /api/dolibarr BLOQUEADO (preview sem sandbox — não escreve na prod).`);
        res.status(503).json({ error: 'Preview sem sandbox: escrita no Dolibarr desabilitada (fail-closed). Configure PREVIEW_DOLIBARR_URL/KEY para escrever no sandbox.' });
        return;
    }
    next();
}
