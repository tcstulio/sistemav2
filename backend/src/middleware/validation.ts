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
        const raw = req.headers['userapikey']
            ?? req.headers['x-user-api-key']
            ?? req.headers['dolapikey']
            ?? req.query.userApiKey
            ?? req.query.DOLAPIKEY
            ?? req.query.dolapikey;
        const authHeader = req.headers.authorization;
        const fromBearer = authHeader?.startsWith('Bearer ')
            ? authHeader.substring(7)
            : undefined;
        const candidate = raw ?? fromBearer;

        if (candidate === undefined || candidate === '') {
            return next();
        }

        const parsed = UserApiKeyHeaderSchema.safeParse(candidate);
        if (!parsed.success) {
            return fail(res, 'UNAUTHORIZED', 'userApiKey inválido (formato/alfanumérico/tamanho)', 401);
        }

        req.headers['dolapikey'] = parsed.data;
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
    dataVencimento: z.string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, 'Data deve estar no formato YYYY-MM-DD')
        .optional(),
    descricao: z.string().max(500).optional()
});

/**
 * Pix charge creation schema.
 *
 * O campo `devedor` é OBRIGATÓRIO (com refine exigindo cpf ou cnpj). A
 * issue #1542 corrige uma regressão em que virou `.optional()` —
 * NÃO reintroduzir essa fragilidade, pois payloads inválidos que seriam
 * rejeitados aqui passariam e explodiriam no service/Inter.
 *
 * Sem `.passthrough()`: o Zod faz strict-by-default nos campos conhecidos
 * e rejeita chaves extras. Se precisarmos permitir campos adicionais no
 * futuro, abrimos exceção pontual, não no schema raiz.
 */
export const PixCobrancaSchema = z.object({
    calendario: z.object({
        expiracao: z.number().int().positive().optional(),
        dataDeVencimento: z.string()
            .regex(/^\d{4}-\d{2}-\d{2}$/, 'Data deve estar no formato YYYY-MM-DD')
            .optional(),
        validadeAposVencimento: z.number().int().min(0).optional()
    }).optional(),
    valor: z.object({
        original: z.string()
            .regex(/^\d+\.\d{2}$/, 'Valor deve estar no formato 0.00'),
        modalidadeAlteracao: z.number().int().optional()
    }),
    chave: z.string()
        .min(1, 'Chave Pix é obrigatória')
        .max(200),
    txid: z.string()
        .min(26, 'TxId deve ter no mínimo 26 caracteres')
        .max(35, 'TxId deve ter no máximo 35 caracteres')
        .regex(/^[a-zA-Z0-9]+$/, 'TxId deve conter apenas caracteres alfanuméricos')
        .optional(),
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
    valor: z.string()
        .regex(/^\d+\.\d{2}$/, 'Valor deve estar no formato 0.00')
        .refine(valor => Number(valor) > 0, 'Valor deve ser positivo')
        .refine(valor => Number(valor) <= 10000000, 'Valor máximo: R$ 10.000.000,00'),
    descricao: z.string().max(140).optional(),
    destinatario: z.discriminatedUnion('tipo', [
        z.object({
            tipo: z.literal('CHAVE'),
            chave: z.string().min(1, 'Chave Pix é obrigatória').max(200)
        }),
        z.object({
            tipo: z.literal('DADOS_BANCARIOS'),
            contaCorrente: z.object({
                banco: z.string().min(1),
                agencia: z.string().min(1),
                conta: z.string().min(1),
                tipoConta: z.enum(['CACC', 'SLRY', 'SVGS'])
            }),
            pessoa: z.object({
                cpf: z.string().length(11).regex(/^\d+$/).optional(),
                cnpj: z.string().length(14).regex(/^\d+$/).optional(),
                nome: z.string().min(1).max(200)
            }).refine(data => data.cpf || data.cnpj, {
                message: 'CPF ou CNPJ é obrigatório'
            })
        })
    ])
});

/**
 * Boleto creation schema
 */
