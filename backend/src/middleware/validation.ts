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
 */

import { Request, Response, NextFunction } from 'express';
import { z, ZodError, ZodSchema } from 'zod';
import { ValidationError } from './errorHandler';
import apiResponse from '../utils/apiResponse';

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
 * Creates a validation middleware for request body
 */
export function validateBody<T extends ZodSchema>(schema: T) {
    return (req: Request, _res: Response, next: NextFunction) => {
        try {
            req.body = schema.parse(req.body);
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
            req.query = schema.parse(req.query) as any;
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
            req.params = schema.parse(req.params) as any;
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
 * Formato aceito para o header de API key do usuário (`dolapikey` / `userApiKey`):
 * apenas caracteres alfanuméricos, comprimento 32–128. Chaves com espaços,
 * símbolos ou tamanho fora da faixa indicam header forjado/corrompido e são
 * rejeitadas com 401 ANTES de qualquer uso downstream (ex.: repasse à API do
 * Dolibarr). Chaves do Dolibarr são alfanuméricas de 32 caracteres.
 */
export const USER_API_KEY_REGEX = /^[A-Za-z0-9]{32,128}$/;

/**
 * Middleware que valida o formato do header de API key quando ele está presente.
 *
 * - Ausente → segue o fluxo. A autenticação de sessão (`requireDolibarrLogin`)
 *   continua sendo a barreira; nem toda rota exige a chave via header.
 * - Presente e MALFORMADA → 401 `INVALID_API_KEY` (envelope apiResponse).
 * - Presente e válida → segue o fluxo.
 *
 * Aceita tanto o header canônico do Dolibarr (`dolapikey`) quanto o alias
 * `userapikey` citado na issue #1542.
 */
export function validateUserApiKey(req: Request, res: Response, next: NextFunction): void {
    const raw = req.headers['dolapikey'] ?? req.headers['userapikey'];
    if (raw === undefined) {
        next();
        return;
    }
    const key = Array.isArray(raw) ? raw[0] : raw;
    if (typeof key !== 'string' || !USER_API_KEY_REGEX.test(key)) {
        apiResponse.fail(res, 'INVALID_API_KEY', 'Header de API key inválido', 401);
        return;
    }
    next();
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

// =============================================
// Banking Route Schemas (issue #1542)
// =============================================

/** Id de recurso — string não-vazia ou número. */
const resourceId = z.union([z.string().min(1), z.number()]);

/**
 * Payload com um array de transações (endpoints categorize / anomalies).
 * `.passthrough()` mantém os campos de cada transação intactos (a rota apenas
 * converte `date` em `Date` antes de repassar ao serviço).
 */
export const TransactionsSchema = z.object({
    transactions: z.array(z.any())
}).passthrough();

/** Insights de fluxo de caixa — exige contas e transações. */
export const CashFlowInsightsSchema = z.object({
    accounts: z.array(z.any()),
    transactions: z.array(z.any()),
    period: z.string().optional()
}).passthrough();

/** Dados de gráfico de fluxo de caixa. */
export const ChartDataSchema = z.object({
    transactions: z.array(z.any()),
    groupBy: z.string().optional()
}).passthrough();

/** Sugestão de conciliação — exige linhas bancárias e faturas. */
export const ReconcileSuggestSchema = z.object({
    bankLines: z.array(z.any()),
    invoices: z.array(z.any())
}).passthrough();

/** Salvar conciliação (legado, exige invoiceId). */
export const ReconcileSaveSchema = z.object({
    lineId: resourceId,
    invoiceId: resourceId
}).passthrough();

/** Alternar o estado de conciliação de uma linha bancária. */
export const ReconcileToggleSchema = z.object({
    accountId: resourceId,
    lineId: resourceId,
    reconciled: z.boolean()
}).passthrough();

/** Cálculo de saldo dinâmico. */
export const BalanceCalculateSchema = z.object({
    initialBalance: z.number(),
    transactions: z.array(z.any())
}).passthrough();

// =============================================
// Inter Route Schemas (issue #1542)
// =============================================

/**
 * Criação de cobrança Pix imediata. `.passthrough()` preserva os campos extras
 * (devedor, solicitacaoPagador, infoAdicionais…) exigidos pela API do Inter —
 * a rota valida apenas o mínimo obrigatório (valor + chave).
 */
export const InterPixCobrancaSchema = z.object({
    valor: z.object({
        original: z.union([z.string(), z.number()])
    }).passthrough(),
    chave: z.string().min(1, 'Chave Pix é obrigatória'),
    txid: z.string().optional()
}).passthrough();

/** Cobrança Pix com vencimento — exige txid. */
export const InterPixCobrancaVencimentoSchema = z.object({
    txid: z.string().min(1, 'txid é obrigatório para cobranças agendadas')
}).passthrough();

/** Envio de Pix — exige valor e destinatário. */
export const InterPixEnviarSchema = z.object({
    valor: z.union([z.number(), z.string()]),
    destinatario: z.object({}).passthrough()
}).passthrough();

/** Emissão de boleto — campos mínimos exigidos pela rota. */
export const InterBoletoEmissaoSchema = z.object({
    seuNumero: z.union([z.string(), z.number()]),
    valorNominal: z.number(),
    dataVencimento: z.string().min(1),
    pagador: z.object({}).passthrough()
}).passthrough();

/** Cancelamento de boleto — motivo opcional. */
export const InterBoletoCancelarSchema = z.object({
    motivo: z.string().max(500).optional()
}).passthrough();

/** Configuração de webhook Pix — exige chave e URL. */
export const InterWebhookConfigSchema = z.object({
    chave: z.string().min(1, 'chave é obrigatória'),
    webhookUrl: z.string().url('webhookUrl deve ser uma URL válida')
}).passthrough();

/**
 * Payload de RECEBIMENTO de webhook do Inter (Pix/Boleto).
 *
 * Deliberadamente permissivo (`.passthrough()`): garante apenas que o corpo é
 * um objeto JSON — a barreira de segurança real do webhook é a verificação de
 * assinatura HMAC. Um schema estrito arriscaria REJEITAR ou DESCARTAR campos de
 * callbacks legítimos do banco (ex.: novos status de boleto), então validamos
 * só o formato e preservamos todos os campos para `processInterWebhook`.
 */
export const InterWebhookPayloadSchema = z.object({}).passthrough();

export default {
    validateBody,
    validateQuery,
    validateParams,
    validateUserApiKey,
    PagamentoBoletoSchema,
    PixCobrancaSchema,
    PixPagamentoSchema,
    BoletoEmissaoSchema,
    DateRangeSchema,
    IdParamSchema,
    TxIdParamSchema,
    PixWebhookSchema,
    BoletoWebhookSchema,
    TransactionsSchema,
    CashFlowInsightsSchema,
    ChartDataSchema,
    ReconcileSuggestSchema,
    ReconcileSaveSchema,
    ReconcileToggleSchema,
    BalanceCalculateSchema,
    InterPixCobrancaSchema,
    InterPixCobrancaVencimentoSchema,
    InterPixEnviarSchema,
    InterBoletoEmissaoSchema,
    InterBoletoCancelarSchema,
    InterWebhookConfigSchema,
    InterWebhookPayloadSchema
};