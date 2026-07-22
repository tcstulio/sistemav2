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
// Banking Schemas (Import / Analyze / Insights / Reconciliation)
// =============================================

/**
 * Per-field schema for a single transaction line used by analyze / insights / balance.
 * Permissive — campos opcionais suficientes p/ casar com o que o backend já aceitava.
 */
const TransactionSchema = z.object({
    id: z.string().optional(),
    date: z.union([z.string(), z.date()]).optional(),
    amount: z.number().optional(),
    description: z.string().optional(),
    memo: z.string().optional(),
    type: z.string().optional(),
    checkNum: z.string().optional(),
    refNum: z.string().optional(),
}).passthrough();

/**
 * POST /api/banking/import/ofx — multipart (file) + metadados opcionais.
 * Não valida `req.file` no schema (multer-populated); o handler verifica.
 */
export const BankOfxImportSchema = z.object({
    encoding: z.string().optional(),
}).passthrough();

/**
 * CSV parser format (legacy): usado tanto como JSON estruturado (parse de `req.body.format`)
 * quanto como campos soltos (dateColumn/amountColumn/etc.).
 */
export const CSVFormatSchema = z.object({
    dateColumn: z.string().min(1),
    amountColumn: z.string().min(1),
    descriptionColumn: z.string().min(1),
    dateFormat: z.string().optional(),
    delimiter: z.string().max(1).optional(),
    hasHeader: z.boolean().optional(),
}).strict();

/**
 * POST /api/banking/import/csv — multipart. `format` pode chegar como STRING JSON
 * (multer populará `req.body.format` como string); o handler faz o JSON.parse seguro.
 * O schema abaixo só valida chaves escalares simples; o formato estruturado é parseado
 * na rota com try/catch — falhas viram `fail(res, 'INVALID_JSON', ...)`.
 */
export const BankCsvImportSchema = z.object({
    format: z.string().optional(),
    dateColumn: z.string().optional(),
    amountColumn: z.string().optional(),
    descriptionColumn: z.string().optional(),
    delimiter: z.string().max(1).optional(),
    hasHeader: z.union([z.string(), z.boolean()]).optional(),
}).passthrough();

/**
 * POST /api/banking/import/auto — multipart (file). Aceita qualquer metadado extra.
 */
export const BankAutoImportSchema = z.object({
    forceFormat: z.enum(['ofx', 'csv']).optional(),
}).passthrough();

/**
 * POST /api/banking/analyze/categorize
 */
export const BankCategorizeSchema = z.object({
    transactions: z.array(TransactionSchema).min(1),
});

/**
 * POST /api/banking/analyze/anomalies
 */
export const BankAnomaliesSchema = z.object({
    transactions: z.array(TransactionSchema).min(1),
});

/**
 * POST /api/banking/insights/cash-flow
 */
export const BankCashFlowSchema = z.object({
    accounts: z.array(z.any()),
    transactions: z.array(TransactionSchema),
    period: z.enum(['week', 'month', 'quarter']).optional(),
});

/**
 * POST /api/banking/insights/chart-data
 */
export const BankChartDataSchema = z.object({
    transactions: z.array(TransactionSchema).min(1),
    groupBy: z.enum(['day', 'week', 'month']).optional(),
});

/**
 * POST /api/banking/reconcile/suggest
 */
export const BankReconcileSuggestSchema = z.object({
    bankLines: z.array(z.any()),
    invoices: z.array(z.any()),
});

/**
 * POST /api/banking/reconcile/save — exige userApiKey (validação adicional na rota).
 */
export const BankReconcileSaveSchema = z.object({
    lineId: z.string().min(1),
    invoiceId: z.string().min(1),
});

/**
 * POST /api/banking/reconcile/toggle — Dolibarr persistence. Exige userApiKey (header).
 */
export const BankReconcileToggleSchema = z.object({
    accountId: z.string().min(1),
    lineId: z.string().min(1),
    reconciled: z.boolean(),
});

/**
 * POST /api/banking/balance/calculate
 */
