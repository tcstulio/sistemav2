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
import { fail } from '../utils/apiResponse';

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
 * Header `userApiKey` (Dolibarr DOLAPIKEY) — formato esperado:
 *   - alfanumérico puro (apenas [A-Za-z0-9])
 *   - tamanho entre 32 e 128 caracteres
 *   - sem espaços, sem símbolos de controle, sem caracteres fora do charset seguro
 *
 * Validação condicional (#1542): quando o header ESTÁ presente e tem
 * formato inválido, rejeita com 401. Quando ausente, passa — outras
 * formas de autenticação (sessão protoSession, cookie admin_key) já
 * foram liberadas por `requireDolibarrLogin` no chain anterior.
 *
 * A ideia é defender contra tokens claramente malformados
 * (truncados, com bytes injetados, unicode esquisito) que
 * passariam pelo handler e explodiriam depois no service/Dolibarr.
 */
export const UserApiKeyHeaderSchema = z.string()
    .min(32, 'userApiKey deve ter no mínimo 32 caracteres')
    .max(128, 'userApiKey deve ter no máximo 128 caracteres')
    .regex(/^[A-Za-z0-9]+$/, 'userApiKey deve conter apenas caracteres alfanuméricos');

export function validateUserApiKey() {
    return (req: Request, res: Response, next: NextFunction) => {
        const raw = (req.headers['dolapikey']
            || req.headers['DOLAPIKEY']
            || req.query.DOLAPIKEY
            || req.query.dolapikey) as string | undefined;

        const authHeader = req.headers['authorization'];
        const fromBearer = authHeader && authHeader.startsWith('Bearer ')
            ? authHeader.substring(7)
            : undefined;

        const candidate = (raw || fromBearer || '').toString();

        if (!candidate) {
            // Ausente: deixa passar (sessão/cookie já autenticou).
            return next();
        }

        const parsed = UserApiKeyHeaderSchema.safeParse(candidate);
        if (!parsed.success) {
            return fail(res, 'UNAUTHORIZED', 'userApiKey inválido (formato/alfanumérico/tamanho)', 401);
        }

        return next();
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
    }).optional(),
    solicitacaoPagador: z.string().max(140).optional(),
    infoAdicionais: z.array(z.object({
        nome: z.string().max(50),
        valor: z.string().max(200)
    })).optional()
}).passthrough();

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
 * Pix webhook payload schema — `passthrough()` é proposital: o banco
 * pode adicionar campos novos sem quebrar a verificação de assinatura
 * (que é feita sobre `JSON.stringify(req.body)`).
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
}).passthrough();

/**
 * Boleto webhook payload schema — mesma observação do Pix.
 */
export const BoletoWebhookSchema = z.object({
    codigoSolicitacao: z.string().optional(),
    seuNumero: z.string().optional(),
    situacao: z.enum(['EMABERTO', 'PAGO', 'CANCELADO', 'EXPIRADO', 'VENCIDO']).optional(),
    dataSituacao: z.string().optional(),
    valorNominal: z.number().optional(),
    valorTotalRecebimento: z.number().optional()
}).passthrough();

// =============================================
// Banking Routes Schemas (issue #1542)
// =============================================

/**
 * CSV format definition — usado tanto em modo multipart (string JSON a
 * ser parseada) quanto em modo "auto" (campos individuais).
 */
export const CSVFormatSchema = z.object({
    dateColumn: z.string().min(1, 'dateColumn é obrigatório').max(64),
    amountColumn: z.string().min(1, 'amountColumn é obrigatório').max(64),
    descriptionColumn: z.string().min(1, 'descriptionColumn é obrigatório').max(64),
    dateFormat: z.string().max(64).optional(),
    delimiter: z.string().max(8).optional(),
    hasHeader: z.boolean().optional()
});

/**
 * Schema do body multipart para /import/csv. Aceita `format` como string
 * JSON (multipart envia tudo como string) OU os campos individuais que
 * serão usados quando `format` estiver ausente.
 *
 * O handler faz o `JSON.parse(req.body.format)` dentro de try/catch
 * (issue #1542 — crash JSON.parse na linha 75) e então re-valida o
 * objeto resultante com CSVFormatSchema.
 */
export const CSVImportSchema = z.object({
    format: z.string().optional(),
    dateColumn: z.string().max(64).optional(),
    amountColumn: z.string().max(64).optional(),
    descriptionColumn: z.string().max(64).optional(),
    delimiter: z.string().max(8).optional(),
    hasHeader: z.union([z.string(), z.boolean()]).optional()
});

/**
 * Body do /analyze/categorize — array de transações para categorizar
 * via LLM.
 */
export const CategorizeTransactionsSchema = z.object({
    transactions: z.array(z.object({
        id: z.string().optional(),
        date: z.string(),
        amount: z.number(),
        description: z.string().optional(),
        type: z.enum(['credit', 'debit']).optional(),
        category: z.string().optional(),
        memo: z.string().optional()
    }).passthrough()).min(1, 'transactions não pode ser vazio')
});

/**
 * Body do /analyze/anomalies — array de transações para detecção de
 * anomalias de gasto.
 */
