import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z, ZodError } from 'zod';
import {
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
    PixCobrancaVencimentoSchema,
    BoletoSchema,
    PixSchema,
} from '../../middleware/validation';

function mockRes() {
    return {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis(),
    } as any;
}

function mockNext() {
    return vi.fn();
}

describe('validateBody', () => {
    const schema = z.object({ name: z.string(), age: z.number() });

    it('passes validation and sets parsed body on success', () => {
        const req: any = { body: { name: 'John', age: 30 } };
        const res = mockRes();
        const next = mockNext();

        validateBody(schema)(req, res, next);

        expect(next).toHaveBeenCalledWith();
        expect(req.body).toEqual({ name: 'John', age: 30 });
    });

    it('calls next(validationError) with status 400 + VALIDATION_ERROR + details on invalid body (#1540)', () => {
        const req: any = { body: { name: 123, age: 'not-a-number' } };
        const res = mockRes();
        const next = mockNext();

        validateBody(schema)(req, res, next);

        expect(next).toHaveBeenCalledTimes(1);
        const err = next.mock.calls[0][0];
        expect(err).toBeInstanceOf(Error);
        expect(err.status).toBe(400);
        expect(err.code).toBe('VALIDATION_ERROR');
        expect(err.message).toBe('Validation failed');
        expect(Array.isArray(err.details)).toBe(true);
        expect(err.details.length).toBeGreaterThan(0);
        err.details.forEach((d: any) => {
            expect(d).toHaveProperty('field');
            expect(d).toHaveProperty('message');
        });
        // Não escreve direto na resposta — delega ao errorHandler global (#1540).
        expect(res.status).not.toHaveBeenCalled();
        expect(res.json).not.toHaveBeenCalled();
    });

    it('passes non-ZodError to next unchanged', () => {
        const badSchema: any = {
            parse: () => {
                throw new Error('boom');
            },
        };
        const req: any = { body: {} };
        const res = mockRes();
        const next = mockNext();
        const error = new Error('boom');

        const throwingSchema: any = {
            parse: () => {
                throw error;
            },
        };

        validateBody(throwingSchema)(req, res, next);

        expect(next).toHaveBeenCalledWith(error);
        expect(res.status).not.toHaveBeenCalled();
    });
});

describe('validateQuery', () => {
    const schema = z.object({ page: z.string().transform(Number) });

    it('passes validation and sets parsed query on success', () => {
        const req: any = { query: { page: '1' } };
        const res = mockRes();
        const next = mockNext();

        validateQuery(schema)(req, res, next);

        expect(next).toHaveBeenCalledWith();
        expect(req.query).toEqual({ page: 1 });
    });

    it('calls next(validationError) with status 400 + VALIDATION_ERROR + details on invalid query (#1540)', () => {
        const req: any = { query: {} };
        const res = mockRes();
        const next = mockNext();

        validateQuery(schema)(req, res, next);

        expect(next).toHaveBeenCalledTimes(1);
        const err = next.mock.calls[0][0];
        expect(err).toBeInstanceOf(Error);
        expect(err.status).toBe(400);
        expect(err.code).toBe('VALIDATION_ERROR');
        expect(err.message).toBe('Invalid query parameters');
        expect(Array.isArray(err.details)).toBe(true);
        expect(res.status).not.toHaveBeenCalled();
        expect(res.json).not.toHaveBeenCalled();
    });

    it('passes non-ZodError to next', () => {
        const error = new Error('query boom');

        const throwingSchema: any = {
            parse: () => {
                throw error;
            },
        };

        const req: any = { query: {} };
        const res = mockRes();
        const next = mockNext();

        validateQuery(throwingSchema)(req, res, next);

        expect(next).toHaveBeenCalledWith(error);
    });
});

