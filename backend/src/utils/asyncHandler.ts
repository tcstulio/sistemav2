import type { Request, Response, NextFunction } from 'express';

type DefaultParams = Request['params'];
type DefaultQuery = Request['query'];

/**
 * Tipo genérico para um handler assíncrono do Express.
 *
 * Preserva os tipos padrão do Express para `req`, `res` e `next`
 * (`Request`, `Response`, `NextFunction`) e propaga os generics usuais
 * (parâmetros de rota, corpo de resposta, corpo de requisição e query)
 * para que `req.params`, `req.body` e `req.query` permaneçam fortemente
 * tipados dentro do handler. O retorno é `Promise<unknown> | void`,
 * aceitando tanto handlers `async` quanto handlers síncronos.
 */
export type AsyncRequestHandler<
    P = DefaultParams,
    ResBody = unknown,
    ReqBody = unknown,
    ReqQuery = DefaultQuery
> = (
    req: Request<P, ResBody, ReqBody, ReqQuery>,
    res: Response<ResBody>,
    next: NextFunction
) => Promise<unknown> | void;

/**
 * Wrapper para handlers assíncronos do Express que captura rejeições
 * (e qualquer erro lançado via Promise) e as encaminha automaticamente
 * para `next(error)`. Isso evita que promises rejeitadas em handlers
 * async virem `unhandledRejection` no processo Node e garante que o
 * error-handler middleware do Express receba o erro como aconteceria
 * para um handler síncrono que lançasse via `throw`.
 *
 * O wrapper retorna um handler Express compatível com o tipo
 * `RequestHandler`, podendo ser usado em qualquer lugar que aceite
 * um handler de rota/middleware normal (`router.get/post/...`,
 * `app.use`, cadeias de middleware, etc.).
 *
 * @example
 *   router.post(
 *     '/generate',
 *     aiLimiter,
 *     asyncHandler(async (req, res) => {
 *       const { data } = schema.parse(req.body);
 *       const result = await aiService.generate(data);
 *       res.ok({ result });
 *     })
 *   );
 */
export function asyncHandler<
    P = DefaultParams,
    ResBody = unknown,
    ReqBody = unknown,
    ReqQuery = DefaultQuery
>(
    fn: AsyncRequestHandler<P, ResBody, ReqBody, ReqQuery>
): (
    req: Request<P, ResBody, ReqBody, ReqQuery>,
    res: Response<ResBody>,
    next: NextFunction
) => void {
    return (req, res, next) => {
        Promise.resolve(fn(req, res, next)).catch(next);
    };
}