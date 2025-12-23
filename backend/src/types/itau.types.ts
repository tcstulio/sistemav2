/**
 * Banco Itaú API Types
 * 
 * TypeScript interfaces for Itaú API integration
 */

// ===== Authentication =====

export interface ItauTokenResponse {
    access_token: string;
    token_type: string;
    expires_in: number;
    scope: string;
}

// ===== Banking - Saldo =====

export interface SaldoItau {
    disponivel: number;
    bloqueado: number;
    limite: number;
    dataHoraSaldo: string;
}

// ===== Banking - Extrato =====

export interface TransacaoItau {
    dataMovimento: string;
    dataLancamento: string;
    tipoOperacao: 'C' | 'D'; // Crédito ou Débito
    tipoTransacao: string;
    codigoTransacao: string;
    descricao: string;
    valor: number;
    saldoParcial?: number;
    numeroDocumento?: string;
    complemento?: string;
}

export interface ExtratoItau {
    agencia: string;
    conta: string;
    dataInicio: string;
    dataFim: string;
    saldoInicial: number;
    saldoFinal: number;
    transacoes: TransacaoItau[];
}

// ===== PIX - Cobrança Imediata (Cob) =====

export interface PixCobrancaItauRequest {
    calendario?: {
        expiracao?: number; // segundos, default 3600 (1h)
    };
    devedor?: {
        cpf?: string;
        cnpj?: string;
        nome: string;
    };
    valor: {
        original: string; // "100.00"
        modalidadeAlteracao?: number; // 0 = não permite, 1 = permite
    };
    chave: string; // Chave PIX do recebedor
    solicitacaoPagador?: string;
    infoAdicionais?: Array<{
        nome: string;
        valor: string;
    }>;
}

export interface PixCobrancaItauResponse {
    calendario: {
        criacao: string;
        expiracao: number;
    };
    txid: string;
    revisao: number;
    loc: {
        id: number;
        location: string;
        tipoCob: string;
    };
    location: string;
    status: 'ATIVA' | 'CONCLUIDA' | 'REMOVIDA_PELO_USUARIO_RECEBEDOR' | 'REMOVIDA_PELO_PSP';
    devedor?: {
        cpf?: string;
        cnpj?: string;
        nome: string;
    };
    valor: {
        original: string;
    };
    chave: string;
    solicitacaoPagador?: string;
    pixCopiaECola?: string;
    pix?: PixRecebidoItau[];
}

// ===== PIX - Cobrança com Vencimento (CobV) =====

export interface PixCobrancaVencimentoItauRequest extends Omit<PixCobrancaItauRequest, 'calendario' | 'valor'> {
    calendario: {
        dataDeVencimento: string; // YYYY-MM-DD
        validadeAposVencimento?: number; // dias
    };
    valor: {
        original: string;
        multa?: {
            modalidade: 1 | 2; // 1 = valor fixo, 2 = percentual
            valorPerc: string;
        };
        juros?: {
            modalidade: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
            valorPerc: string;
        };
        desconto?: {
            modalidade: 1 | 2 | 3 | 4 | 5 | 6;
            descontoDataFixa?: Array<{
                data: string;
                valorPerc: string;
            }>;
        };
    };
}

// ===== PIX - Recebido =====

export interface PixRecebidoItau {
    endToEndId: string;
    txid?: string;
    valor: string;
    componentesValor?: {
        original: {
            valor: string;
        };
    };
    chave: string;
    horario: string;
    infoPagador?: string;
    pagador?: {
        cpf?: string;
        cnpj?: string;
        nome: string;
    };
}

// ===== PIX - Pagamento =====

export interface PixPagamentoItauRequest {
    valor: number;
    pagamento: {
        tipo: 'PIX_MANUAL' | 'PIX_QRCODE' | 'PIX_COPIA_COLA';
        chave?: string; // para PIX_MANUAL
        qrCode?: string; // para PIX_QRCODE
        pixCopiaECola?: string; // para PIX_COPIA_COLA
    };
    descricao?: string;
    dataAgendamento?: string; // YYYY-MM-DD para agendamento
}

export interface PixPagamentoItauResponse {
    idTransacao: string;
    endToEndId: string;
    status: 'PROCESSANDO' | 'EFETIVADO' | 'NAO_EFETIVADO';
    valor: number;
    dataHoraOperacao: string;
}

// ===== PIX - QR Code =====