describe('validateParams', () => {
    const schema = z.object({ id: z.string().min(1) });

    it('passes validation and sets parsed params on success', () => {
        const req: any = { params: { id: 'abc' } };
        const res = mockRes();
        const next = mockNext();

        validateParams(schema)(req, res, next);

        expect(next).toHaveBeenCalledWith();
        expect(req.params).toEqual({ id: 'abc' });
    });

    it('calls next(validationError) with status 400 + VALIDATION_ERROR + details on invalid params (#1540)', () => {
        const req: any = { params: {} };
        const res = mockRes();
        const next = mockNext();

        validateParams(schema)(req, res, next);

        expect(next).toHaveBeenCalledTimes(1);
        const err = next.mock.calls[0][0];
        expect(err).toBeInstanceOf(Error);
        expect(err.status).toBe(400);
        expect(err.code).toBe('VALIDATION_ERROR');
        expect(err.message).toBe('Invalid route parameters');
        expect(Array.isArray(err.details)).toBe(true);
        expect(res.status).not.toHaveBeenCalled();
        expect(res.json).not.toHaveBeenCalled();
    });

    it('passes non-ZodError to next', () => {
        const error = new Error('params boom');

        const throwingSchema: any = {
            parse: () => {
                throw error;
            },
        };

        const req: any = { params: {} };
        const res = mockRes();
        const next = mockNext();

        validateParams(throwingSchema)(req, res, next);

        expect(next).toHaveBeenCalledWith(error);
    });
});

describe('PagamentoBoletoSchema', () => {
    const valid = {
        codBarraLinhaDigitavel: '1'.repeat(44),
        valorPagar: 100,
    };

    it('accepts valid data', () => {
        expect(() => PagamentoBoletoSchema.parse(valid)).not.toThrow();
    });

    it('accepts with optional fields', () => {
        expect(() =>
            PagamentoBoletoSchema.parse({ ...valid, dataPagamento: '2024-01-01', descricao: 'test' })
        ).not.toThrow();
    });

    it('rejects too short codBarraLinhaDigitavel', () => {
        expect(() => PagamentoBoletoSchema.parse({ ...valid, codBarraLinhaDigitavel: '12' })).toThrow();
    });

    it('rejects too long codBarraLinhaDigitavel', () => {
        expect(() => PagamentoBoletoSchema.parse({ ...valid, codBarraLinhaDigitavel: '1'.repeat(49) })).toThrow();
    });

    it('rejects non-numeric codBarraLinhaDigitavel', () => {
        expect(() => PagamentoBoletoSchema.parse({ ...valid, codBarraLinhaDigitavel: 'a'.repeat(44) })).toThrow();
    });

    it('rejects negative valorPagar', () => {
        expect(() => PagamentoBoletoSchema.parse({ ...valid, valorPagar: -1 })).toThrow();
    });

    it('rejects zero valorPagar', () => {
        expect(() => PagamentoBoletoSchema.parse({ ...valid, valorPagar: 0 })).toThrow();
    });

    it('rejects valorPagar exceeding max', () => {
        expect(() => PagamentoBoletoSchema.parse({ ...valid, valorPagar: 20000000 })).toThrow();
    });

    it('rejects invalid dataPagamento format', () => {
        expect(() => PagamentoBoletoSchema.parse({ ...valid, dataPagamento: '01-01-2024' })).toThrow();
    });

    it('rejects descricao over 500 chars', () => {
        expect(() => PagamentoBoletoSchema.parse({ ...valid, descricao: 'a'.repeat(501) })).toThrow();
    });
});

