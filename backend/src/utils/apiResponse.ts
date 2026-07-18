/**
 * Padronização do envelope de resposta da API.
 *
 * Todas as rotas deste backend devem responder usando este envelope:
 *   { success: true,  data?: T,                meta?: { page, perPage, total, ... } }
 *   { success: false, error: { code, message, details? } }
 *
 * Manter UM ÚNICO formato simplifica o cliente (frontend/mobile), os testes
 * de contrato e a auditoria — e força todas as rotas a sinalizar sucesso/erro
 * de forma explícita em vez de "às vezes devolver o objeto, às vezes devolver
 * um array, às vezes 200 com erro embutido".
 *
 * Helpers tipados (generics) preservam o tipo de `data` no caller.
 */
import { Response } from 'express';

/**
 * Resposta de sucesso genérica. `data` carrega o payload útil; `meta` é
 * reservado para envelope (paginação, totais, cursores, etc).
 */
export interface ApiSuccess<T> {
    success: true;
    data: T;
    meta?: ApiMeta;
}

/**
 * Resposta de erro. `code` é o código de máquina (ex.: 'VALIDATION_ERROR',
 * 'RATE_LIMIT'); `message` é a mensagem humana; `details` carrega
 * informação extra estruturada (ex.: lista de campos inválidos).
 */
export interface ApiErrorBody {
    success: false;
    error: {
        code: string;
        message: string;
        details?: unknown;
    };
}

/**
 * Metadados opcionais do envelope (paginação, totais, links, etc).
 * Campos extras (`[key: string]: unknown`) aceitam extensões futuras
 * sem quebrar o tipo.
 */
export interface ApiMeta {
    page?: number;
    perPage?: number;
    total?: number;
    [key: string]: unknown;
}

/**
 * União de todas as respostas possíveis — útil em helpers genéricos.
 */
export type ApiResponse<T> = ApiSuccess<T> | ApiErrorBody;

/**
 * 200 OK — payload genérico com metadados opcionais.
 */
export function ok<T>(res: Response, data: T, meta?: ApiMeta): Response {
    const body: ApiSuccess<T> = { success: true, data };
    if (meta) body.meta = meta;
    return res.status(200).json(body);
}

/**
 * 201 Created — usado tipicamente em POSTs que criam recurso.
 * O envelope inclui `data` (recurso criado); metadados opcionais.
 */
export function created<T>(res: Response, data: T, meta?: ApiMeta): Response {
    const body: ApiSuccess<T> = { success: true, data };
    if (meta) body.meta = meta;
    return res.status(201).json(body);
}

/**
 * Falha genérica — `status` default = 400 (cliente) quando omitido.
 * O caller é responsável por escolher o status apropriado (400, 401,
 * 403, 404, 409, 422, 429, 500, ...).
 */
export function fail(
    res: Response,
    code: string,
    message: string,
    status: number = 400,
    details?: unknown
): Response {
    const body: ApiErrorBody = {
        success: false,
        error: { code, message }
    };
    if (details !== undefined) body.error.details = details;
    return res.status(status).json(body);
}

/**
 * 200 OK paginado — atalho que preenche `meta.page/perPage/total` no
 * envelope. Items já devem vir prontos (fatiados) do caller.
 */
export function paginated<T>(
    res: Response,
    items: T[],
    page: number,
    perPage: number,
    total: number,
    extra?: Record<string, unknown>
): Response {
    const meta: ApiMeta = { page, perPage, total, ...(extra || {}) };
    const body: ApiSuccess<T[]> = {
        success: true,
        data: items,
        meta
    };
    return res.status(200).json(body);
}

/**
 * 204 No Content — usado em DELETEs bem-sucedidos e outros comandos sem
 * payload de retorno. Não envia corpo.
 */
export function noContent(res: Response): Response {
    return res.status(204).send();
}

export default {
    ok,
    created,
    fail,
    paginated,
    noContent,
};