export interface PixQRCodeItauResponse {
    qrcode: string; // Base64 da imagem
    imagemQrcode: string;
    linkVisualizacao?: string;
}

// ===== Boleto - Emissão =====

export interface BoletoItauRequest {
    etapa_processo_boleto: 'efetivacao' | 'simulacao';
    beneficiario?: {
        id_beneficiario: string;
    };
    dado_boleto: {
        descricao_instrumento_cobranca: 'boleto' | 'boleto_pix';
        tipo_boleto: 'a_vista';
        codigo_carteira: string; // "109" para cobrança simples
        valor_total_titulo: number;
        codigo_especie: string; // "01" = duplicata mercantil
        data_emissao: string; // YYYY-MM-DD
        data_vencimento: string;
        data_limite_pagamento?: string;
        pagador: {
            pessoa: {
                nome_pessoa: string;
                tipo_pessoa: 'fisica' | 'juridica';
                cpf?: string;
                cnpj?: string;
            };
            endereco: {
                nome_logradouro: string;
                nome_bairro: string;
                nome_cidade: string;
                sigla_UF: string;
                numero_CEP: string;
            };
        };
        dados_individuais_boleto: Array<{
            numero_nosso_numero?: string;
            texto_seu_numero?: string;
            valor_titulo: number;
            data_vencimento: string;
            texto_uso_beneficiario?: string;
        }>;
        instrucao_cobranca?: {
            codigo_instrucao_cobranca: string;
            quantidade_dias_apos_vencimento?: number;
            valor_instrucao_cobranca?: number;
            percentual_instrucao_cobranca?: number;
        };
        juros?: {
            codigo_tipo_juros: '1' | '2' | '3'; // 1=valor/dia, 2=taxa mensal, 3=isento
            valor_juros?: number;
            percentual_juros?: number;
        };
        multa?: {
            codigo_tipo_multa: '1' | '2' | '3'; // 1=valor fixo, 2=percentual, 3=isento
            valor_multa?: number;
            percentual_multa?: number;
            quantidade_dias_multa?: number;
        };
    };
}

export interface BoletoItauResponse {
    codigo_canal_operacao: string;
    dado_boleto: {
        dados_individuais_boleto: Array<{
            numero_nosso_numero: string;
            texto_seu_numero: string;
            codigo_barras: string;
            numero_linha_digitavel: string;
            data_vencimento: string;
            valor_titulo: number;
            url_boleto?: string;
            dado_qrcode?: {
                emv: string;
                base64?: string;
                txid?: string;
            };
        }>;
    };
}

export interface BoletoConsultaItauResponse {
    numero_nosso_numero: string;
    texto_seu_numero: string;
    codigo_barras: string;
    numero_linha_digitavel: string;
    data_vencimento: string;
    valor_titulo: number;
    situacao_geral_boleto: 'em_aberto' | 'baixado' | 'liquidado' | 'em_cartorio' | 'protestado';
    data_pagamento?: string;
    valor_pago?: number;
    pagador: {
        nome_pessoa: string;
        cpf?: string;
        cnpj?: string;
    };
}

export interface BoletoListaItauResponse {
    data: BoletoConsultaItauResponse[];
    paginacao: {
        pagina_atual: number;
        total_paginas: number;
        total_elementos: number;
        elementos_por_pagina: number;
    };
}

// ===== Pagamento de Boleto =====

export interface PagamentoBoletoItauRequest {
    codigo_barras_linha_digitavel: string;
    valor_pagamento: number;
    data_pagamento: string; // YYYY-MM-DD
    descricao?: string;
}

export interface PagamentoBoletoItauResponse {
    id_transacao: string;
    status: 'PROCESSANDO' | 'AGENDADO' | 'EFETIVADO' | 'NAO_EFETIVADO';
    codigo_autenticacao?: string;
    data_hora_operacao: string;
}

// ===== Webhooks =====

export interface PixWebhookItauPayload {
    pix: PixRecebidoItau[];
}

export interface BoletoWebhookItauPayload {
    evento: 'LIQUIDACAO' | 'BAIXA' | 'ALTERACAO';
    nossoNumero: string;
    seuNumero?: string;
    valor?: number;
    dataPagamento?: string;
    dataOcorrencia: string;
}

// ===== Service Status =====

export interface ItauServiceStatus {
    initialized: boolean;
    hasCredentials: boolean;
    hasCertificates: boolean;
    environment: 'sandbox' | 'production';
    tokenValid: boolean;
    lastTokenRefresh?: string;
}
