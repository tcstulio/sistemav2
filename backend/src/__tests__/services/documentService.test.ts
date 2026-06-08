import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../services/interApiService', () => ({
    interApiService: {
        downloadBoletoPDF: vi.fn(),
        getComprovantePagamento: vi.fn(),
    },
}));

vi.mock('../../services/itauApiService', () => ({
    itauApiService: {
        downloadBoletoPDF: vi.fn(),
        getComprovantePagamento: vi.fn(),
    },
}));

vi.mock('../../services/legacy/messageService', () => ({
    messageService: {
        sendFile: vi.fn(),
    },
}));

vi.mock('../../services/approvalService', () => ({
    approvalService: {
        createPendingAction: vi.fn(),
    },
}));

vi.mock('../../services/dolibarrService', () => ({
    dolibarrService: {
        proxyRequest: vi.fn(),
        getDocumentPDF: vi.fn(),
    },
}));

import { documentService } from '../../services/documentService';
import { interApiService } from '../../services/interApiService';
import { itauApiService } from '../../services/itauApiService';
import { messageService } from '../../services/legacy/messageService';
import { approvalService } from '../../services/approvalService';
import { dolibarrService } from '../../services/dolibarrService';

describe('DocumentService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('getBoletoPDF', () => {
        it('gets PDF from Inter', async () => {
            (interApiService.downloadBoletoPDF as any).mockResolvedValue(Buffer.from('inter-pdf'));
            const result = await documentService.getBoletoPDF('inter', 'NN123');
            expect(result.toString()).toBe('inter-pdf');
        });

        it('gets PDF from Itau', async () => {
            (itauApiService.downloadBoletoPDF as any).mockResolvedValue(Buffer.from('itau-pdf'));
            const result = await documentService.getBoletoPDF('itau', 'NN456');
            expect(result.toString()).toBe('itau-pdf');
        });

        it('throws for unsupported bank', async () => {
            await expect(documentService.getBoletoPDF('bradesco' as any, 'NN')).rejects.toThrow('Banco não suportado');
        });
    });

    describe('getInvoicePDF', () => {
        it('gets invoice PDF from Dolibarr', async () => {
            (dolibarrService.getDocumentPDF as any).mockResolvedValue(Buffer.from('invoice-pdf'));

            const result = await documentService.getInvoicePDF('INV001');
            expect(result.toString()).toBe('invoice-pdf');
        });

        it('throws when document not found', async () => {
            (dolibarrService.getDocumentPDF as any).mockRejectedValue(new Error('Documento não encontrado'));
            await expect(documentService.getInvoicePDF('INV999')).rejects.toThrow('Documento não encontrado');
        });

        it('throws on proxy error', async () => {
            (dolibarrService.getDocumentPDF as any).mockRejectedValue(new Error('Proxy failed'));
            await expect(documentService.getInvoicePDF('INV001')).rejects.toThrow('Falha ao obter PDF');
        });
    });

    describe('getCustomerPhone', () => {
        it('returns mobile phone', async () => {
            (dolibarrService.proxyRequest as any).mockResolvedValue({
                data: { phone_mobile: '11999999999', phone: '1133333333' },
            });

            const result = await documentService.getCustomerPhone('TP001');
            expect(result).toBe('11999999999');
        });

        it('falls back to fixed phone', async () => {
            (dolibarrService.proxyRequest as any).mockResolvedValue({
                data: { phone: '1133333333' },
            });

            const result = await documentService.getCustomerPhone('TP001');
            expect(result).toBe('1133333333');
        });

        it('returns null when no data', async () => {
            (dolibarrService.proxyRequest as any).mockResolvedValue({ data: null });
            const result = await documentService.getCustomerPhone('TP001');
            expect(result).toBeNull();
        });

        it('returns null on error', async () => {
            (dolibarrService.proxyRequest as any).mockRejectedValue(new Error('fail'));
            const result = await documentService.getCustomerPhone('TP001');
            expect(result).toBeNull();
        });
    });

    describe('sendDocument', () => {
        const baseParams = {
            documentType: 'boleto' as const,
            documentId: 'NN123',
            banco: 'inter' as const,
            phone: '11999999999',
            sessionId: 'sess1',
            requestedBy: 'admin',
        };

        it('skips approval when flag set', async () => {
            (interApiService.downloadBoletoPDF as any).mockResolvedValue(Buffer.from('pdf'));
            (messageService.sendFile as any).mockResolvedValue({ id: 'msg1' } as any);

            const result = await documentService.sendDocument({ ...baseParams, skipApproval: true });

            expect(result.success).toBe(true);
            expect(result.messageId).toBe('msg1');
        });

        it('handles skip approval error', async () => {
            (interApiService.downloadBoletoPDF as any).mockRejectedValue(new Error('PDF error'));

            const result = await documentService.sendDocument({ ...baseParams, skipApproval: true });

            expect(result.success).toBe(false);
            expect(result.error).toBe('PDF error');
        });

        it('creates approval action when not skipped', async () => {
            (approvalService.createPendingAction as any).mockResolvedValue({ id: 'action-1' });

            const result = await documentService.sendDocument(baseParams);

            expect(result.success).toBe(true);
            expect(result.approvalRequired).toBe(true);
            expect(result.actionId).toBe('action-1');
        });
    });

    describe('executeDocumentSend', () => {
        it('sends boleto document', async () => {
            (interApiService.downloadBoletoPDF as any).mockResolvedValue(Buffer.from('boleto-pdf'));
            (messageService.sendFile as any).mockResolvedValue({ id: 'msg1' } as any);

            const result = await documentService.executeDocumentSend({
                documentType: 'boleto',
                documentId: 'NN1',
                banco: 'inter',
                phone: '11999999999',
                sessionId: 's1',
            });

            expect(result.messageId).toBe('msg1');
        });

        it('sends invoice document', async () => {
            (dolibarrService.getDocumentPDF as any).mockResolvedValue(Buffer.from('inv-pdf'));
            (messageService.sendFile as any).mockResolvedValue({ id: 'msg2' } as any);

            const result = await documentService.executeDocumentSend({
                documentType: 'invoice',
                documentId: 'INV1',
                phone: '11999999999',
                sessionId: 's1',
            });

            expect(result.messageId).toBe('msg2');
        });

        it('sends receipt from Inter', async () => {
            (interApiService.getComprovantePagamento as any).mockResolvedValue(Buffer.from('receipt'));
            (messageService.sendFile as any).mockResolvedValue({ id: 'msg3' } as any);

            const result = await documentService.executeDocumentSend({
                documentType: 'receipt',
                documentId: 'TX1',
                banco: 'inter',
                phone: '11999999999',
                sessionId: 's1',
            });

            expect(result.messageId).toBe('msg3');
        });

        it('sends receipt from Itau', async () => {
            (itauApiService.getComprovantePagamento as any).mockResolvedValue(Buffer.from('receipt'));
            (messageService.sendFile as any).mockResolvedValue({ id: 'msg4' } as any);

            const result = await documentService.executeDocumentSend({
                documentType: 'receipt',
                documentId: 'TX1',
                banco: 'itau',
                phone: '11999999999',
                sessionId: 's1',
            });

            expect(result.messageId).toBe('msg4');
        });

        it('throws for boleto without bank', async () => {
            await expect(documentService.executeDocumentSend({
                documentType: 'boleto',
                documentId: 'NN1',
                phone: '11999999999',
                sessionId: 's1',
            })).rejects.toThrow('Banco não especificado');
        });

        it('throws for receipt without bank', async () => {
            await expect(documentService.executeDocumentSend({
                documentType: 'receipt',
                documentId: 'TX1',
                phone: '11999999999',
                sessionId: 's1',
            })).rejects.toThrow('Banco não especificado');
        });

        it('uses custom message', async () => {
            (interApiService.downloadBoletoPDF as any).mockResolvedValue(Buffer.from('pdf'));
            (messageService.sendFile as any).mockResolvedValue({ id: 'msg1' } as any);

            await documentService.executeDocumentSend({
                documentType: 'boleto',
                documentId: 'NN1',
                banco: 'inter',
                phone: '11999999999',
                sessionId: 's1',
                message: 'Custom message',
            });

            expect(messageService.sendFile).toHaveBeenCalledWith(
                expect.any(String),
                expect.any(String),
                expect.any(String),
                expect.any(String),
                'Custom message'
            );
        });

        it('formats phone number with country code', async () => {
            (interApiService.downloadBoletoPDF as any).mockResolvedValue(Buffer.from('pdf'));
            (messageService.sendFile as any).mockResolvedValue({ id: 'msg1' } as any);

            await documentService.executeDocumentSend({
                documentType: 'boleto',
                documentId: 'NN1',
                banco: 'inter',
                phone: '999999999',
                sessionId: 's1',
            });

            expect(messageService.sendFile).toHaveBeenCalledWith(
                expect.any(String),
                '55999999999',
                expect.any(String),
                expect.any(String),
                expect.any(String)
            );
        });
    });
});
