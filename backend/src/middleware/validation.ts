/**
 * Request Validation Middleware
 *
 * Uses Zod for schema validation with proper error handling.
 *
 * Erros de validação são SEMPRE propagados via `next(validationError)`
 * para o errorHandler global — NUNCA escreve direto na resposta. Isso
 * garante: (1) envelope padronizado via `fail(...)`, (2) sanitização
 * consistente das mensagens em produção, (3) log centralizado no
 * errorHandler.
 *
 * Os middlewares (`validateBody`/`validateQuery`/`validateParams`) gravam
 * os dados parseados em DUAS superfícies:
 *
 *  1. `req.body` / `req.query` / `req.params` — mantém a API Express
 *     compatível (handlers legados continuam funcionando).
 *  2. `req.validated.body` / `req.validated.query` / `req.validated.params`
 *     — superfície paralela usada em handlers novos (issue #1544) para
 *     evitar `req.body as z.infer<...>`: o cast bypassa o type checker
 *     e, se o middleware for removido ou alterado, o TypeScript não
 *     detecta a incompatibilidade. Com `req.validated`, o tipo real é
 *     carregado pelo `z.infer<typeof Schema>` e lido pelos helpers
 *     `validatedBody`/`validatedQuery`/`validatedParams`.
 *
 * Erros são propagados via `next(validationError)` para o errorHandler
 * global, que monta o envelope padronizado e o status 400.
 */

import { Request, Response, NextFunction } from 'express';
import { z, ZodError, ZodSchema } from 'zod';
import { ValidationError } from './errorHandler';

/**
 * Bag de dados validados anexada a cada `Request` pelos middlewares
 * `validateBody`/`validateQuery`/`validateParams`. Cada chave só é
 * preenchida se o middleware correspondente rodou antes do handler —
 * acessar uma chave ausente indica erro de programação (middleware
 * faltando) e os helpers `validatedBody/Query/Params` tratam isso
 * como `undefined` em vez de explodir, para não acoplar handlers a
 * checagens redundantes.
 */
export interface ValidatedRequestBag {
    body?: unknown;
    query?: unknown;
    params?: unknown;
}

/**
 * Augmenta o tipo `Request` do Express para incluir `req.validated`.
 * Sem isso, o TypeScript não reconhece o novo campo e força `as any`
 * nos handlers — exatamente o que queremos evitar.
 */
declare global {
    // eslint-disable-next-line @typescript-eslint/no-namespace
    namespace Express {
        interface Request {
            validated?: ValidatedRequestBag;
        }
    }
}

/**
 * Formato canônico de cada item em `details` de uma ValidationError —
 * `{ field, message }` onde `field` é o path Zod (dot-notation).
 */
export interface ValidationIssue {
    field: string;
    message: string;
}

/**
 * Constrói uma ValidationError tipada a partir de um ZodError. O `source`
 * é incorporado na mensagem ("body", "query", "params") para que o cliente
 * saiba qual parte do request falhou.
 */
function buildValidationError(zodError: ZodError, source: 'body' | 'query' | 'params'): ValidationError {
    const messages: Record<typeof source, string> = {
        body: 'Validation failed',
        query: 'Invalid query parameters',
        params: 'Invalid route parameters',
    };
    const details: ValidationIssue[] = zodError.issues.map((issue: z.ZodIssue) => ({
        field: issue.path.join('.'),
        message: issue.message,
    }));
    return new ValidationError(messages[source], details);
}

/**
 * Escreve o valor parseado em `req.validated` (e, quando aplicável, na
 * superfície Express padrão `req.body`/`req.query`/`req.params`). Usado
 * pelos 3 middlewares abaixo para manter as duas representações
 * sincronizadas.
 */
function attachValidated(req: Request, source: 'body' | 'query' | 'params', parsed: unknown): void {
    const bag: ValidatedRequestBag = req.validated || {};
    bag[source] = parsed;
    req.validated = bag;
}

/**
 * Creates a validation middleware for request body
 */
export function validateBody<T extends ZodSchema>(schema: T) {
    return (req: Request, _res: Response, next: NextFunction) => {
        try {
            const parsed = schema.parse(req.body);
            req.body = parsed;
            attachValidated(req, 'body', parsed);
            next();
        } catch (error) {
            if (error instanceof ZodError) {
                return next(buildValidationError(error, 'body'));
            }
            next(error);
        }
    };
}

/**
 * Creates a validation middleware for query parameters
 */
