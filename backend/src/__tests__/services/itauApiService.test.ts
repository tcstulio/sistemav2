import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';

vi.mock('fs', () => ({
    default: { existsSync: vi.fn(), readFileSync: vi.fn() },
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
}));

vi.mock('../../config/env', () => ({
    config: {
        itauClientId: 'test-itau-id',
        itauClientSecret: 'test-itau-secret',
        itauCertPath: './certs/itau.crt',
        itauKeyPath: './certs/itau.key',
        itauSandbox: false,
        itauContaCorrente: '12345',
        itauAgencia: '0001',
    },
}));

import { itauApiService } from '../../services/itauApiService';

describe('ItauApiService', () => {
    let mockAxiosInstance: any;

    beforeEach(() => {
        vi.clearAllMocks();
        const mockRequest = vi.fn();
        mockAxiosInstance = vi.fn() as any;
        mockAxiosInstance.request = mockRequest;
        (itauApiService as any).axiosInstance = mockAxiosInstance;
        (itauApiService as any).initialized = true;
        (itauApiService as any).tokenCache = { accessToken: 'test-token', expiresAt: Date.now() + 3600000 };
        (itauApiService as any).httpsAgent = {};
    });

    describe('abstract implementations', () => {
        it('returns correct bank name', () => {
            expect((itauApiService as any).getBankName()).toBe('Itaú');
        });

        it('maps balance correctly', () => {
            const result = (itauApiService as any).mapBalance({
                disponivel: 5000,
                bloqueado: 500,
                limite: 10000,
            });
            expect(result.available).toBe(5000);
            expect(result.blocked).toBe(500);
            expect(result.limit).toBe(10000);
            expect(result.total).toBe(5500);
        });

        it('maps transaction correctly', () => {
            const result = (itauApiService as any).mapTransaction({
                codigoTransacao: 'IT1',
                dataLancamento: '2024-01-15',
                valor: '200',
                descricao: 'Transfer',
                tipoOperacao: 'C',
                tipoTransacao: 'TED',
            });
            expect(result.id).toBe('IT1');
            expect(result.amount).toBe(200);
            expect(result.type).toBe('credit');
            expect(result.category).toBe('TED');
        });
    });

    describe('getBalance', () => {
        it('gets balance via getSaldo', async () => {
            mockAxiosInstance.request.mockResolvedValue({
                data: { disponivel: 3000, bloqueado: 100, limite: 5000 },
            });

            const result = await itauApiService.getBalance();
            expect(result.available).toBe(3000);
        });
    });

    describe('getStatement', () => {
        it('gets statement and maps transactions', async () => {
            mockAxiosInstance.request.mockResolvedValue({
                data: {
                    transacoes: [
                        { codigoTransacao: 'IT1', dataLancamento: '2024-01-15', valor: 100, descricao: 'Test', tipoOperacao: 'D', tipoTransacao: 'PIX' },
                    ],
                },
            });

            const result = await itauApiService.getStatement('2024-01-01', '2024-01-31');
            expect(result.transactions).toHaveLength(1);
            expect(result.transactions[0].type).toBe('debit');
        });
    });

    describe('banking methods', () => {
        it('getExtratoCompleto returns transactions', async () => {
            mockAxiosInstance.request.mockResolvedValue({
                data: { transacoes: [{ id: 1 }, { id: 2 }] },
            });
            const result = await itauApiService.getExtratoCompleto('2024-01-01', '2024-01-31');
            expect(result).toHaveLength(2);
        });

        it('getExtratoCompleto handles missing transactions', async () => {
            mockAxiosInstance.request.mockResolvedValue({ data: {} });
            const result = await itauApiService.getExtratoCompleto('2024-01-01', '2024-01-31');
            expect(result).toEqual([]);
        });
    });

    describe('Pix API methods', () => {
        it('criarPixCobranca generates txid if not provided', async () => {
            mockAxiosInstance.request.mockResolvedValue({ data: { txid: 'GEN' } });
            await itauApiService.criarPixCobranca({ valor: 100 } as any);
            expect(mockAxiosInstance.request).toHaveBeenCalledWith(expect.objectContaining({
                method: 'PUT',
            }));
        });

        it('criarPixCobranca uses provided txid', async () => {
            mockAxiosInstance.request.mockResolvedValue({ data: { txid: 'MYID' } });
            await itauApiService.criarPixCobranca({ valor: 100 } as any, 'MYID');
            expect(mockAxiosInstance.request).toHaveBeenCalledWith(expect.objectContaining({
                url: expect.stringContaining('/cob/MYID'),
            }));
        });

        it('criarPixCobrancaVencimento makes PUT to cobv', async () => {
            mockAxiosInstance.request.mockResolvedValue({ data: {} });
            await itauApiService.criarPixCobrancaVencimento('V1', {} as any);
            expect(mockAxiosInstance.request).toHaveBeenCalledWith(expect.objectContaining({
                url: expect.stringContaining('/cobv/V1'),
            }));
        });

        it('consultarPixCobranca makes GET', async () => {
            mockAxiosInstance.request.mockResolvedValue({ data: {} });
            await itauApiService.consultarPixCobranca('TX1');
            expect(mockAxiosInstance.request).toHaveBeenCalledWith(expect.objectContaining({
                url: expect.stringContaining('/cob/TX1'),
            }));
        });

        it('getPixQRCode makes GET', async () => {
            mockAxiosInstance.request.mockResolvedValue({ data: {} });
            await itauApiService.getPixQRCode(456);
            expect(mockAxiosInstance.request).toHaveBeenCalledWith(expect.objectContaining({
                url: expect.stringContaining('/loc/456/qrcode'),
            }));
        });

        it('enviarPix makes POST', async () => {
            mockAxiosInstance.request.mockResolvedValue({ data: {} });
            await itauApiService.enviarPix({ valor: 100 } as any);
            expect(mockAxiosInstance.request).toHaveBeenCalledWith(expect.objectContaining({
                method: 'POST',
            }));
        });

        it('listarPixRecebidos returns pix array', async () => {
            mockAxiosInstance.request.mockResolvedValue({ data: { pix: [{ id: 1 }, { id: 2 }] } });
            const result = await itauApiService.listarPixRecebidos('2024-01-01', '2024-01-31');
            expect(result).toHaveLength(2);
        });

        it('listarPixRecebidos handles empty', async () => {
            mockAxiosInstance.request.mockResolvedValue({ data: {} });
            const result = await itauApiService.listarPixRecebidos('2024-01-01', '2024-01-31');
            expect(result).toEqual([]);
        });

        it('consultarPix makes GET', async () => {
            mockAxiosInstance.request.mockResolvedValue({ data: {} });
            await itauApiService.consultarPix('E2E1');
            expect(mockAxiosInstance.request).toHaveBeenCalledWith(expect.objectContaining({
                url: expect.stringContaining('/pix/E2E1'),
            }));
        });
    });

    describe('Boleto methods', () => {
        it('emitirBoleto makes POST', async () => {
            mockAxiosInstance.request.mockResolvedValue({ data: {} });
            await itauApiService.emitirBoleto({} as any);
            expect(mockAxiosInstance.request).toHaveBeenCalledWith(expect.objectContaining({
                method: 'POST',
            }));
        });

        it('consultarBoleto makes GET', async () => {
            mockAxiosInstance.request.mockResolvedValue({ data: {} });
            await itauApiService.consultarBoleto('NN1');
            expect(mockAxiosInstance.request).toHaveBeenCalledWith(expect.objectContaining({
                url: expect.stringContaining('/boletos/NN1'),
            }));
        });

        it('listarBoletos makes GET with params', async () => {
            mockAxiosInstance.request.mockResolvedValue({ data: {} });
            await itauApiService.listarBoletos({ dataInicial: '2024-01-01', situacao: 'em_aberto' });
            expect(mockAxiosInstance.request).toHaveBeenCalledWith(expect.objectContaining({
                params: expect.objectContaining({ situacao: 'em_aberto' }),
            }));
        });

        it('baixarBoleto makes PATCH', async () => {
            mockAxiosInstance.request.mockResolvedValue({ data: null });
            await itauApiService.baixarBoleto('NN1');
            expect(mockAxiosInstance.request).toHaveBeenCalledWith(expect.objectContaining({
                method: 'PATCH',
                url: expect.stringContaining('/boletos/NN1/baixa'),
            }));
        });

        it('baixarBoleto with custom motivo', async () => {
            mockAxiosInstance.request.mockResolvedValue({ data: null });
            await itauApiService.baixarBoleto('NN1', 'OUTROS');
            expect(mockAxiosInstance.request).toHaveBeenCalledWith(expect.objectContaining({
                data: { motivo_baixa: 'OUTROS' },
            }));
        });

        it('downloadBoletoPDF initializes if not ready', async () => {
            (itauApiService as any).initialized = false;
            (itauApiService as any).axiosInstance = null;
            mockAxiosInstance.request.mockResolvedValue({ data: Buffer.from('pdf') });
            (itauApiService as any).initialize = vi.fn().mockImplementation(async () => {
                (itauApiService as any).initialized = true;
                (itauApiService as any).axiosInstance = mockAxiosInstance;
                return true;
            });

            const result = await itauApiService.downloadBoletoPDF('NN1');
            expect(Buffer.isBuffer(result)).toBe(true);

            (itauApiService as any).initialized = true;
            (itauApiService as any).axiosInstance = mockAxiosInstance;
        });
    });

    describe('Payment methods', () => {
        it('pagarBoleto makes POST', async () => {
            mockAxiosInstance.request.mockResolvedValue({ data: {} });
            await itauApiService.pagarBoleto({
                codigo_barras_linha_digitavel: '123',
                valor_pagamento: 100,
                data_pagamento: '2024-01-15',
            } as any);
            expect(mockAxiosInstance.request).toHaveBeenCalledWith(expect.objectContaining({
                method: 'POST',
            }));
        });

        it('getComprovantePagamento initializes if needed', async () => {
            (itauApiService as any).initialized = false;
            (itauApiService as any).axiosInstance = null;
            mockAxiosInstance.request.mockResolvedValue({ data: Buffer.from('pdf') });
            (itauApiService as any).initialize = vi.fn().mockImplementation(async () => {
                (itauApiService as any).initialized = true;
                (itauApiService as any).axiosInstance = mockAxiosInstance;
                return true;
            });

            const result = await itauApiService.getComprovantePagamento('TX1');
            expect(Buffer.isBuffer(result)).toBe(true);

            (itauApiService as any).initialized = true;
            (itauApiService as any).axiosInstance = mockAxiosInstance;
        });
    });

    describe('Webhook methods', () => {
        it('configurarWebhookPix makes PUT', async () => {
            mockAxiosInstance.request.mockResolvedValue({ data: null });
            await itauApiService.configurarWebhookPix('key1', 'https://hook.url');
            expect(mockAxiosInstance.request).toHaveBeenCalledWith(expect.objectContaining({
                method: 'PUT',
            }));
        });

        it('consultarWebhookPix makes GET', async () => {
            mockAxiosInstance.request.mockResolvedValue({ data: { webhookUrl: 'url' } });
            const result = await itauApiService.consultarWebhookPix('key1');
            expect(result.webhookUrl).toBe('url');
        });

        it('deletarWebhookPix makes DELETE', async () => {
            mockAxiosInstance.request.mockResolvedValue({ data: null });
            await itauApiService.deletarWebhookPix('key1');
            expect(mockAxiosInstance.request).toHaveBeenCalledWith(expect.objectContaining({
                method: 'DELETE',
            }));
        });
    });

    describe('itauRequest custom headers', () => {
        it('includes custom headers with account info', async () => {
            mockAxiosInstance.request.mockResolvedValue({ data: { disponivel: 1000 } });
            await itauApiService.getSaldo();
            expect(mockAxiosInstance.request).toHaveBeenCalledWith(expect.objectContaining({
                headers: expect.objectContaining({
                    'x-itau-flowID': expect.any(String),
                    'x-itau-correlationID': expect.any(String),
                    'x-conta-corrente': '12345',
                    'x-agencia': '0001',
                }),
            }));
        });
    });
});