export const BankBalanceCalculateSchema = z.object({
    initialBalance: z.number(),
    transactions: z.array(TransactionSchema),
});

/**
 * POST /api/inter/pix/cobranca — schema explícito do payload Inter (reutilizado pelo
 * validateBody pra evitar drift). Aceita o `txid` opcional que o caller pode mandar.
 */
export const InterPixCobrancaSchema = z.object({
    txid: z.string().optional(),
    valor: z.object({
        original: z.string().regex(/^\d+\.\d{2}$/, 'Valor deve estar no formato 0.00'),
    }),
    chave: z.string().min(1),
    infoAdicionais: z.array(z.object({
        nome: z.string().max(50),
        valor: z.string().max(200),
    })).optional(),
    devedor: z.object({
        cpf: z.string().length(11).regex(/^\d+$/).optional(),
        cnpj: z.string().length(14).regex(/^\d+$/).optional(),
        nome: z.string().min(1).max(200),
    }).optional(),
    solicitacaoPagador: z.string().max(140).optional(),
}).passthrough();

/**
 * POST /api/inter/pix/cobranca-vencimento
 */
export const InterPixCobrancaVencimentoSchema = z.object({
    txid: z.string().min(26).max(35),
    devedor: z.object({
        cpf: z.string().length(11).regex(/^\d+$/).optional(),
        cnpj: z.string().length(14).regex(/^\d+$/).optional(),
        nome: z.string().min(1).max(200),
    }).optional(),
    valor: z.object({
        original: z.string().regex(/^\d+\.\d{2}$/),
    }),
    chave: z.string().min(1),
    infoAdicionais: z.array(z.object({
        nome: z.string().max(50),
        valor: z.string().max(200),
    })).optional(),
}).passthrough();

/**
 * POST /api/inter/pix/enviar
 */
export const InterPixEnviarSchema = PixPagamentoSchema;

/**
 * POST /api/inter/boleto
 */
export const InterBoletoEmissaoSchema = BoletoEmissaoSchema;

/**
 * POST /api/inter/boleto/:nossoNumero/cancelar
 */
export const InterBoletoCancelSchema = z.object({
    motivo: z.string().max(500).optional(),
});

/**
 * PUT /api/inter/webhook/pix/config
 */
export const WebhookConfigSchema = z.object({
    chave: z.string().min(1).max(200),
    webhookUrl: z.string().url(),
});

/**
 * Header `userApiKey` / `DOLAPIKEY` seguro: alfanumérico, 32–128.
 * Fail-closed: rejeita chaves fora do charset/tamanho esperado antes de qualquer
 * chamada downstream — protege contra injeção de SQL via header.
 */
export const SafeApiKeyHeaderSchema = z.string()
    .min(32, 'userApiKey inválido: tamanho mínimo 32')
    .max(128, 'userApiKey inválido: tamanho máximo 128')
    .regex(/^[a-zA-Z0-9]+$/, 'userApiKey inválido: apenas caracteres alfanuméricos');

/**
 * POST /api/inter/certificates — multipart (filename handled by multer).
 * Sem campos adicionais obrigatórios.
 */
export const InterCertificateSchema = z.object({}).passthrough();

/**
 * POST /api/inter/test — body opcional. Aceita qualquer payload (ou nenhum).
 */
export const InterTestSchema = z.object({}).passthrough();

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
    BoletoWebhookSchema,
    BankOfxImportSchema,
    BankCsvImportSchema,
    BankAutoImportSchema,
    BankCategorizeSchema,
    BankAnomaliesSchema,
    BankCashFlowSchema,
    BankChartDataSchema,
    BankReconcileSuggestSchema,
    BankReconcileSaveSchema,
    BankReconcileToggleSchema,
    BankBalanceCalculateSchema,
    InterPixCobrancaSchema,
    InterPixCobrancaVencimentoSchema,
    InterPixEnviarSchema,
    InterBoletoEmissaoSchema,
    InterBoletoCancelSchema,
    WebhookConfigSchema,
    SafeApiKeyHeaderSchema,
    InterCertificateSchema,
    InterTestSchema,
    CSVFormatSchema,
};