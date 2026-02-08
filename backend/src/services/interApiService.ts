/**
 * Banco Inter API Service
 * 
 * Integração completa com a API do Banco Inter
 * - Autenticação mTLS + OAuth2 (herdado de BankingApiBase)
 * - API Banking (saldo, extrato, pagamentos)
 * - API Pix (cobrança, pagamento, consultas)
 * - API Cobrança (boletos)
 */

import { logger } from '../utils/logger';
import { config } from '../config/env';
import {
    SaldoInter,
    ExtratoInter,
    TransacaoInter,
    PagamentoBoletoRequest,
    PagamentoBoletoResponse,
    PixCobrancaRequest,
    PixCobrancaResponse,
    PixQRCodeResponse,
    PixPagamentoRequest,
    PixPagamentoResponse,
    PixRecebido,
    PixListaRecebidosResponse,
    BoletoEmissaoRequest,
    BoletoResponse,
    BoletoConsultaResponse,
    BoletoListaResponse,
} from '../types/inter.types';
import {
    BankingApiBase,
    BankBalance,
    BankStatement,
    BankTransaction,
    BankUrlConfig,
} from './banking/bankingApiBase';

// ===== Constants =====

const INTER_URLS = {
    production: {
        auth: 'https://cdpj.partners.bancointer.com.br/oauth/v2/token',
        api: 'https://cdpj.partners.bancointer.com.br',
    },
    sandbox: {
        auth: 'https://cdpj-sandbox.partners.uatinter.co/oauth/v2/token',
        api: 'https://cdpj-sandbox.partners.uatinter.co',
    },
};

const SCOPES = {
    banking: 'extrato.read boleto-cobranca.read boleto-cobranca.write pagamento-boleto.read pagamento-boleto.write',
    pix: 'cob.read cob.write cobv.read cobv.write pix.read pix.write webhook.read webhook.write',
    cobranca: 'boleto-cobranca.read boleto-cobranca.write',
};

// ===== InterApiService Class =====

const log = logger.child('InterApiService');

class InterApiService extends BankingApiBase {
    // ===== Abstract Method Implementations =====

    protected getBankName(): string {
        return 'Inter';
    }

    protected getClientId(): string {
        return config.interClientId || '';
    }

    protected getClientSecret(): string {
        return config.interClientSecret || '';
    }

    protected getCertPath(): string {
        return config.interCertPath || '';
    }

    protected getKeyPath(): string {
        return config.interKeyPath || '';
    }

    protected isSandbox(): boolean {
        return config.interSandbox || false;
    }

    protected getUrls(): { production: BankUrlConfig; sandbox: BankUrlConfig } {
        return INTER_URLS;
    }

    protected getScopes(): string {
        return `${SCOPES.banking} ${SCOPES.pix} ${SCOPES.cobranca}`;
    }

    protected mapBalance(response: SaldoInter): BankBalance {
        return {
            available: response.disponivel || 0,
            blocked: response.bloqueadoCheque || 0,
            total: (response.disponivel || 0) + (response.bloqueadoCheque || 0),
        };
    }

    protected mapTransaction(raw: TransacaoInter): BankTransaction {
        const amount = typeof raw.valor === 'string' ? parseFloat(raw.valor) : raw.valor;
        return {
            id: raw.idTransacao || `${raw.dataEntrada}-${amount}`,
            date: new Date(raw.dataEntrada),
            description: raw.descricao || raw.titulo || 'Transação',
            amount: Math.abs(amount),
            type: raw.tipoOperacao === 'C' ? 'credit' : 'debit',
            category: raw.tipoTransacao,
            raw,
        };
    }

    // ===== Common Banking Methods (Required by Base) =====

    async getBalance(): Promise<BankBalance> {
        const saldo = await this.getSaldo();
        return this.mapBalance(saldo);
    }

    async getStatement(startDate: string, endDate: string): Promise<BankStatement> {
        const extrato = await this.getExtrato(startDate, endDate);
        const transactions = (extrato.transacoes || []).map(t => this.mapTransaction(t));

        return {
            startDate: new Date(startDate),
            endDate: new Date(endDate),
            openingBalance: 0, // Inter doesn't provide this
            closingBalance: 0, // Inter doesn't provide this
            transactions,
        };
    }

    // ===== Banking API (Inter-specific) =====

    /**
     * Get account balance (Inter format)
     */
    async getSaldo(): Promise<SaldoInter> {
        log.info('Getting account balance...');
        return this.request<SaldoInter>('GET', '/banking/v2/saldo');
    }

    /**
     * Get account statement (Inter format)
     */
    async getExtrato(dataInicial: string, dataFinal: string): Promise<ExtratoInter> {
        log.info(`Getting statement from ${dataInicial} to ${dataFinal}...`);
        return this.request<ExtratoInter>('GET', '/banking/v2/extrato', null, {
            dataInicio: dataInicial,
            dataFim: dataFinal,
        });
    }

    /**
     * Get detailed statement with enriched data
     */
    async getExtratoCompleto(dataInicial: string, dataFinal: string): Promise<TransacaoInter[]> {
        const extrato = await this.getExtrato(dataInicial, dataFinal);
        return extrato.transacoes || [];
    }

    /**
     * Pay a boleto
     */
    async pagarBoleto(dados: PagamentoBoletoRequest): Promise<PagamentoBoletoResponse> {
        log.info('Paying boleto...');
        return this.request<PagamentoBoletoResponse>('POST', '/banking/v2/pagamento', dados);
    }

    /**
     * Get payment receipt
     */
    async getComprovantePagamento(codigoTransacao: string): Promise<Buffer> {
        log.info(`Getting payment receipt: ${codigoTransacao}`);
        return this.requestBinary('GET', `/banking/v2/pagamento/${codigoTransacao}/pdf`);
    }