export function validateQuery<T extends ZodSchema>(schema: T) {
    return (req: Request, _res: Response, next: NextFunction) => {
        try {
            const parsed = schema.parse(req.query);
            req.query = parsed as Request['query'];
            attachValidated(req, 'query', parsed);
            next();
        } catch (error) {
            if (error instanceof ZodError) {
                return next(buildValidationError(error, 'query'));
            }
            next(error);
        }
    };
}

/**
 * Creates a validation middleware for route parameters
 */
export function validateParams<T extends ZodSchema>(schema: T) {
    return (req: Request, _res: Response, next: NextFunction) => {
        try {
            const parsed = schema.parse(req.params);
            req.params = parsed as Record<string, string>;
            attachValidated(req, 'params', parsed);
            next();
        } catch (error) {
            if (error instanceof ZodError) {
                return next(buildValidationError(error, 'params'));
            }
            next(error);
        }
    };
}

/**
 * Helpers tipados para leitura do bag `req.validated` (issue #1544).
 * Substituem o padrão `req.body as z.infer<typeof X>` — o cast bypassa o
 * type checker; aqui o tipo é inferido a partir do schema passado e
 * verificado em runtime via `req.validated` (populado pelo middleware).
 *
 * Uso:
 *   const data = validatedBody(req, MySchema);   // tipado, sem `as`
 *   const q    = validatedQuery(req, QSchema);
 *   const p    = validatedParams(req, PSchema);
 *
 * Retornam `undefined` se o middleware correspondente não rodou — o handler
 * decide se isso é erro (ex.: `if (!data) throw ...`) ou se aceita a ausência
 * (ex.: schemas parciais com `.partial()`).
 */
export function validatedBody<S extends ZodSchema>(req: Request, _schema: S): z.infer<S> | undefined {
    return req.validated?.body as z.infer<S> | undefined;
}

export function validatedQuery<S extends ZodSchema>(req: Request, _schema: S): z.infer<S> | undefined {
    return req.validated?.query as z.infer<S> | undefined;
}

export function validatedParams<S extends ZodSchema>(req: Request, _schema: S): z.infer<S> | undefined {
    return req.validated?.params as z.infer<S> | undefined;
}

// =============================================
// Banking Schemas
// =============================================

/**
 * Boleto payment schema
 */
export const PagamentoBoletoSchema = z.object({
    codBarraLinhaDigitavel: z.string()
        .min(44, 'Código de barras deve ter no mínimo 44 dígitos')
        .max(48, 'Código de barras deve ter no máximo 48 dígitos')
        .regex(/^[\d.]+$/, 'Código de barras deve conter apenas números e pontos'),
    valorPagar: z.number()
        .positive('Valor deve ser positivo')
        .max(10000000, 'Valor máximo: R$ 10.000.000,00'),
    dataPagamento: z.string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, 'Data deve estar no formato YYYY-MM-DD')
        .optional(),
    descricao: z.string().max(500).optional()
});

/**
 * Pix charge creation schema
 */
export const PixCobrancaSchema = z.object({
    valor: z.object({
        original: z.string()
            .regex(/^\d+\.\d{2}$/, 'Valor deve estar no formato 0.00')
    }),
    chave: z.string()
        .min(1, 'Chave Pix é obrigatória'),
    devedor: z.object({
        cpf: z.string()
            .length(11, 'CPF deve ter 11 dígitos')
            .regex(/^\d+$/, 'CPF deve conter apenas números')
            .optional(),
        cnpj: z.string()
            .length(14, 'CNPJ deve ter 14 dígitos')
            .regex(/^\d+$/, 'CNPJ deve conter apenas números')
            .optional(),
        nome: z.string().min(1).max(200)
    }).refine(data => data.cpf || data.cnpj, {
        message: 'CPF ou CNPJ é obrigatório'
    }),
    solicitacaoPagador: z.string().max(140).optional(),
    infoAdicionais: z.array(z.object({
        nome: z.string().max(50),
        valor: z.string().max(200)
    })).optional()
});

/**
 * Pix payment schema
 */
export const PixPagamentoSchema = z.object({
    valor: z.number()
        .positive('Valor deve ser positivo')
        .max(10000000, 'Valor máximo: R$ 10.000.000,00'),
    descricao: z.string().max(140).optional(),
    destinatario: z.object({
        tipo: z.enum(['CHAVE', 'DADOS_BANCARIOS']),
        chave: z.string().optional(),
        banco: z.string().optional(),
        agencia: z.string().optional(),
        conta: z.string().optional(),
        tipoConta: z.enum(['CORRENTE', 'POUPANCA']).optional(),
        cpfCnpj: z.string().optional(),
        nome: z.string().optional()
    }).refine(data => {
        if (data.tipo === 'CHAVE') return !!data.chave;
        if (data.tipo === 'DADOS_BANCARIOS') {
            return data.banco && data.agencia && data.conta && data.cpfCnpj;
        }
        return false;
    }, {
        message: 'Dados do destinatário incompletos'
    })
});

