/**
 * Banco Itaú API Service
 * 
 * Integração completa com a API do Banco Itaú
 * - Autenticação mTLS + OAuth2 (herdado de BankingApiBase)
 * - API Banking (saldo, extrato)
 * - API PIX (cobrança, pagamento, consultas)
 * - API Boleto V2.0 (híbrido)
 */

import { logger } from '../utils/logger';
import { config } from '../config/env';
import { bankingCredentialsStore } from './bankingCredentialsStore';
import {
    SaldoItau,
    ExtratoItau,
    TransacaoItau,
    PixCobrancaItauRequest,
    PixCobrancaItauResponse,
    PixCobrancaVencimentoItauRequest,
    PixRecebidoItau,
    PixPagamentoItauRequest,
    PixPagamentoItauResponse,
    PixQRCodeItauResponse,
    BoletoItauRequest,
    BoletoItauResponse,
    BoletoConsultaItauResponse,
    BoletoListaItauResponse,
    PagamentoBoletoItauRequest,
    PagamentoBoletoItauResponse,
} from '../types/itau.types';
import {
    BankingApiBase,
    BankBalance,
    BankStatement,
    BankTransaction,
    BankUrlConfig,
} from './banking/bankingApiBase';

// ===== Constants =====

const ITAU_URLS = {
    production: {
        auth: 'https://sts.itau.com.br/api/oauth/token',
        api: 'https://secure.api.itau/pix_recebimentos/v2',
        banking: 'https://secure.api.itau/open-banking/v1',
        boleto: 'https://secure.api.itau/boletos/v2',
    },
    sandbox: {
        auth: 'https://sts.sandbox.itau.com.br/api/oauth/token',
        api: 'https://sandbox.devportal.itau.com.br/pix_recebimentos/v2',
        banking: 'https://sandbox.devportal.itau.com.br/open-banking/v1',
        boleto: 'https://sandbox.devportal.itau.com.br/boletos/v2',
    },
};

const SCOPES = {
    banking: 'conta_corrente_saldo conta_corrente_extrato',
    pix: 'cob.read cob.write cobv.read cobv.write pix.read pix.write',
    boleto: 'boleto.read boleto.write',
};

// ===== ItauApiService Class =====

const log = logger.child('ItauApiService');

class ItauApiService extends BankingApiBase {
    // ===== Abstract Method Implementations =====

    protected getBankName(): string {
        return 'Itaú';
    }

    // Credenciais: o store (salvo via UI, cifrado) tem prioridade; .env é fallback. (#45)
    protected getClientId(): string {
        return bankingCredentialsStore.getClientId('itau') || config.itauClientId || '';
    }

    protected getClientSecret(): string {
        return bankingCredentialsStore.getClientSecret('itau') || config.itauClientSecret || '';
    }

    protected getCertPath(): string {
        return config.itauCertPath || './certs/itau.crt';
    }

    protected getKeyPath(): string {
        return config.itauKeyPath || './certs/itau.key';
    }

    protected isSandbox(): boolean {
        const s = bankingCredentialsStore.getSandbox('itau');
        return s !== undefined ? s : (config.itauSandbox || false);
    }

    private getContaCorrente(): string {
        return bankingCredentialsStore.getContaCorrente('itau') || config.itauContaCorrente || '';
    }

    private getAgencia(): string {
        return bankingCredentialsStore.getAgencia('itau') || config.itauAgencia || '';
    }

    protected getUrls(): { production: BankUrlConfig; sandbox: BankUrlConfig } {
        return ITAU_URLS;
    }

    protected getScopes(): string {
        return `${SCOPES.banking} ${SCOPES.pix} ${SCOPES.boleto}`;
    }

    protected mapBalance(response: SaldoItau): BankBalance {
        return {
            available: response.disponivel || 0,
            blocked: response.bloqueado || 0,
            limit: response.limite || 0,
            total: (response.disponivel || 0) + (response.bloqueado || 0),
        };
    }

    protected mapTransaction(raw: TransacaoItau): BankTransaction {
        const amount = typeof raw.valor === 'string' ? parseFloat(raw.valor) : raw.valor;
        return {
            id: raw.codigoTransacao || `${raw.dataLancamento}-${amount}`,
            date: new Date(raw.dataLancamento),
            description: raw.descricao || '',
            amount: Math.abs(amount),
            type: raw.tipoOperacao === 'C' ? 'credit' : 'debit',
            category: raw.tipoTransacao,
            raw,
        };
    }

    // ===== Helper: Get URL for specific API =====

    private getApiUrl(type: 'api' | 'banking' | 'boleto'): string {
        const urls = this.isSandbox() ? ITAU_URLS.sandbox : ITAU_URLS.production;
        return urls[type] || urls.api;
    }

    // ===== Itaú-specific request with custom headers =====