export const AnomalyDetectionSchema = z.object({
    transactions: z.array(z.object({
        id: z.string().optional(),
        date: z.string(),
        amount: z.number(),
        description: z.string().optional(),
        type: z.enum(['credit', 'debit']).optional(),
        memo: z.string().optional()
    }).passthrough()).min(1, 'transactions não pode ser vazio')
});

/**
 * Body do /insights/cash-flow.
 */
export const CashFlowInsightsSchema = z.object({
    accounts: z.array(z.any()),
    transactions: z.array(z.object({
        id: z.string().optional(),
        date: z.string(),
        amount: z.number(),
        description: z.string().optional(),
        type: z.enum(['credit', 'debit']).optional()
    }).passthrough()),
    period: z.enum(['day', 'week', 'month', 'year']).optional()
});

/**
 * Body do /insights/chart-data.
 */
export const ChartDataSchema = z.object({
    transactions: z.array(z.object({
        date: z.string(),
        amount: z.number(),
        type: z.enum(['credit', 'debit']).optional()
    }).passthrough()).min(1, 'transactions não pode ser vazio'),
    groupBy: z.enum(['day', 'week', 'month']).optional()
});

/**
 * Body do /reconcile/suggest.
 */
export const ReconciliationSuggestSchema = z.object({
    bankLines: z.array(z.any()),
    invoices: z.array(z.any())
});

/**
 * Body do /reconcile/save (conciliação legada via invoiceId).
 */
export const ReconciliationSaveSchema = z.object({
    lineId: z.string().min(1, 'lineId é obrigatório'),
    invoiceId: z.string().min(1, 'invoiceId é obrigatório')
});

/**
 * Body do /reconcile/toggle (persistência direta no Dolibarr).
 */
export const ReconciliationToggleSchema = z.object({
    accountId: z.string().min(1, 'accountId é obrigatório'),
    lineId: z.string().min(1, 'lineId é obrigatório'),
    reconciled: z.boolean({ error: 'reconciled deve ser boolean' })
});

/**
 * Body do /balance/calculate.
 */
export const BalanceCalculateSchema = z.object({
    initialBalance: z.number({ error: 'initialBalance deve ser número' }),
    transactions: z.array(z.object({
        date: z.string(),
        amount: z.number(),
        type: z.enum(['credit', 'debit']).optional()
    }).passthrough())
});

/**
 * Alias para o conjunto de schemas de banking — usado para
 * `validateBody(BankSyncSchema)` etc., conforme a issue #1542.
 */
export const BankSyncSchema = CategorizeTransactionsSchema;
export const BankTransferSchema = ReconciliationToggleSchema;
export const BankConfigSchema = CSVImportSchema;

// =============================================
// Inter Banking Schemas (issue #1542)
// =============================================

/**
 * Body do /pix/cobranca-vencimento — txid + dados completos da cobrança.
 */
export const PixCobrancaVencimentoSchema = z.object({
    txid: z.string()
        .min(26, 'TxId deve ter no mínimo 26 caracteres')
        .max(35, 'TxId deve ter no máximo 35 caracteres')
        .regex(/^[a-zA-Z0-9]+$/, 'TxId deve conter apenas caracteres alfanuméricos'),
}).passthrough();

/**
 * Body do /boleto/:nossoNumero/cancelar — motivo do cancelamento.
 */
export const BoletoCancelSchema = z.object({
    motivo: z.string().min(1, 'motivo é obrigatório').max(500)
}).optional().default({ motivo: 'Cancelado pelo usuário' });

/**
 * Body do PUT /webhook/pix/config — chave Pix + URL do webhook.
 */
export const WebhookConfigSchema = z.object({
    chave: z.string().min(1, 'chave é obrigatória').max(200),
    webhookUrl: z.string().url('webhookUrl deve ser uma URL válida').max(2048)
});

/**
 * Schema genérico de sincronização (interBanking sync endpoints) —
 * aceita janela de datas e paginação opcional.
 */
export const SyncSchema = z.object({
    dataInicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data deve estar no formato YYYY-MM-DD').optional(),
    dataFim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data deve estar no formato YYYY-MM-DD').optional(),
    inicio: z.string().datetime({ offset: true }).optional(),
    fim: z.string().datetime({ offset: true }).optional(),
    pagina: z.number().int().min(0).optional(),
    tamanhoPagina: z.number().int().min(1).max(1000).optional(),
    forcar: z.boolean().optional()
});

export default {
    validateBody,
    validateQuery,
    validateParams,
    validateUserApiKey,
    UserApiKeyHeaderSchema,
    PagamentoBoletoSchema,
    PixCobrancaSchema,
    PixPagamentoSchema,
    BoletoEmissaoSchema,
    DateRangeSchema,
    IdParamSchema,
    TxIdParamSchema,
    PixWebhookSchema,
    BoletoWebhookSchema,
    CSVFormatSchema,
    CSVImportSchema,
    CategorizeTransactionsSchema,
    AnomalyDetectionSchema,
    CashFlowInsightsSchema,
    ChartDataSchema,
    ReconciliationSuggestSchema,
    ReconciliationSaveSchema,
    ReconciliationToggleSchema,
    BalanceCalculateSchema,
    BankSyncSchema,
    BankTransferSchema,
    BankConfigSchema,
    PixCobrancaVencimentoSchema,
    BoletoCancelSchema,
    WebhookConfigSchema,
    SyncSchema,
};