describe('PixCobrancaSchema', () => {
    const valid = {
        valor: { original: '100.00' },
        chave: 'test@pix.com',
        devedor: { cpf: '12345678901', nome: 'Joao' },
    };

    it('accepts valid data with CPF', () => {
        expect(() => PixCobrancaSchema.parse(valid)).not.toThrow();
    });

    it('accepts valid data with CNPJ', () => {
        const data = { ...valid, devedor: { cnpj: '12345678901234', nome: 'Empresa' } };
        expect(() => PixCobrancaSchema.parse(data)).not.toThrow();
    });

    it('accepts with optional fields', () => {
        const data = {
            ...valid,
            solicitacaoPagador: 'pagamento',
            infoAdicionais: [{ nome: 'info', valor: 'val' }],
        };
        expect(() => PixCobrancaSchema.parse(data)).not.toThrow();
    });

    it('rejects invalid valor format', () => {
        const data = { ...valid, valor: { original: '100' } };
        expect(() => PixCobrancaSchema.parse(data)).toThrow();
    });

    it('rejects empty chave', () => {
        const data = { ...valid, chave: '' };
        expect(() => PixCobrancaSchema.parse(data)).toThrow();
    });

    it('rejects devedor without cpf or cnpj', () => {
        const data = { ...valid, devedor: { nome: 'Joao' } };
        expect(() => PixCobrancaSchema.parse(data)).toThrow();
    });

    it('rejects CPF with wrong length', () => {
        const data = { ...valid, devedor: { cpf: '123', nome: 'Joao' } };
        expect(() => PixCobrancaSchema.parse(data)).toThrow();
    });

    it('rejects CNPJ with wrong length', () => {
        const data = { ...valid, devedor: { cnpj: '123', nome: 'Joao' } };
        expect(() => PixCobrancaSchema.parse(data)).toThrow();
    });

    it('rejects non-numeric CPF', () => {
        const data = { ...valid, devedor: { cpf: 'abcdefghijk', nome: 'Joao' } };
        expect(() => PixCobrancaSchema.parse(data)).toThrow();
    });

    it('rejects non-numeric CNPJ', () => {
        const data = { ...valid, devedor: { cnpj: 'abcdefghijklmn', nome: 'Joao' } };
        expect(() => PixCobrancaSchema.parse(data)).toThrow();
    });

    it('rejects empty nome', () => {
        const data = { ...valid, devedor: { cpf: '12345678901', nome: '' } };
        expect(() => PixCobrancaSchema.parse(data)).toThrow();
    });

    it('rejects nome over 200 chars', () => {
        const data = { ...valid, devedor: { cpf: '12345678901', nome: 'a'.repeat(201) } };
        expect(() => PixCobrancaSchema.parse(data)).toThrow();
    });
});

describe('PixPagamentoSchema', () => {
    const validChave = {
        valor: '100.00',
        destinatario: { tipo: 'CHAVE' as const, chave: 'test@pix.com' },
    };
    const validDadosBancarios = {
        valor: '100.00',
        destinatario: {
            tipo: 'DADOS_BANCARIOS' as const,
            contaCorrente: {
                banco: '001',
                agencia: '1234',
                conta: '56789',
                tipoConta: 'CACC' as const,
            },
            pessoa: { cpf: '12345678901', nome: 'Joao' },
        },
    };

    it('accepts valid CHAVE type with chave field', () => {
        expect(() => PixPagamentoSchema.parse(validChave)).not.toThrow();
    });

    it('accepts valid DADOS_BANCARIOS type', () => {
        expect(() => PixPagamentoSchema.parse(validDadosBancarios)).not.toThrow();
    });

    it('accepts with optional fields', () => {
        expect(() => PixPagamentoSchema.parse({ ...validChave, descricao: 'pagamento' })).not.toThrow();
    });

    it('rejects negative valor', () => {
        expect(() => PixPagamentoSchema.parse({ ...validChave, valor: '-1.00' })).toThrow();
    });

    it('rejects valor exceeding max', () => {
        expect(() => PixPagamentoSchema.parse({ ...validChave, valor: '20000000.00' })).toThrow();
    });

    it('rejects CHAVE type without chave field', () => {
        const data = { valor: '100.00', destinatario: { tipo: 'CHAVE' } };
        expect(() => PixPagamentoSchema.parse(data)).toThrow();
    });

    it('rejects DADOS_BANCARIOS without banco', () => {
        const data = structuredClone(validDadosBancarios) as any;
        delete data.destinatario.contaCorrente.banco;
        expect(() => PixPagamentoSchema.parse(data)).toThrow();
    });

    it('rejects DADOS_BANCARIOS without agencia', () => {
        const data = structuredClone(validDadosBancarios) as any;
        delete data.destinatario.contaCorrente.agencia;
        expect(() => PixPagamentoSchema.parse(data)).toThrow();
    });

    it('rejects DADOS_BANCARIOS without conta', () => {
        const data = structuredClone(validDadosBancarios) as any;
        delete data.destinatario.contaCorrente.conta;
        expect(() => PixPagamentoSchema.parse(data)).toThrow();
    });

    it('rejects DADOS_BANCARIOS without cpfCnpj', () => {
        const data = structuredClone(validDadosBancarios) as any;
        delete data.destinatario.pessoa.cpf;
        expect(() => PixPagamentoSchema.parse(data)).toThrow();
    });

    it('rejects descricao over 140 chars', () => {
        expect(() => PixPagamentoSchema.parse({ ...validChave, descricao: 'a'.repeat(141) })).toThrow();
    });

    it('refine returns false for unknown tipo (direct call)', () => {
        const data = { valor: '100.00', destinatario: { tipo: 'UNKNOWN', chave: 'test' } };
        expect(() => PixPagamentoSchema.parse(data)).toThrow();
    });
});

