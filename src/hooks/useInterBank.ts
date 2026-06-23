/**
 * useInterBank Hook
 * 
 * React hook for interacting with Banco Inter API
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';

// Use relative path for Vite proxy (avoids Mixed Content issues on HTTPS)
const API_BASE = '/api/inter';

// ===== Types =====

export interface SaldoInter {
    disponivel: number;
    bloqueadoCheque: number;
    bloqueadoJudicial: number;
    limite: number;
}

export interface TransacaoVinculo {
    projeto?: string;
    cliente?: string;
    finalidade: string;
}

export interface TransacaoInter {
    dataEntrada: string;
    dataMovimento: string;
    tipoTransacao: string;
    tipoOperacao: 'C' | 'D';
    valor: number;
    titulo: string;
    descricao: string;
    idTransacao?: string;
    vinculo?: TransacaoVinculo;
}

export interface InterStatus {
    initialized: boolean;
    hasCredentials: boolean;
    hasCertificates: boolean;
    environment: 'sandbox' | 'production';
    tokenValid: boolean;
}

export interface PixCobranca {
    txid: string;
    status: string;
    valor: { original: string };
    chave: string;
    pixCopiaECola: string;
    qrcode?: string;
    loc?: { id: number };
}

export interface BoletoResponse {
    seuNumero: string;
    nossoNumero: string;
    codigoBarras: string;
    linhaDigitavel: string;
    dataVencimento: string;
    valorNominal: number;
    situacao?: string;
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
}

// ===== API Functions =====

const api = {
    // Status
    getStatus: async (): Promise<InterStatus> => {
        const { data } = await axios.get(`${API_BASE}/status`);
        return data;
    },

    testConnection: async (): Promise<{ success: boolean; error?: string; saldo?: SaldoInter }> => {
        const { data } = await axios.post(`${API_BASE}/test`);
        return data;
    },

    uploadCertificates: async (files: File[]): Promise<{ success: boolean; uploaded: string[] }> => {
        const formData = new FormData();
        files.forEach(file => formData.append('files', file));
        const { data } = await axios.post(`${API_BASE}/certificates`, formData, {
            headers: { 'Content-Type': 'multipart/form-data' },
        });
        return data;
    },

    // Banking
    getSaldo: async (): Promise<SaldoInter> => {
        const { data } = await axios.get(`${API_BASE}/saldo`);
        return data;
    },

    getExtrato: async (dataInicio: string, dataFim: string): Promise<{ transacoes: TransacaoInter[] }> => {
        const { data } = await axios.get(`${API_BASE}/extrato`, { params: { dataInicio, dataFim } });
        return data;
    },

    pagarBoleto: async (params: { codBarraLinhaDigitavel: string; valorPagar: number }) => {
        const { data } = await axios.post(`${API_BASE}/pagamento/boleto`, params);
        return data;
    },

    // Pix
    criarPixCobranca: async (params: {
        valor: { original: string };
        chave: string;
        solicitacaoPagador?: string;
        devedor?: { cpf?: string; cnpj?: string; nome: string };
    }): Promise<PixCobranca> => {
        const { data } = await axios.post(`${API_BASE}/pix/cobranca`, params);
        return data;
    },

    consultarPixCobranca: async (txid: string): Promise<PixCobranca> => {
        const { data } = await axios.get(`${API_BASE}/pix/cobranca/${txid}`);
        return data;
    },

    listarPixRecebidos: async (inicio: string, fim: string): Promise<{ pix: PixRecebido[] }> => {
        const { data } = await axios.get(`${API_BASE}/pix/recebidos`, { params: { inicio, fim } });
        return data;
    },

    enviarPix: async (params: {
        valor: string;
        destinatario: {
            tipo: 'CHAVE' | 'DADOS_BANCARIOS';
            chave?: string;
        };
        descricao?: string;
    }) => {
        const { data } = await axios.post(`${API_BASE}/pix/enviar`, params);
        return data;
    },

    // Boletos
    emitirBoleto: async (params: {
        seuNumero: string;
        valorNominal: number;
        dataVencimento: string;
        pagador: {
            cpfCnpj: string;
            tipoPessoa: 'FISICA' | 'JURIDICA';
            nome: string;
            endereco: string;
            bairro: string;
            cidade: string;
            uf: string;
            cep: string;
        };
    }): Promise<BoletoResponse> => {
        const { data } = await axios.post(`${API_BASE}/boleto`, params);
        return data;
    },

    listarBoletos: async (params?: {
        dataInicial?: string;
        dataFinal?: string;
        situacao?: string;
    }) => {
        const { data } = await axios.get(`${API_BASE}/boleto`, { params });
        return data;
    },

    consultarBoleto: async (nossoNumero: string): Promise<BoletoResponse> => {
        const { data } = await axios.get(`${API_BASE}/boleto/${nossoNumero}`);
        return data;
    },

    downloadBoletoPdf: async (nossoNumero: string) => {
        const response = await axios.get(`${API_BASE}/boleto/${nossoNumero}/pdf`, {
            responseType: 'blob',
        });
        return response.data;
    },

    cancelarBoleto: async (nossoNumero: string, motivo: string) => {
        const { data } = await axios.post(`${API_BASE}/boleto/${nossoNumero}/cancelar`, { motivo });
        return data;
    },

    // Utils
    generateTxId: async (): Promise<{ txid: string }> => {
        const { data } = await axios.get(`${API_BASE}/txid/generate`);
        return data;
    },
};

// ===== Hook =====

export function useInterBank() {
    const queryClient = useQueryClient();

    // Status Query
    const statusQuery = useQuery({
        queryKey: ['inter', 'status'],
        queryFn: api.getStatus,
        staleTime: 60000,
        refetchInterval: 60000,
    });

    // Saldo Query
    const saldoQuery = useQuery({
        queryKey: ['inter', 'saldo'],
        queryFn: api.getSaldo,
        enabled: statusQuery.data?.initialized === true,
        staleTime: 30000,
        refetchInterval: 30000,
    });

    // Mutations
    const testConnectionMutation = useMutation({
        mutationFn: api.testConnection,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['inter'] });
        },
    });

    const uploadCertificatesMutation = useMutation({
        mutationFn: api.uploadCertificates,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['inter', 'status'] });
        },
    });

    const criarPixCobrancaMutation = useMutation({
        mutationFn: api.criarPixCobranca,
    });

    const enviarPixMutation = useMutation({
        mutationFn: api.enviarPix,
    });

    const emitirBoletoMutation = useMutation({
        mutationFn: api.emitirBoleto,
    });

    const pagarBoletoMutation = useMutation({
        mutationFn: api.pagarBoleto,
    });

    const cancelarBoletoMutation = useMutation({
        mutationFn: ({ nossoNumero, motivo }: { nossoNumero: string; motivo: string }) =>
            api.cancelarBoleto(nossoNumero, motivo),
    });

    // Custom query functions
    const useExtrato = (dataInicio: string, dataFim: string) => {
        return useQuery({
            queryKey: ['inter', 'extrato', dataInicio, dataFim],
            queryFn: () => api.getExtrato(dataInicio, dataFim),
            enabled: !!dataInicio && !!dataFim && statusQuery.data?.initialized === true,
        });
    };

    const usePixRecebidos = (inicio: string, fim: string) => {
        return useQuery({
            queryKey: ['inter', 'pix', 'recebidos', inicio, fim],
            queryFn: () => api.listarPixRecebidos(inicio, fim),
            enabled: !!inicio && !!fim && statusQuery.data?.initialized === true,
        });
    };

    const useBoletos = (params?: { dataInicial?: string; dataFinal?: string; situacao?: string }) => {
        return useQuery({
            queryKey: ['inter', 'boletos', params],
            queryFn: () => api.listarBoletos(params),
            enabled: statusQuery.data?.initialized === true,
        });
    };

    return {
        // Status
        status: statusQuery.data,
        statusLoading: statusQuery.isLoading,
        isInitialized: statusQuery.data?.initialized ?? false,

        // Saldo
        saldo: saldoQuery.data,
        saldoLoading: saldoQuery.isLoading,
        refetchSaldo: saldoQuery.refetch,

        // Actions
        testConnection: testConnectionMutation.mutateAsync,
        testConnectionLoading: testConnectionMutation.isPending,

        uploadCertificates: uploadCertificatesMutation.mutateAsync,
        uploadCertificatesLoading: uploadCertificatesMutation.isPending,

        criarPixCobranca: criarPixCobrancaMutation.mutateAsync,
        criarPixLoading: criarPixCobrancaMutation.isPending,

        enviarPix: enviarPixMutation.mutateAsync,
        enviarPixLoading: enviarPixMutation.isPending,

        emitirBoleto: emitirBoletoMutation.mutateAsync,
        emitirBoletoLoading: emitirBoletoMutation.isPending,

        pagarBoleto: pagarBoletoMutation.mutateAsync,
        pagarBoletoLoading: pagarBoletoMutation.isPending,

        cancelarBoleto: cancelarBoletoMutation.mutateAsync,

        // Query hooks
        useExtrato,
        usePixRecebidos,
        useBoletos,

        // API direct access
        api,
    };
}

export default useInterBank;