export const BoletoEmissaoSchema = z.object({
    seuNumero: z.string().min(1).max(15),
    valorNominal: z.number()
        .positive('Valor deve ser positivo')
        .max(10000000, 'Valor máximo: R$ 10.000.000,00'),
    valorAbatimento: z.number().min(0).max(10000000).optional(),
    dataVencimento: z.string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, 'Data deve estar no formato YYYY-MM-DD'),
    numDiasAgenda: z.number().int().min(0).max(60).optional(),
    pagador: z.object({
        cpfCnpj: z.string()
            .min(11, 'CPF/CNPJ inválido')
            .max(14, 'CPF/CNPJ inválido')
            .regex(/^\d+$/, 'CPF/CNPJ deve conter apenas números'),
        tipoPessoa: z.enum(['FISICA', 'JURIDICA']),
        nome: z.string().min(1).max(100),
        endereco: z.string().min(1).max(90),
        numero: z.string().max(20).optional(),
        complemento: z.string().max(30).optional(),
        bairro: z.string().min(1).max(60),
        cidade: z.string().min(1).max(60),
        uf: z.string().length(2),
        cep: z.string().length(8).regex(/^\d+$/),
        email: z.string().email().optional(),
        ddd: z.string().max(3).optional(),
        telefone: z.string().max(15).optional()
    }),
    mensagem: z.object({
        linha1: z.string().max(78).optional(),
        linha2: z.string().max(78).optional(),
        linha3: z.string().max(78).optional(),
        linha4: z.string().max(78).optional(),
        linha5: z.string().max(78).optional()
    }).optional(),
    desconto1: z.object({
        codigo: z.enum(['NAOTEMDESCONTO', 'VALORFIXODATAINFORMADA', 'PERCENTUALDATAINFORMADA']),
        data: z.string().optional(),
        taxa: z.number().optional(),
        valor: z.number().optional()
    }).optional(),
    multa: z.object({
        codigo: z.enum(['NAOTEMMULTA', 'VALORFIXO', 'PERCENTUAL']),
        data: z.string().optional(),
        taxa: z.number().optional(),
        valor: z.number().optional()
    }).optional(),
    mora: z.object({
        codigo: z.enum(['VALORDIA', 'TAXAMENSAL', 'ISENTO']),
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
        pagador: z.object({
            cpf: z.string().optional(),
            cnpj: z.string().optional(),
            nome: z.string()
        }).optional(),
        infoPagador: z.string().optional(),
        devolucoes: z.array(z.any()).optional()
    }).passthrough())
}).passthrough();

/**
 * Boleto webhook payload schema — mesma observação do Pix.
 */
export const BoletoWebhookSchema = z.object({
    nossoNumero: z.string().min(1),
    seuNumero: z.string().min(1),
    situacao: z.enum(['EMABERTO', 'PAGO', 'CANCELADO', 'EXPIRADO', 'VENCIDO', 'BAIXADO']),
    valorPago: z.number().optional(),
    dataPagamento: z.string().optional(),
    codigoSolicitacao: z.string().optional(),
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
export const BankStatementImportSchema = z.object({}).strict().optional().default({});
export const InterConnectionTestSchema = z.object({}).strict().optional().default({});
export const CertificateUploadSchema = z.object({}).strict().optional().default({});

// =============================================
// Inter Banking Schemas (issue #1542)
// =============================================

/**
 * Body do /pix/cobranca-vencimento — txid + dados completos da cobrança.
 */
export const PixCobrancaVencimentoSchema = PixCobrancaSchema.extend({
    txid: z.string()
        .min(26, 'TxId deve ter no mínimo 26 caracteres')
        .max(35, 'TxId deve ter no máximo 35 caracteres')
        .regex(/^[a-zA-Z0-9]+$/, 'TxId deve conter apenas caracteres alfanuméricos')
});

/**
 * Body do /boleto/:nossoNumero/cancelar — motivo do cancelamento.
 *
 * O `motivo` é opcional, com default explícito ("Cancelado pelo usuário")
 * caso o cliente envie body vazio. Antes era
 * `z.object({...}).optional().default({...})` — o `.optional()` era
 * redundante e resultava em tipagem `{}` fraca (#1542). Agora o default
 * fica no campo, mantendo o tipo `{ motivo: string }` no resultado.
 */
export const BoletoCancelSchema = z.object({
    motivo: z.string()
        .min(1, 'motivo é obrigatório')
        .max(500)
        .default('Cancelado pelo usuário')
});

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

// =============================================
// Schemas nomeados pela issue #1542
// =============================================

/**
 * `BoletoSchema` — schema genérico para operações de boleto (issue #1542).
 *
 * Cobre o body de endpoints como emissão, listagem com filtros e demais
 * operações de boleto. Mantém os mesmos campos estritos de
 * `BoletoEmissaoSchema` (sem `.passthrough()`), preservando o contrato
 * tipado `{ seuNumero, valorNominal, dataVencimento, pagador, ... }`.
 */
export const BoletoSchema = BoletoEmissaoSchema;

/**
 * `PixSchema` — schema genérico para operações Pix (issue #1542).
 *
 * Aceita tanto envios (`valor` numérico, `destinatario`) quanto cobranças
 * (`valor.original` como string "0.00"). Campos do destinatário/devedor
 * continuam obrigatórios quando fornecidos (sem `.optional()`/`passthrough()`
 * no schema raiz, alinhado com a correção do `PixCobrancaSchema`).
 */
export const PixSchema = z.union([
    PixCobrancaVencimentoSchema,
    PixCobrancaSchema,
    PixPagamentoSchema
]);

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
    BankStatementImportSchema,
    InterConnectionTestSchema,
    CertificateUploadSchema,
    PixCobrancaVencimentoSchema,
    BoletoCancelSchema,
    WebhookConfigSchema,
    SyncSchema,
    BoletoSchema,
    PixSchema,
};