    private async itauRequest<T>(
        method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
        baseUrl: string,
        endpoint: string,
        data?: any,
        params?: any
    ): Promise<T> {
        // Build custom headers for Itaú
        const customHeaders: Record<string, string> = {
            'x-itau-flowID': this.generateFlowId(),
            'x-itau-correlationID': this.generateCorrelationId(),
        };

        // Add account info if available (store > .env, #45)
        const contaCorrente = this.getContaCorrente();
        if (contaCorrente) {
            customHeaders['x-conta-corrente'] = contaCorrente;
        }
        const agencia = this.getAgencia();
        if (agencia) {
            customHeaders['x-agencia'] = agencia;
        }

        // Use full URL since Itaú has multiple base URLs
        const fullEndpoint = `${baseUrl}${endpoint}`;

        // Temporarily override axios baseURL for this request
        if (!this.isReady()) {
            await this.initialize();
        }

        const token = await this.getAccessToken();

        const response = await this['axiosInstance']!.request<T>({
            method,
            url: fullEndpoint,
            data,
            params,
            headers: {
                Authorization: `Bearer ${token}`,
                ...customHeaders,
            },
        });

        return response.data;
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
            openingBalance: 0,
            closingBalance: 0,
            transactions,
        };
    }

    // ===== Banking API (Itaú-specific) =====

    /**
     * Get account balance (Itaú format)
     */
    async getSaldo(): Promise<SaldoItau> {
        log.info('Getting account balance...');
        return this.itauRequest<SaldoItau>('GET', this.getApiUrl('banking'), '/contas/saldo');
    }

    /**
     * Get account statement (Itaú format)
     */
    async getExtrato(dataInicial: string, dataFinal: string): Promise<ExtratoItau> {
        log.info(`Getting statement from ${dataInicial} to ${dataFinal}...`);
        return this.itauRequest<ExtratoItau>('GET', this.getApiUrl('banking'), '/contas/extrato', null, {
            dataInicio: dataInicial,
            dataFim: dataFinal,
        });
    }

    /**
     * Get detailed statement
     */
    async getExtratoCompleto(dataInicial: string, dataFinal: string): Promise<TransacaoItau[]> {
        const extrato = await this.getExtrato(dataInicial, dataFinal);
        return extrato.transacoes || [];
    }

    // ===== PIX Operations =====

    /**
     * Create immediate PIX charge (Cob)
     */
    async criarPixCobranca(dados: PixCobrancaItauRequest, txid?: string): Promise<PixCobrancaItauResponse> {
        log.info('Creating PIX charge...');
        const id = txid || this.generateTxId();
        return this.itauRequest<PixCobrancaItauResponse>('PUT', this.getApiUrl('api'), `/cob/${id}`, dados);
    }

    /**
     * Create PIX charge with due date (CobV)
     */
    async criarPixCobrancaVencimento(txid: string, dados: PixCobrancaVencimentoItauRequest): Promise<PixCobrancaItauResponse> {
        log.info(`Creating PIX charge with due date: ${txid}`);
        return this.itauRequest<PixCobrancaItauResponse>('PUT', this.getApiUrl('api'), `/cobv/${txid}`, dados);
    }

    /**
     * Get PIX charge info
     */
    async consultarPixCobranca(txid: string): Promise<PixCobrancaItauResponse> {
        log.info(`Consulting PIX charge: ${txid}`);
        return this.itauRequest<PixCobrancaItauResponse>('GET', this.getApiUrl('api'), `/cob/${txid}`);
    }

    /**
     * Get QR Code for PIX charge
     */
    async getPixQRCode(locationId: number): Promise<PixQRCodeItauResponse> {
        log.info(`Getting PIX QR Code for location: ${locationId}`);
        return this.itauRequest<PixQRCodeItauResponse>('GET', this.getApiUrl('api'), `/loc/${locationId}/qrcode`);
    }

    /**
     * Send PIX payment
     */
    async enviarPix(dados: PixPagamentoItauRequest): Promise<PixPagamentoItauResponse> {
        log.info('Sending PIX payment...');
        return this.itauRequest<PixPagamentoItauResponse>('POST', this.getApiUrl('api'), '/pix', dados);
    }

    /**
     * List received PIX
     */
    async listarPixRecebidos(inicio: string, fim: string): Promise<PixRecebidoItau[]> {
        log.info(`Listing received PIX from ${inicio} to ${fim}...`);
        const response = await this.itauRequest<{ pix: PixRecebidoItau[] }>('GET', this.getApiUrl('api'), '/pix', null, {
            inicio,
            fim,
        });
        return response.pix || [];
    }

    /**
     * Get PIX by endToEndId
     */
    async consultarPix(endToEndId: string): Promise<PixRecebidoItau> {
        log.info(`Consulting PIX: ${endToEndId}`);
        return this.itauRequest<PixRecebidoItau>('GET', this.getApiUrl('api'), `/pix/${endToEndId}`);
    }

    // ===== Boleto Operations =====

    /**
     * Issue a new boleto
     */
    async emitirBoleto(dados: BoletoItauRequest): Promise<BoletoItauResponse> {
        log.info('Issuing boleto...');
        return this.itauRequest<BoletoItauResponse>('POST', this.getApiUrl('boleto'), '/boletos', dados);
    }

    /**
     * Get boleto info by nossoNumero
     */
    async consultarBoleto(nossoNumero: string): Promise<BoletoConsultaItauResponse> {
        log.info(`Consulting boleto: ${nossoNumero}`);
        return this.itauRequest<BoletoConsultaItauResponse>('GET', this.getApiUrl('boleto'), `/boletos/${nossoNumero}`);
    }

    /**
     * List boletos with filters
     */
    async listarBoletos(params: {
        dataInicial?: string;
        dataFinal?: string;
        situacao?: 'em_aberto' | 'baixado' | 'liquidado';
        pagina?: number;
        tamanhoPagina?: number;
    }): Promise<BoletoListaItauResponse> {
        log.info('Listing boletos...');
        return this.itauRequest<BoletoListaItauResponse>('GET', this.getApiUrl('boleto'), '/boletos', null, {
            data_inicial: params.dataInicial,
            data_final: params.dataFinal,
            situacao: params.situacao,
            pagina: params.pagina || 0,
            tamanho_pagina: params.tamanhoPagina || 20,
        });
    }

    /**
     * Cancel/baixa a boleto
     */
    async baixarBoleto(nossoNumero: string, motivoBaixa: string = 'ACERTOS'): Promise<void> {
        log.info(`Cancelling boleto: ${nossoNumero}`);
        await this.itauRequest<void>('PATCH', this.getApiUrl('boleto'), `/boletos/${nossoNumero}/baixa`, {
            motivo_baixa: motivoBaixa,
        });
    }

    /**
     * Download boleto PDF
     */
    async downloadBoletoPDF(nossoNumero: string): Promise<Buffer> {
        log.info(`Downloading boleto PDF: ${nossoNumero}`);

        if (!this.isReady()) {
            await this.initialize();
        }

        const token = await this.getAccessToken();
        const baseUrl = this.getApiUrl('boleto');

        const response = await this['axiosInstance']!.request({
            method: 'GET',
            url: `${baseUrl}/boletos/${nossoNumero}/pdf`,
            headers: {
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/pdf',
            },
            responseType: 'arraybuffer',
        });

        return Buffer.from(response.data);
    }

    // ===== Payment Operations =====

    /**
     * Pay a boleto
     */
    async pagarBoleto(dados: PagamentoBoletoItauRequest): Promise<PagamentoBoletoItauResponse> {
        log.info('Paying boleto...');
        return this.itauRequest<PagamentoBoletoItauResponse>('POST', this.getApiUrl('banking'), '/pagamentos/boletos', {
            codigo_barras_linha_digitavel: dados.codigo_barras_linha_digitavel,
            valor_pagamento: dados.valor_pagamento,
            data_pagamento: dados.data_pagamento,
            descricao: dados.descricao,
        });
    }

    /**
     * Get payment receipt PDF
     */
    async getComprovantePagamento(idTransacao: string): Promise<Buffer> {
        log.info(`Getting payment receipt: ${idTransacao}`);

        if (!this.isReady()) {
            await this.initialize();
        }

        const token = await this.getAccessToken();
        const baseUrl = this.getApiUrl('banking');

        const response = await this['axiosInstance']!.request({
            method: 'GET',
            url: `${baseUrl}/pagamentos/${idTransacao}/comprovante`,
            headers: {
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/pdf',
            },
            responseType: 'arraybuffer',
        });

        return Buffer.from(response.data);
    }

    // ===== Webhook Operations =====

    /**
     * Configure PIX webhook
     */
    async configurarWebhookPix(chave: string, webhookUrl: string): Promise<void> {
        log.info(`Configuring PIX webhook for key: ${chave}`);
        await this.itauRequest<void>('PUT', this.getApiUrl('api'), `/webhook/${chave}`, { webhookUrl });
    }

    /**
     * Get PIX webhook configuration
     */
    async consultarWebhookPix(chave: string): Promise<{ webhookUrl: string }> {
        log.info(`Getting PIX webhook config for key: ${chave}`);
        return this.itauRequest<{ webhookUrl: string }>('GET', this.getApiUrl('api'), `/webhook/${chave}`);
    }

    /**
     * Delete PIX webhook
     */
    async deletarWebhookPix(chave: string): Promise<void> {
        log.info(`Deleting PIX webhook for key: ${chave}`);
        await this.itauRequest<void>('DELETE', this.getApiUrl('api'), `/webhook/${chave}`);
    }

    // ===== Utility Methods =====

    /**
     * Generate flow ID for request tracing
     */
    private generateFlowId(): string {
        return `flow-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    }

    /**
     * Generate correlation ID for request tracing
     */
    private generateCorrelationId(): string {
        return `corr-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    }
}

// Export singleton instance
export const itauApiService = new ItauApiService();
