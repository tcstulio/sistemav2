// Types for Banco Inter API integration

// ===== Authentication =====

export interface InterTokenResponse {
    access_token: string;
    token_type: string;
    expires_in: number;
    scope: string;
}

// ===== Banking API =====

export interface SaldoInter {
    disponivel: number;
    bloqueadoCheque: number;
    bloqueadoJudicial: number;
    limite: number;
}

export interface TransacaoInter {
    dataEntrada: string;
    dataMovimento: string;
    tipoTransacao: string;
    tipoOperacao: 'C' | 'D'; // Crédito ou Débito
    valor: number;
    titulo: string;
    descricao: string;
    idTransacao?: string;
}

export interface ExtratoInter {
    transacoes: TransacaoInter[];
}

export interface PagamentoBoletoRequest {
    codBarraLinhaDigitavel: string;
    valorPagar: number;
    dataPagamento?: string; // YYYY-MM-DD, se agendado
    dataVencimento?: string;
}

export interface PagamentoBoletoResponse {
    codigoTransacao: string;
    dataAgendamento?: string;
    dataPagamento?: string;
    valorPago: number;
    statusPagamento: string;
}

// ===== Pix API =====

export interface PixChave {
    tipo: 'CPF' | 'CNPJ' | 'EMAIL' | 'TELEFONE' | 'CHAVE_ALEATORIA';
    chave: string;
}

export interface PixCobrancaRequest {
    calendario?: {
        expiracao?: number; // segundos
        dataDeVencimento?: string;
        validadeAposVencimento?: number;
    };
    devedor?: {
        cpf?: string;
        cnpj?: string;
        nome: string;
    };
    valor: {
        original: string;
        modalidadeAlteracao?: number;
    };
    chave: string;
    solicitacaoPagador?: string;
    infoAdicionais?: Array<{ nome: string; valor: string }>;
}

export interface PixCobrancaResponse {
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
    pixCopiaECola: string;
}

export interface PixQRCodeResponse {
    qrcode: string; // Base64 image
    imagemQrcode?: string;
}

export interface PixPagamentoRequest {
    valor: string;
    destinatario: {
        tipo: 'CHAVE' | 'DADOS_BANCARIOS';
        chave?: string;
        contaCorrente?: {
            banco: string;
            agencia: string;
            conta: string;
            tipoConta: 'CACC' | 'SLRY' | 'SVGS';
        };
        pessoa?: {
            cpf?: string;
            cnpj?: string;
            nome: string;
        };
    };
    descricao?: string;
}

export interface PixPagamentoResponse {
    endToEndId: string;
    dataCriacao: string;
    status: string;
    valor: string;
}

export interface PixRecebido {
    endToEndId: string;
    txid?: string;
    valor: string;
    horario: string;
    pagador: {
        cpf?: string;
        cnpj?: string;
        nome: string;
    };
    infoPagador?: string;
}

export interface PixListaRecebidosResponse {
    parametros: {
        inicio: string;
        fim: string;
    };
    pix: PixRecebido[];
}

// ===== Cobrança (Boletos) API =====

export interface BoletoEmissaoRequest {
    seuNumero: string;
    valorNominal: number;
    valorAbatimento?: number;
    dataVencimento: string; // YYYY-MM-DD
    numDiasAgenda?: number;
    pagador: {
        cpfCnpj: string;
        tipoPessoa: 'FISICA' | 'JURIDICA';
        nome: string;
        endereco: string;
        numero?: string;
        complemento?: string;
        bairro: string;
        cidade: string;
        uf: string;
        cep: string;
        email?: string;
        ddd?: string;
        telefone?: string;
    };
    multa?: {
        codigo: 'NAOTEMMULTA' | 'VALORFIXO' | 'PERCENTUAL';
        data?: string;
        taxa?: number;
        valor?: number;
    };
    mora?: {
        codigo: 'ISENTO' | 'VALORDIA' | 'TAXAMENSAL';
        data?: string;
        taxa?: number;
        valor?: number;
    };
    desconto1?: {
        codigo: 'NAOTEMDESCONTO' | 'VALORFIXODATAINFORMADA' | 'PERCENTUALDATAINFORMADA';
        data?: string;
        taxa?: number;
        valor?: number;
    };
    mensagem?: {
        linha1?: string;
        linha2?: string;
        linha3?: string;
        linha4?: string;
        linha5?: string;
    };
}

export interface BoletoResponse {
    seuNumero: string;
    nossoNumero: string;
    codigoBarras: string;
    linhaDigitavel: string;
    dataCriacao?: string;
    dataVencimento: string;
    valorNominal: number;
    situacao?: 'EMABERTO' | 'PAGO' | 'CANCELADO' | 'EXPIRADO' | 'BAIXADO';
}

export interface BoletoConsultaResponse extends BoletoResponse {
    pagador: {
        cpfCnpj: string;
        nome: string;
    };
    valorPago?: number;
    dataPagamento?: string;
}

export interface BoletoListaResponse {
    totalPages: number;
    totalElements: number;
    last: boolean;
    first: boolean;
    numberOfElements: number;
    content: BoletoConsultaResponse[];
}

// ===== Webhooks =====

export interface InterWebhookPayload {
    tipo: 'PIX' | 'BOLETO' | 'PAGAMENTO';
    evento: string;
    dataHora: string;
    dados: any;
}

export interface PixWebhookPayload {
    pix: Array<{
        endToEndId: string;
        txid?: string;
        valor: string;
        horario: string;
        pagador: {
            cpf?: string;
            cnpj?: string;
            nome: string;
        };
    }>;
}

export interface BoletoWebhookPayload {
    nossoNumero: string;
    seuNumero: string;
    situacao: string;
    valorPago?: number;
    dataPagamento?: string;
}

// ===== API Error =====

export interface InterApiError {
    title: string;
    detail: string;
    timestamp: string;
    violacoes?: Array<{
        razao: string;
        propriedade: string;
        valor?: string;
    }>;
}

// ===== Service Config =====

export interface InterConfig {
    clientId: string;
    clientSecret: string;
    certPath: string;
    keyPath: string;
    sandbox: boolean;
    webhookSecret?: string;
}
