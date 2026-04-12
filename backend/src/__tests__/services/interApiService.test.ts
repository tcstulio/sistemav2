import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';

vi.mock('fs', () => ({
    default: { existsSync: vi.fn(), readFileSync: vi.fn() },
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
}));

vi.mock('../../config/env', () => ({
    config: {
        interClientId: 'test-client-id',
        interClientSecret: 'test-client-secret',
        interCertPath: './certs/inter.crt',
        interKeyPath: './certs/inter.key',
        interSandbox: false,
    },
}));

import fs from 'fs';
import { interApiService } from '../../services/interApiService';

describe('InterApiService', () => {
    let mockAxiosInstance: any;

    beforeEach(() => {
        vi.clearAllMocks();
        mockAxiosInstance = {
            request: vi.fn(),
        };
        (interApiService as any).axiosInstance = mockAxiosInstance;
        (interApiService as any).initialized = true;
        (interApiService as any).tokenCache = { accessToken: 'test-token', expiresAt: Date.now() + 3600000 };
        (interApiService as any).httpsAgent = {};
    });

    describe('abstract implementations', () => {
        it('returns correct bank name', () => {
            expect((interApiService as any).getBankName()).toBe('Inter');
        });

        it('maps balance correctly', () => {
            const result = (interApiService as any).mapBalance({
                disponivel: 1000,
                bloqueadoCheque: 200,
            });
            expect(result.available).toBe(1000);
            expect(result.blocked).toBe(200);
            expect(result.total).toBe(1200);
        });

        it('maps balance with defaults', () => {
            const result = (interApiService as any).mapBalance({});
            expect(result.available).toBe(0);
            expect(result.total).toBe(0);
        });

        it('maps transaction correctly', () => {
            const result = (interApiService as any).mapTransaction({
                idTransacao: 'TX1',
                dataEntrada: '2024-01-15',
                valor: '100.50',
                descricao: 'Payment',
                tipoOperacao: 'C',
                tipoTransacao: 'PIX',
            });
            expect(result.id).toBe('TX1');
            expect(result.amount).toBe(100.5);
            expect(result.type).toBe('credit');
            expect(result.category).toBe('PIX');
        });

        it('maps debit transaction', () => {
            const result = (interApiService as any).mapTransaction({
                idTransacao: 'TX2',
                dataEntrada: '2024-01-15',
                valor: -50,
                titulo: 'Debit',
                tipoOperacao: 'D',
            });
            expect(result.type).toBe('debit');
            expect(result.description).toBe('Debit');
        });
    });

    describe('getBalance', () => {
        it('gets balance via getSaldo', async () => {
            mockAxiosInstance.request.mockResolvedValue({
                data: { disponivel: 5000, bloqueadoCheque: 100 },
            });

            const result = await interApiService.getBalance();
            expect(result.available).toBe(5000);
            expect(result.blocked).toBe(100);
        });
    });

    describe('getStatement', () => {
        it('gets statement and maps transactions', async () => {
            mockAxiosInstance.request.mockResolvedValue({
                data: {
                    transacoes: [
                        { idTransacao: 'TX1', dataEntrada: '2024-01-15', valor: 100, descricao: 'Test', tipoOperacao: 'C', tipoTransacao: 'PIX' },
                    ],
                },
            });

            const result = await interApiService.getStatement('2024-01-01', '2024-01-31');
            expect(result.transactions).toHaveLength(1);
            expect(result.startDate).toEqual(new Date('2024-01-01'));
        });
    });

    describe('banking API methods', () => {
        it('getSaldo makes GET request', async () => {
            mockAxiosInstance.request.mockResolvedValue({ data: { disponivel: 1000 } });
            const result = await interApiService.getSaldo();
            expect(mockAxiosInstance.request).toHaveBeenCalledWith(expect.objectContaining({
                method: 'GET',
                url: '/banking/v2/saldo',
            }));
        });

        it('getExtrato makes GET with params', async () => {
            mockAxiosInstance.request.mockResolvedValue({ data: { transacoes: [] } });
            await interApiService.getExtrato('2024-01-01', '2024-01-31');
            expect(mockAxiosInstance.request).toHaveBeenCalledWith(expect.objectContaining({
                params: { dataInicio: '2024-01-01', dataFim: '2024-01-31' },
            }));
        });

        it('getExtratoCompleto returns transactions array', async () => {
            mockAxiosInstance.request.mockResolvedValue({
                data: { transacoes: [{ id: 1 }, { id: 2 }] },
            });
            const result = await interApiService.getExtratoCompleto('2024-01-01', '2024-01-31');
            expect(result).toHaveLength(2);
        });

        it('getExtratoCompleto handles missing transactions', async () => {
            mockAxiosInstance.request.mockResolvedValue({ data: {} });
            const result = await interApiService.getExtratoCompleto('2024-01-01', '2024-01-31');
            expect(result).toEqual([]);
        });

        it('pagarBoleto makes POST request', async () => {
            mockAxiosInstance.request.mockResolvedValue({ data: { id: 'PAY1' } });
            await interApiService.pagarBoleto({ codigoBobina: '123' } as any);
            expect(mockAxiosInstance.request).toHaveBeenCalledWith(expect.objectContaining({
                method: 'POST',
                url: '/banking/v2/pagamento',
            }));
        });

        it('getComprovantePagamento calls requestBinary', async () => {
            mockAxiosInstance.request.mockResolvedValue({ data: Buffer.from('pdf') });
            const result = await interApiService.getComprovantePagamento('TX123');
            expect(Buffer.isBuffer(result)).toBe(true);
        });
    });

    describe('Pix API methods', () => {
        it('criarPixCobranca without txid makes POST', async () => {
            mockAxiosInstance.request.mockResolvedValue({ data: { txid: 'TX1' } });
            await interApiService.criarPixCobranca({ valor: 100 } as any);
            expect(mockAxiosInstance.request).toHaveBeenCalledWith(expect.objectContaining({
                method: 'POST',
                url: '/pix/v2/cob',
            }));
        });

        it('criarPixCobranca with txid makes PUT', async () => {
            mockAxiosInstance.request.mockResolvedValue({ data: { txid: 'CUSTOM' } });
            await interApiService.criarPixCobranca({ valor: 100 } as any, 'CUSTOM');
            expect(mockAxiosInstance.request).toHaveBeenCalledWith(expect.objectContaining({
                method: 'PUT',
                url: '/pix/v2/cob/CUSTOM',
            }));
        });

        it('criarPixCobrancaVencimento makes PUT to cobv', async () => {
            mockAxiosInstance.request.mockResolvedValue({ data: { txid: 'V1' } });
            await interApiService.criarPixCobrancaVencimento('V1', {} as any);
            expect(mockAxiosInstance.request).toHaveBeenCalledWith(expect.objectContaining({
                url: '/pix/v2/cobv/V1',
            }));
        });

        it('consultarPixCobranca makes GET', async () => {
            mockAxiosInstance.request.mockResolvedValue({ data: { txid: 'TX1' } });
            await interApiService.consultarPixCobranca('TX1');
            expect(mockAxiosInstance.request).toHaveBeenCalledWith(expect.objectContaining({
                url: '/pix/v2/cob/TX1',
            }));
        });

        it('getPixQRCode makes GET to loc', async () => {
            mockAxiosInstance.request.mockResolvedValue({ data: { qrcode: 'qr' } });
            await interApiService.getPixQRCode(123);
            expect(mockAxiosInstance.request).toHaveBeenCalledWith(expect.objectContaining({
                url: '/pix/v2/loc/123/qrcode',
            }));
        });

        it('enviarPix makes POST', async () => {
            mockAxiosInstance.request.mockResolvedValue({ data: { e2eId: 'E2E' } });
            await interApiService.enviarPix({ valor: 100 } as any);
            expect(mockAxiosInstance.request).toHaveBeenCalledWith(expect.objectContaining({
                method: 'POST',
                url: '/pix/v2/pix',
            }));
        });

        it('listarPixRecebidos returns pix array', async () => {
            mockAxiosInstance.request.mockResolvedValue({ data: { pix: [{ id: 1 }] } });
            const result = await interApiService.listarPixRecebidos('2024-01-01', '2024-01-31');
            expect(result).toHaveLength(1);
        });

        it('listarPixRecebidos handles missing pix', async () => {
            mockAxiosInstance.request.mockResolvedValue({ data: {} });
            const result = await interApiService.listarPixRecebidos('2024-01-01', '2024-01-31');
            expect(result).toEqual([]);
        });

        it('consultarPix makes GET by endToEndId', async () => {
            mockAxiosInstance.request.mockResolvedValue({ data: { endToEndId: 'E2E1' } });
            await interApiService.consultarPix('E2E1');
            expect(mockAxiosInstance.request).toHaveBeenCalledWith(expect.objectContaining({
                url: '/pix/v2/pix/E2E1',
            }));
        });
    });

    describe('Cobranca API methods', () => {
        it('emitirBoleto makes POST', async () => {
            mockAxiosInstance.request.mockResolvedValue({ data: { nossoNumero: '123' } });
            await interApiService.emitirBoleto({ seuNumero: 'S1' } as any);
            expect(mockAxiosInstance.request).toHaveBeenCalledWith(expect.objectContaining({
                method: 'POST',
                url: '/cobranca/v3/cobrancas',
            }));
        });

        it('consultarBoleto makes GET', async () => {
            mockAxiosInstance.request.mockResolvedValue({ data: {} });
            await interApiService.consultarBoleto('NN123');
            expect(mockAxiosInstance.request).toHaveBeenCalledWith(expect.objectContaining({
                url: '/cobranca/v3/cobrancas/NN123',
            }));
        });

        it('listarBoletos makes GET with params', async () => {
            mockAxiosInstance.request.mockResolvedValue({ data: {} });
            await interApiService.listarBoletos({ dataInicial: '2024-01-01', situacao: 'EMABERTO' });
            expect(mockAxiosInstance.request).toHaveBeenCalledWith(expect.objectContaining({
                params: expect.objectContaining({ situacao: 'EMABERTO' }),
            }));
        });

        it('cancelarBoleto makes POST', async () => {
            mockAxiosInstance.request.mockResolvedValue({ data: null });
            await interApiService.cancelarBoleto('NN1', 'Test');
            expect(mockAxiosInstance.request).toHaveBeenCalledWith(expect.objectContaining({
                method: 'POST',
                url: '/cobranca/v3/cobrancas/NN1/cancelar',
            }));
        });

        it('downloadBoletoPDF returns buffer', async () => {
            mockAxiosInstance.request.mockResolvedValue({ data: Buffer.from('pdf') });
            const result = await interApiService.downloadBoletoPDF('NN1');
            expect(Buffer.isBuffer(result)).toBe(true);
        });
    });

    describe('Webhook methods', () => {
        it('configurarWebhookPix makes PUT', async () => {
            mockAxiosInstance.request.mockResolvedValue({ data: null });
            await interApiService.configurarWebhookPix('key1', 'https://hook.url');
            expect(mockAxiosInstance.request).toHaveBeenCalledWith(expect.objectContaining({
                method: 'PUT',
                url: '/pix/v2/webhook/key1',
            }));
        });

        it('consultarWebhookPix makes GET', async () => {
            mockAxiosInstance.request.mockResolvedValue({ data: { webhookUrl: 'url' } });
            const result = await interApiService.consultarWebhookPix('key1');
            expect(result.webhookUrl).toBe('url');
        });

        it('deletarWebhookPix makes DELETE', async () => {
            mockAxiosInstance.request.mockResolvedValue({ data: null });
            await interApiService.deletarWebhookPix('key1');
            expect(mockAxiosInstance.request).toHaveBeenCalledWith(expect.objectContaining({
                method: 'DELETE',
                url: '/pix/v2/webhook/key1',
            }));
        });
    });
});
