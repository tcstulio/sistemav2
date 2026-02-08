/**
 * Document Service
 * 
 * Serviço para obtenção e envio de documentos (boletos, faturas, recibos)
 * Integrado com o sistema de aprovação
 */

import { interApiService } from './interApiService';
import { itauApiService } from './itauApiService';
import { messageService } from './messageService';
import { approvalService } from './approvalService';
import { dolibarrService } from './dolibarrService';
import { logger } from '../utils/logger';

const log = logger.child('DocumentService');

// ===== Types =====

export type DocumentType = 'boleto' | 'invoice' | 'receipt';

export interface SendDocumentParams {
    documentType: DocumentType;
    documentId: string;
    banco?: 'inter' | 'itau';
    phone: string;
    sessionId: string;
    message?: string;
    requestedBy: string;
    skipApproval?: boolean;  // Para ações de baixo risco
}

// ===== Document Service =====

class DocumentService {

    /**
     * Obtém PDF de boleto do banco
     */
    async getBoletoPDF(banco: 'inter' | 'itau', nossoNumero: string): Promise<Buffer> {
        if (banco === 'inter') {
            return interApiService.downloadBoletoPDF(nossoNumero);
        } else if (banco === 'itau') {
            return itauApiService.downloadBoletoPDF(nossoNumero);
        } else {
            throw new Error('Banco não suportado');
        }
    }

    /**
     * Obtém PDF de fatura do Dolibarr
     * Usa o endpoint documents/download do Dolibarr
     */
    async getInvoicePDF(invoiceId: string): Promise<Buffer> {
        try {
            // Dolibarr endpoint: GET /documents/download?modulepart=facture&original_file=...
            const response = await dolibarrService.proxyRequest(
                'GET',
                `/documents/download`,
                null,
                {
                    modulepart: 'facture',
                    original_file: `${invoiceId}/${invoiceId}.pdf`
                },
                {}
            );

            if (response.data) {
                // Dolibarr retorna base64
                return Buffer.from(response.data.content, 'base64');
            }

            throw new Error('Documento não encontrado');
        } catch (error: any) {
            log.error(`Erro ao obter PDF da fatura ${invoiceId}: ${error.message}`);
            throw new Error(`Falha ao obter PDF da fatura: ${error.message}`);
        }
    }

    /**
     * Busca telefone do cliente no Dolibarr
     */
    async getCustomerPhone(thirdPartyId: string): Promise<string | null> {
        try {
            const response = await dolibarrService.proxyRequest(
                'GET',
                `/thirdparties/${thirdPartyId}`,
                null,
                {},
                {}
            );

            if (response.data) {
                // Prioridade: celular > telefone fixo
                return response.data.phone_mobile || response.data.phone || null;
            }

            return null;
        } catch (error: any) {
            log.error(`Erro ao buscar telefone do cliente ${thirdPartyId}: ${error.message}`);
            return null;
        }
    }

    /**
     * Envia documento via WhatsApp (com sistema de aprovação)
     */
    async sendDocument(params: SendDocumentParams): Promise<{
        success: boolean;
        approvalRequired?: boolean;
        actionId?: string;
        messageId?: string;
        error?: string;
    }> {
        const { documentType, documentId, banco, phone, sessionId, message, requestedBy, skipApproval } = params;

        // Descrição legível da ação
        const description = this.getActionDescription(documentType, documentId, phone, banco);

        // Se skipApproval ou ação de baixo risco, executar diretamente
        if (skipApproval) {
            try {
                const result = await this.executeDocumentSend(params);
                return { success: true, messageId: result.messageId };
            } catch (error: any) {
                return { success: false, error: error.message };
            }
        }

        // Criar ação pendente de aprovação
        const action = await approvalService.createPendingAction({
            type: 'enviar_documento',
            banco,
            payload: {
                documentType,
                documentId,
                phone,
                sessionId,
                message,
            },
            description,
            requestedBy,
        });

        return {
            success: true,
            approvalRequired: true,
            actionId: action.id,
        };
    }

    /**
     * Executa envio de documento (chamado após aprovação ou diretamente)
     */
    async executeDocumentSend(params: SendDocumentParams): Promise<{ messageId: string }> {
        const { documentType, documentId, banco, phone, sessionId, message } = params;

        // Obter PDF
        let pdfBuffer: Buffer;
        let filename: string;

        switch (documentType) {
            case 'boleto':
                if (!banco) throw new Error('Banco não especificado para boleto');
                pdfBuffer = await this.getBoletoPDF(banco, documentId);
                filename = `boleto_${documentId}.pdf`;
                break;

            case 'invoice':
                pdfBuffer = await this.getInvoicePDF(documentId);
                filename = `fatura_${documentId}.pdf`;
                break;

            case 'receipt':
                // Para recibos, verificar se é comprovante de pagamento do banco
                if (banco === 'inter') {
                    pdfBuffer = await interApiService.getComprovantePagamento(documentId);
                } else if (banco === 'itau') {
                    pdfBuffer = await itauApiService.getComprovantePagamento(documentId);
                } else {
                    throw new Error('Banco não especificado para recibo');
                }
                filename = `recibo_${documentId}.pdf`;
                break;

            default:
                throw new Error(`Tipo de documento não suportado: ${documentType}`);
        }

        // Converter para base64 data URL
        const base64 = pdfBuffer.toString('base64');
        const fileData = `data:application/pdf;base64,${base64}`;

        // Formatar telefone para WhatsApp
        const chatId = this.formatPhoneForWhatsApp(phone);

        // Mensagem padrão ou personalizada
        const caption = message || this.getDefaultMessage(documentType);

        // Enviar via WhatsApp
        const result = await messageService.sendFile(sessionId, chatId, fileData, filename, caption);

        log.info(`Documento enviado: ${filename} para ${chatId}`);

        return { messageId: result.id };
    }

    // ===== Private Methods =====

    private formatPhoneForWhatsApp(phone: string): string {
        // Remove caracteres não numéricos
        let cleaned = phone.replace(/\D/g, '');

        // Adiciona código do país se não tiver
        if (!cleaned.startsWith('55') && cleaned.length <= 11) {
            cleaned = '55' + cleaned;
        }

        return cleaned;
    }

    private getDefaultMessage(documentType: DocumentType): string {
        switch (documentType) {
            case 'boleto':
                return '📄 Segue o boleto em anexo. Qualquer dúvida, estamos à disposição!';
            case 'invoice':
                return '📄 Segue a nota fiscal em anexo. Obrigado pela preferência!';
            case 'receipt':
                return '✅ Segue o comprovante de pagamento em anexo.';
            default:
                return '📄 Segue o documento em anexo.';
        }
    }

    private getActionDescription(
        documentType: DocumentType,
        documentId: string,
        phone: string,
        banco?: string
    ): string {
        const tipoDoc = {
            boleto: 'Boleto',
            invoice: 'Nota Fiscal',
            receipt: 'Recibo',
        }[documentType];

        const bancoStr = banco ? ` (${banco.charAt(0).toUpperCase() + banco.slice(1)})` : '';

        return `Enviar ${tipoDoc} #${documentId}${bancoStr} via WhatsApp para ${phone}`;
    }
}

export const documentService = new DocumentService();