describe('BoletoEmissaoSchema', () => {
    const valid = {
        seuNumero: '123',
        valorNominal: 100,
        dataVencimento: '2024-06-01',
        pagador: {
            cpfCnpj: '12345678901',
            tipoPessoa: 'FISICA' as const,
            nome: 'Joao',
            endereco: 'Rua 1',
            bairro: 'Centro',
            cidade: 'Sao Paulo',
            uf: 'SP',
            cep: '12345678',
        },
    };

    it('accepts valid minimal data', () => {
        expect(() => BoletoEmissaoSchema.parse(valid)).not.toThrow();
    });

    it('accepts with all optional fields', () => {
        const data = {
            ...valid,
            numDiasAgenda: 30,
            pagador: {
                ...valid.pagador,
                endereco: 'Rua 1',
                cidade: 'Sao Paulo',
                uf: 'SP',
                cep: '12345678',
                email: 'test@test.com',
                telefone: '11999999999',
            },
            mensagem: { linha1: 'msg1' },
            desconto1: { codigo: 'NAOTEMDESCONTO' as const },
            multa: { codigo: 'NAOTEMMULTA' as const },
            mora: { codigo: 'ISENTO' as const },
        };
        expect(() => BoletoEmissaoSchema.parse(data)).not.toThrow();
    });

    it('rejects negative valorNominal', () => {
        expect(() => BoletoEmissaoSchema.parse({ ...valid, valorNominal: -1 })).toThrow();
    });

    it('rejects invalid dataVencimento', () => {
        expect(() => BoletoEmissaoSchema.parse({ ...valid, dataVencimento: '01-06-2024' })).toThrow();
    });

    it('rejects short cpfCnpj', () => {
        const data = { ...valid, pagador: { ...valid.pagador, cpfCnpj: '1' } };
        expect(() => BoletoEmissaoSchema.parse(data)).toThrow();
    });

    it('rejects long cpfCnpj', () => {
        const data = { ...valid, pagador: { ...valid.pagador, cpfCnpj: '1'.repeat(15) } };
        expect(() => BoletoEmissaoSchema.parse(data)).toThrow();
    });

    it('rejects invalid tipoPessoa', () => {
        const data = { ...valid, pagador: { ...valid.pagador, tipoPessoa: 'INVALID' } };
        expect(() => BoletoEmissaoSchema.parse(data)).toThrow();
    });

    it('rejects empty nome', () => {
        const data = { ...valid, pagador: { ...valid.pagador, nome: '' } };
        expect(() => BoletoEmissaoSchema.parse(data)).toThrow();
    });

    it('rejects numDiasAgenda over 60', () => {
        expect(() => BoletoEmissaoSchema.parse({ ...valid, numDiasAgenda: 61 })).toThrow();
    });

    it('rejects negative numDiasAgenda', () => {
        expect(() => BoletoEmissaoSchema.parse({ ...valid, numDiasAgenda: -1 })).toThrow();
    });

    it('rejects invalid email', () => {
        const data = { ...valid, pagador: { ...valid.pagador, email: 'not-email' } };
        expect(() => BoletoEmissaoSchema.parse(data)).toThrow();
    });

    it('accepts desconto VALORFIXODATAINFORMADA', () => {
        const data = { ...valid, desconto1: { codigo: 'VALORFIXODATAINFORMADA' as const, valor: 10 } };
        expect(() => BoletoEmissaoSchema.parse(data)).not.toThrow();
    });

    it('accepts desconto PERCENTUALDATAINFORMADA', () => {
        const data = { ...valid, desconto1: { codigo: 'PERCENTUALDATAINFORMADA' as const, taxa: 5 } };
        expect(() => BoletoEmissaoSchema.parse(data)).not.toThrow();
    });

    it('accepts multa VALORFIXO', () => {
        const data = { ...valid, multa: { codigo: 'VALORFIXO' as const, valor: 10 } };
        expect(() => BoletoEmissaoSchema.parse(data)).not.toThrow();
    });

    it('accepts multa PERCENTUAL', () => {
        const data = { ...valid, multa: { codigo: 'PERCENTUAL' as const, taxa: 2 } };
        expect(() => BoletoEmissaoSchema.parse(data)).not.toThrow();
    });

    it('accepts mora VALORDIA', () => {
        const data = { ...valid, mora: { codigo: 'VALORDIA' as const, valor: 1 } };
        expect(() => BoletoEmissaoSchema.parse(data)).not.toThrow();
    });

    it('accepts mora TAXAMENSAL', () => {
        const data = { ...valid, mora: { codigo: 'TAXAMENSAL' as const, taxa: 1 } };
        expect(() => BoletoEmissaoSchema.parse(data)).not.toThrow();
    });

    it('accepts desconto with data', () => {
        const data = { ...valid, desconto1: { codigo: 'NAOTEMDESCONTO' as const, data: '2024-05-01' } };
        expect(() => BoletoEmissaoSchema.parse(data)).not.toThrow();
    });

    it('accepts multa with data', () => {
        const data = { ...valid, multa: { codigo: 'NAOTEMMULTA' as const, data: '2024-05-01' } };
        expect(() => BoletoEmissaoSchema.parse(data)).not.toThrow();
    });

    it('accepts mora with data', () => {
        const data = { ...valid, mora: { codigo: 'ISENTO' as const, data: '2024-05-01' } };
        expect(() => BoletoEmissaoSchema.parse(data)).not.toThrow();
    });
});

