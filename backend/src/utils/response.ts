/**
 * Envelope padrão de resposta da API (issue #976 — fundação).
 *
 * Helper único usado por TODAS as rotas para garantir consistência no
 * contrato HTTP e simplificar o consumo pelo frontend/mobile, auditoria
 * e testes.
 *
 * Formato:
 *   { success: true,  data: T,                meta?: Record<string, unknown> }
 *   { success: false, error: { message, code?, details? } }
 *
 * Tipos exportados:
 *   - `ResponseEnvelope<T>`: união de sucesso e erro para `data: T`.
 *   - `ErrorBody`:           payload de `error` em respostas de falha.
 */
import { Response } from 'express';

/**
 * Payload de `error` em respostas de falha. `message` é a mensagem
 * humana; `code` é o código de máquina (ex.: 'RATE_LIMIT',
 * 'VALIDATION_ERROR'); `details` carrega informação extra estruturada
 * (lista de campos inválidos, etc).
 */
export interface ErrorBody {
    message: string;
    code?: string;
    details?: unknown;
}

/**
 * Ramo de sucesso: `{ success: true, data, meta? }`.
 */
export interface SuccessEnvelope<T> {
    success: true;
    data: T;
    meta?: Record<string, unknown>;
}

/**
 * Ramo de erro: `{ success: false, error }`.
 */
export interface ErrorEnvelope {
    success: false;
    error: ErrorBody;
}

/**
 * União discriminada por `success` — útil em helpers genéricos e para
 * tipar o retorno de serviços que podem falhar.
 */
export type ResponseEnvelope<T> = SuccessEnvelope<T> | ErrorEnvelope;

/**
 * 200 OK — payload genérico com metadados opcionais (paginação, totais,
 * fonte do dado, etc).
 *
 * @example
 *   ok(res, { id: 1, name: 'Alice' });
 *   ok(res, items, { page: 1, perPage: 20, total: 42 });
 */
export function ok<T>(res: Response, data: T, meta?: Record<string, unknown>): Response {
    const body: SuccessEnvelope<T> = { success: true, data };
    if (meta !== undefined) body.meta = meta;
    return res.status(200).json(body);
}

/**
 * 201 Created — usado tipicamente em POSTs que criam recurso. O envelope
 * inclui `data` (recurso criado); sem `meta` por design (consistente com
 * o spec da issue #976).
 */
export function created<T>(res: Response, data: T): Response {
    return res.status(201).json({ success: true, data });
}

/**
 * Falha genérica.
 *
 * Ordem dos argumentos (conforme spec da issue #976):
 *   fail(res, message, code?, status?, details?)
 *
 * - `message`: mensagem humana (obrigatória).
 * - `code`:    código de máquina — default = 'INTERNAL_ERROR'.
 * - `status`:  HTTP status — default = 400 (cliente) quando omitido.
 * - `details`: informação extra estruturada (omitida quando `undefined`).
 *
 * @example
 *   fail(res, 'Recurso não encontrado', 'NOT_FOUND', 404);
 *   fail(res, 'Muitas requisições',     'RATE_LIMIT', 429);
 *   fail(res, 'Inválido',               'VALIDATION_ERROR', 422, { field: 'email' });
 */
export function fail(
    res: Response,
    message: string,
    code?: string,
    status?: number,
    details?: unknown
): Response {
    const errorBody: ErrorBody = { message };
    if (code !== undefined) errorBody.code = code;
    if (details !== undefined) errorBody.details = details;

    return res.status(status ?? 400).json({
        success: false,
        error: errorBody
    });
}

export default {
    ok,
    created,
    fail,
};