/**
 * Boleto creation schema
 */
export const BoletoEmissaoSchema = z.object({
    seuNumero: z.string().max(15),
    valorNominal: z.number()
        .positive('Valor deve ser positivo')
        .max(10000000, 'Valor máximo: R$ 10.000.000,00'),
    dataVencimento: z.string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, 'Data deve estar no formato YYYY-MM-DD'),
    numDiasAgenda: z.number().int().min(0).max(60).optional(),
    pagador: z.object({
        cpfCnpj: z.string()
            .min(11, 'CPF/CNPJ inválido')
            .max(14, 'CPF/CNPJ inválido'),
        tipoPessoa: z.enum(['FISICA', 'JURIDICA']),
        nome: z.string().min(1).max(100),
        endereco: z.string().max(90).optional(),
        cidade: z.string().max(60).optional(),
        uf: z.string().length(2).optional(),
        cep: z.string().length(8).regex(/^\d+$/).optional(),
        email: z.string().email().optional(),
        telefone: z.string().max(15).optional()
    }),
    mensagem: z.object({
        linha1: z.string().max(78).optional(),
        linha2: z.string().max(78).optional(),
        linha3: z.string().max(78).optional(),
        linha4: z.string().max(78).optional(),
        linha5: z.string().max(78).optional()
    }).optional(),
    desconto: z.object({
        codigoDesconto: z.enum(['NAOTEMDESCONTO', 'VALORFIXODATAINFORMADA', 'PERCENTUALDATAINFORMADA']),
        data: z.string().optional(),
        taxa: z.number().optional(),
        valor: z.number().optional()
    }).optional(),
    multa: z.object({
        codigoMulta: z.enum(['NAOTEMMULTA', 'VALORFIXO', 'PERCENTUAL']),
        data: z.string().optional(),
        taxa: z.number().optional(),
        valor: z.number().optional()
    }).optional(),
    mora: z.object({
        codigoMora: z.enum(['VALORDIA', 'TAXAMENSAL', 'ISENTO']),
        data: z.string().optional(),
        taxa: z.number().optional(),
        valor: z.number().optional()
    }).optional()
});

/**
 * Date range query schema
 */
export const DateRangeSchema = z.object({
    dataInicial: z.string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, 'Data deve estar no formato YYYY-MM-DD'),
    dataFinal: z.string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, 'Data deve estar no formato YYYY-MM-DD'),
    pagina: z.string().regex(/^\d+$/).transform(Number).optional(),
    tamanhoPagina: z.string().regex(/^\d+$/).transform(Number).optional()
});

/**
 * ID parameter schema
 */
export const IdParamSchema = z.object({
    id: z.string().min(1, 'ID é obrigatório')
});

/**
 * TxId parameter schema (for Pix)
 */
export const TxIdParamSchema = z.object({
    txid: z.string()
        .min(26, 'TxId deve ter no mínimo 26 caracteres')
        .max(35, 'TxId deve ter no máximo 35 caracteres')
        .regex(/^[a-zA-Z0-9]+$/, 'TxId deve conter apenas caracteres alfanuméricos')
});

// =============================================
// Webhook Schemas
// =============================================

/**
 * Pix webhook payload schema
 */
export const PixWebhookSchema = z.object({
    pix: z.array(z.object({
        endToEndId: z.string(),
        txid: z.string().optional(),
        valor: z.string(),
        horario: z.string(),
        infoPagador: z.string().optional(),
        devolucoes: z.array(z.any()).optional()
    })).optional()
});

/**
 * Boleto webhook payload schema
 */
export const BoletoWebhookSchema = z.object({
    codigoSolicitacao: z.string().optional(),
    seuNumero: z.string().optional(),
    situacao: z.enum(['EMABERTO', 'PAGO', 'CANCELADO', 'EXPIRADO', 'VENCIDO']).optional(),
    dataSituacao: z.string().optional(),
    valorNominal: z.number().optional(),
    valorTotalRecebimento: z.number().optional()
});

export default {
    validateBody,
    validateQuery,
    validateParams,
    PagamentoBoletoSchema,
    PixCobrancaSchema,
    PixPagamentoSchema,
    BoletoEmissaoSchema,
    DateRangeSchema,
    IdParamSchema,
    TxIdParamSchema,
    PixWebhookSchema,
    BoletoWebhookSchema
};