/**
 * Request Validation Middleware
 *
 * Uses Zod for schema validation with proper error handling
 */

import { Request, Response, NextFunction } from 'express';
import { z, ZodError, ZodSchema } from 'zod';

/**
 * Validation error response format
 */
interface ValidationErrorResponse {
    error: string;
    details: {
        field: string;
        message: string;
    }[];
}

/**
 * Creates a validation middleware for request body
 */
export function validateBody<T extends ZodSchema>(schema: T) {
    return (req: Request, res: Response, next: NextFunction) => {
        try {
            req.body = schema.parse(req.body);
            next();
        } catch (error) {
            if (error instanceof ZodError) {
                const response: ValidationErrorResponse = {
                    error: 'Validation failed',
                    details: error.issues.map((issue: z.ZodIssue) => ({
                        field: issue.path.join('.'),
                        message: issue.message
                    }))
                };
                return res.status(400).json(response);
            }
            next(error);
        }
    };
}

/**
 * Creates a validation middleware for query parameters
 */
export function validateQuery<T extends ZodSchema>(schema: T) {
    return (req: Request, res: Response, next: NextFunction) => {
        try {
            req.query = schema.parse(req.query) as any;
            next();
        } catch (error) {
            if (error instanceof ZodError) {
                const response: ValidationErrorResponse = {
                    error: 'Invalid query parameters',
                    details: error.issues.map((issue: z.ZodIssue) => ({
                        field: issue.path.join('.'),
                        message: issue.message
                    }))
                };
                return res.status(400).json(response);
            }
            next(error);
        }
    };
}

/**
 * Creates a validation middleware for route parameters
 */
export function validateParams<T extends ZodSchema>(schema: T) {
    return (req: Request, res: Response, next: NextFunction) => {
        try {
            req.params = schema.parse(req.params) as any;
            next();
        } catch (error) {
            if (error instanceof ZodError) {
                const response: ValidationErrorResponse = {
                    error: 'Invalid route parameters',
                    details: error.issues.map((issue: z.ZodIssue) => ({
                        field: issue.path.join('.'),
                        message: issue.message
                    }))
                };
                return res.status(400).json(response);
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