describe('DateRangeSchema', () => {
    it('accepts valid data', () => {
        const data = { dataInicial: '2024-01-01', dataFinal: '2024-01-31' };
        expect(() => DateRangeSchema.parse(data)).not.toThrow();
    });

    it('accepts with optional pagination', () => {
        const data = { dataInicial: '2024-01-01', dataFinal: '2024-01-31', pagina: '2', tamanhoPagina: '50' };
        const result = DateRangeSchema.parse(data);
        expect(result.pagina).toBe(2);
        expect(result.tamanhoPagina).toBe(50);
    });

    it('rejects invalid dataInicial format', () => {
        expect(() => DateRangeSchema.parse({ dataInicial: '01-01-2024', dataFinal: '2024-01-31' })).toThrow();
    });

    it('rejects invalid dataFinal format', () => {
        expect(() => DateRangeSchema.parse({ dataInicial: '2024-01-01', dataFinal: 'invalid' })).toThrow();
    });

    it('rejects non-numeric pagina', () => {
        expect(() =>
            DateRangeSchema.parse({ dataInicial: '2024-01-01', dataFinal: '2024-01-31', pagina: 'abc' })
        ).toThrow();
    });
});

describe('IdParamSchema', () => {
    it('accepts valid id', () => {
        expect(() => IdParamSchema.parse({ id: '123' })).not.toThrow();
    });

    it('rejects empty id', () => {
        expect(() => IdParamSchema.parse({ id: '' })).toThrow();
    });

    it('rejects missing id', () => {
        expect(() => IdParamSchema.parse({})).toThrow();
    });
});

describe('TxIdParamSchema', () => {
    it('accepts valid txid (26-35 alphanumeric chars)', () => {
        expect(() => TxIdParamSchema.parse({ txid: 'a'.repeat(26) })).not.toThrow();
        expect(() => TxIdParamSchema.parse({ txid: 'a'.repeat(35) })).not.toThrow();
    });

    it('rejects txid too short', () => {
        expect(() => TxIdParamSchema.parse({ txid: 'a'.repeat(25) })).toThrow();
    });

    it('rejects txid too long', () => {
        expect(() => TxIdParamSchema.parse({ txid: 'a'.repeat(36) })).toThrow();
    });

    it('rejects non-alphanumeric txid', () => {
        expect(() => TxIdParamSchema.parse({ txid: 'a'.repeat(26) + '!@#' })).toThrow();
    });

    it('rejects special characters in txid', () => {
        expect(() => TxIdParamSchema.parse({ txid: 'abcdef!'.repeat(4) })).toThrow();
    });
});

