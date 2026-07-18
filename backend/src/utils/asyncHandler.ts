import { NextFunction, Request, RequestHandler, Response } from 'express';

/**
 * Assinatura de um handler Express (async ou síncrono) cujos tipos
 * de `req` e `res` são preservados via generics para inferência completa.
 *
 * O parâmetro `next` é exposto para handlers que precisam delegar para o
 * próximo middleware sem lançar (ex.: fallbacks), mas o uso típico omite-o.
 */
export type AsyncRequestHandler<
    Req extends Request = Request,
    Res extends Response = Response,
> = (
    req: Req,
    res: Res,
    next: NextFunction,
) => Promise<unknown> | unknown;

/**
 * Wrapper para handlers do Express que captura rejeições de promises e
 * exceções síncronas e as encaminha automaticamente para `next(error)`,
 * eliminando a necessidade de `try/catch` em cada rota.
 *
 * O tipo genérico preserva `Request`, `Response` e `NextFunction` para que
 * `req.params`, `req.body`, helpers de resposta customizados etc. mantenham
 * a inferência original do handler passado.
 *
 * @example
 * ```ts
 * import { Router } from 'express';
 * import { asyncHandler } from './utils/asyncHandler';
 *
 * const router = Router();
 *
 * router.post(
 *   '/generate',
 *   aiLimiter,
 *   asyncHandler(async (req, res) => {
 *     const { data } = schema.parse(req.body);
 *     const result = await aiService.generate(data);
 *     res.ok({ result });
 *   }),
 * );
 * ```
 */
export function asyncHandler<
    Req extends Request = Request,
    Res extends Response = Response,
>(handler: AsyncRequestHandler<Req, Res>): RequestHandler {
    return (req, res, next) => {
        Promise.resolve(handler(req as Req, res as Res, next)).catch(next);
    };
}