    // ===== Pix API =====

    /**
     * Create immediate Pix charge (Cob)
     */
    async criarPixCobranca(dados: PixCobrancaRequest, txid?: string): Promise<PixCobrancaResponse> {
        log.info('Creating Pix charge...');

        if (txid) {
            return this.request<PixCobrancaResponse>('PUT', `/pix/v2/cob/${txid}`, dados);
        }

        return this.request<PixCobrancaResponse>('POST', '/pix/v2/cob', dados);
    }

    /**
     * Create Pix charge with due date (CobV)
     */
    async criarPixCobrancaVencimento(txid: string, dados: PixCobrancaRequest): Promise<PixCobrancaResponse> {
        log.info(`Creating Pix charge with due date: ${txid}`);
        return this.request<PixCobrancaResponse>('PUT', `/pix/v2/cobv/${txid}`, dados);
    }

    /**
     * Get Pix charge info
     */
    async consultarPixCobranca(txid: string): Promise<PixCobrancaResponse> {
        log.info(`Consulting Pix charge: ${txid}`);
        return this.request<PixCobrancaResponse>('GET', `/pix/v2/cob/${txid}`);
    }

    /**
     * Get QR Code for Pix charge
     */
    async getPixQRCode(locationId: number): Promise<PixQRCodeResponse> {
        log.info(`Getting Pix QR Code for location: ${locationId}`);
        return this.request<PixQRCodeResponse>('GET', `/pix/v2/loc/${locationId}/qrcode`);
    }

    /**
     * Send Pix payment
     */
    async enviarPix(dados: PixPagamentoRequest): Promise<PixPagamentoResponse> {
        log.info('Sending Pix payment...');
        return this.request<PixPagamentoResponse>('POST', '/pix/v2/pix', dados);
    }

    /**
     * List received Pix
     */
    async listarPixRecebidos(inicio: string, fim: string): Promise<PixRecebido[]> {
        log.info(`Listing received Pix from ${inicio} to ${fim}...`);
        const response = await this.request<PixListaRecebidosResponse>('GET', '/pix/v2/pix', null, {
            inicio,
            fim,
        });
        return response.pix || [];
    }

    /**
     * Get Pix by endToEndId
     */
    async consultarPix(endToEndId: string): Promise<PixRecebido> {
        log.info(`Consulting Pix: ${endToEndId}`);
        return this.request<PixRecebido>('GET', `/pix/v2/pix/${endToEndId}`);
    }

    // ===== Cobrança API (Boletos) =====

    /**
     * Issue a new boleto
     */
    async emitirBoleto(dados: BoletoEmissaoRequest): Promise<BoletoResponse> {
        log.info(`Issuing boleto: ${dados.seuNumero}`);
        return this.request<BoletoResponse>('POST', '/cobranca/v3/cobrancas', dados);
    }

    /**
     * Get boleto info by nossoNumero
     */
    async consultarBoleto(nossoNumero: string): Promise<BoletoConsultaResponse> {
        log.info(`Consulting boleto: ${nossoNumero}`);
        return this.request<BoletoConsultaResponse>('GET', `/cobranca/v3/cobrancas/${nossoNumero}`);
    }

    /**
     * List boletos with filters
     */
    async listarBoletos(params: {
        dataInicial?: string;
        dataFinal?: string;
        situacao?: 'EMABERTO' | 'PAGO' | 'CANCELADO' | 'EXPIRADO' | 'BAIXADO';
        pagina?: number;
        tamanhoPagina?: number;
    }): Promise<BoletoListaResponse> {
        log.info('Listing boletos...');
        return this.request<BoletoListaResponse>('GET', '/cobranca/v3/cobrancas', null, {
            dataInicio: params.dataInicial,
            dataFim: params.dataFinal,
            situacao: params.situacao,
            paginaAtual: params.pagina || 0,
            itensPorPagina: params.tamanhoPagina || 50,
        });
    }

    /**
     * Cancel a boleto
     */
    async cancelarBoleto(nossoNumero: string, motivoCancelamento: string): Promise<void> {
        log.info(`Cancelling boleto: ${nossoNumero}`);
        await this.request<void>('POST', `/cobranca/v3/cobrancas/${nossoNumero}/cancelar`, {
            motivoCancelamento,
        });
    }

    /**
     * Download boleto PDF
     */
    async downloadBoletoPDF(nossoNumero: string): Promise<Buffer> {
        log.info(`Downloading boleto PDF: ${nossoNumero}`);
        return this.requestBinary('GET', `/cobranca/v3/cobrancas/${nossoNumero}/pdf`);
    }

    // ===== Webhooks =====

    /**
     * Configure Pix webhook
     */
    async configurarWebhookPix(chave: string, webhookUrl: string): Promise<void> {
        log.info(`Configuring Pix webhook for key: ${chave}`);
        await this.request<void>('PUT', `/pix/v2/webhook/${chave}`, {
            webhookUrl,
        });
    }

    /**
     * Get Pix webhook config
     */
    async consultarWebhookPix(chave: string): Promise<{ webhookUrl: string }> {
        log.info(`Getting Pix webhook config for key: ${chave}`);
        return this.request<{ webhookUrl: string }>('GET', `/pix/v2/webhook/${chave}`);
    }

    /**
     * Delete Pix webhook
     */
    async deletarWebhookPix(chave: string): Promise<void> {
        log.info(`Deleting Pix webhook for key: ${chave}`);
        await this.request<void>('DELETE', `/pix/v2/webhook/${chave}`);
    }
}

// Export singleton instance
export const interApiService = new InterApiService();