describe('PixWebhookSchema', () => {
    it('accepts valid payload with pix array', () => {
        const data = {
            pix: [
                {
                    endToEndId: 'e2e-123',
                    txid: 'tx-1',
                    valor: '100.00',
                    horario: '2024-01-01T00:00:00',
                },
            ],
        };
        expect(() => PixWebhookSchema.parse(data)).not.toThrow();
    });

    it('rejects payload without pix array', () => {
        expect(() => PixWebhookSchema.parse({})).toThrow();
    });

    it('accepts pix entry without optional fields', () => {
        const data = {
            pix: [{ endToEndId: 'e2e', valor: '50', horario: '2024-01-01' }],
        };
        expect(() => PixWebhookSchema.parse(data)).not.toThrow();
    });

    it('accepts pix entry with devolucoes', () => {
        const data = {
            pix: [
                {
                    endToEndId: 'e2e',
                    valor: '50',
                    horario: '2024-01-01',
                    devolucoes: [{ id: 'dev1' }],
                },
            ],
        };
        expect(() => PixWebhookSchema.parse(data)).not.toThrow();
    });

    it('accepts empty pix array', () => {
        expect(() => PixWebhookSchema.parse({ pix: [] })).not.toThrow();
    });
});

describe('BoletoWebhookSchema', () => {
    const valid = {
        nossoNumero: 'nosso-1',
        seuNumero: 'seu-1',
        situacao: 'PAGO' as const,
    };

    it('rejects empty object', () => {
        expect(() => BoletoWebhookSchema.parse({})).toThrow();
    });

    it('accepts valid situacao values', () => {
        const situacoes = ['EMABERTO', 'PAGO', 'CANCELADO', 'EXPIRADO', 'VENCIDO', 'BAIXADO'];
        situacoes.forEach((situacao) => {
            expect(() => BoletoWebhookSchema.parse({ ...valid, situacao })).not.toThrow();
        });
    });

    it('rejects invalid situacao', () => {
        expect(() => BoletoWebhookSchema.parse({ ...valid, situacao: 'INVALID' })).toThrow();
    });

    it('accepts all optional fields', () => {
        const data = {
            ...valid,
            codigoSolicitacao: 'solicitacao-1',
            dataSituacao: '2024-01-01',
            valorNominal: 100,
            valorTotalRecebimento: 100,
            valorPago: 100,
            dataPagamento: '2024-01-01',
        };
        expect(() => BoletoWebhookSchema.parse(data)).not.toThrow();
    });
});

describe('schemas nomeados da issue #1542', () => {
    const cobranca = {
        valor: { original: '100.00' },
        chave: 'test@pix.com',
        devedor: { cpf: '12345678901', nome: 'Joao' },
    };

    it('PixCobrancaVencimentoSchema exige os dados completos da cobrança', () => {
        expect(() => PixCobrancaVencimentoSchema.parse({ txid: 'a'.repeat(26) })).toThrow();
        expect(() => PixCobrancaVencimentoSchema.parse({ ...cobranca, txid: 'a'.repeat(26) })).not.toThrow();
    });

    it('BoletoSchema reutiliza o contrato validado de emissão', () => {
        const boleto = {
            seuNumero: '123',
            valorNominal: 100,
            dataVencimento: '2024-06-01',
            pagador: {
                cpfCnpj: '12345678901',
                tipoPessoa: 'FISICA',
                nome: 'Joao',
                endereco: 'Rua 1',
                bairro: 'Centro',
                cidade: 'Sao Paulo',
                uf: 'SP',
                cep: '12345678',
            },
        };
        expect(() => BoletoSchema.parse(boleto)).not.toThrow();
    });

    it('PixSchema aceita cobrança e pagamento válidos', () => {
        expect(() => PixSchema.parse(cobranca)).not.toThrow();
        expect(() => PixSchema.parse({
            valor: '100.00',
            destinatario: { tipo: 'CHAVE', chave: 'test@pix.com' },
        })).not.toThrow();
    });
});
