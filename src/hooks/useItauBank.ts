/**
 * useItauBank Hook
 * 
 * React hook for Banco Itaú API operations
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';

// ===== Types =====

export interface ItauStatus {
    initialized: boolean;
    hasCredentials: boolean;
    hasCertificates: boolean;
    environment: 'sandbox' | 'production';
    tokenValid: boolean;
    lastTokenRefresh?: string;
}

export interface SaldoItau {
    disponivel: number;
    bloqueado: number;
    limite: number;
}

export interface TransacaoItau {
    dataMovimento: string;
    tipoOperacao: 'C' | 'D';
    tipoTransacao: string;
    descricao: string;
    valor: number;
}

export interface PixRecebidoItau {
    endToEndId: string;
    txid?: string;
    valor: string;
    horario: string;
    pagador?: {
        nome: string;
        cpf?: string;
        cnpj?: string;
    };
}

export interface BoletoItau {
    numero_nosso_numero: string;
    texto_seu_numero: string;
    codigo_barras: string;
    numero_linha_digitavel: string;
    data_vencimento: string;
    valor_titulo: number;
    situacao_geral_boleto: string;
    data_pagamento?: string;
    valor_pago?: number;
}

export interface PixCobrancaItauRequest {
    valor: { original: string };
    chave: string;
    solicitacaoPagador?: string;
}

export interface BoletoItauRequest {
    etapa_processo_boleto: 'efetivacao' | 'simulacao';
    dado_boleto: {
        descricao_instrumento_cobranca: 'boleto' | 'boleto_pix';
        tipo_boleto: 'a_vista';
        codigo_carteira: string;
        valor_total_titulo: number;
        data_emissao: string;
        data_vencimento: string;
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
            valor_titulo: number;
            data_vencimento: string;
        }>;
    };
}

// ===== API Functions =====

const api = {
    // Status
    getStatus: async (): Promise<ItauStatus> => {
        const response = await axios.get('/api/itau/status');
        return response.data;
    },

    testConnection: async (): Promise<{ success: boolean; saldo?: SaldoItau; error?: string }> => {
        const response = await axios.post('/api/itau/test');
        return response.data;
    },

    uploadCertificates: async (files: File[]): Promise<{ success: boolean; uploaded: string[] }> => {
        const formData = new FormData();
        files.forEach(file => formData.append('files', file));
        const response = await axios.post('/api/itau/certificates', formData, {
            headers: { 'Content-Type': 'multipart/form-data' },
        });
        return response.data;
    },

    // Banking
    getSaldo: async (): Promise<SaldoItau> => {
        const response = await axios.get('/api/itau/saldo');
        return response.data;
    },

    getExtrato: async (dataInicio: string, dataFim: string): Promise<{ transacoes: TransacaoItau[] }> => {
        const response = await axios.get('/api/itau/extrato', {
            params: { dataInicio, dataFim },
        });
        return response.data;
    },

    // PIX
    criarPixCobranca: async (dados: PixCobrancaItauRequest): Promise<any> => {
        const response = await axios.post('/api/itau/pix/cobranca', dados);
        return response.data;
    },

    getPixRecebidos: async (inicio: string, fim: string): Promise<{ pix: PixRecebidoItau[] }> => {
        const response = await axios.get('/api/itau/pix/recebidos', {
            params: { inicio, fim },
        });
        return response.data;
    },

    // Boletos
    emitirBoleto: async (dados: BoletoItauRequest): Promise<any> => {
        const response = await axios.post('/api/itau/boleto', dados);
        return response.data;
    },

    listarBoletos: async (params: {
        dataInicial?: string;
        dataFinal?: string;
        situacao?: string;
    }): Promise<{ data: BoletoItau[]; paginacao: any }> => {
        const response = await axios.get('/api/itau/boleto', { params });
        return response.data;
    },

    consultarBoleto: async (nossoNumero: string): Promise<BoletoItau> => {
        const response = await axios.get(`/api/itau/boleto/${nossoNumero}`);
        return response.data;
    },

    downloadBoletoPdf: async (nossoNumero: string): Promise<Blob> => {
        const response = await axios.get(`/api/itau/boleto/${nossoNumero}/pdf`, {
            responseType: 'blob',
        });
        return response.data;
    },

    baixarBoleto: async (nossoNumero: string, motivo?: string): Promise<void> => {
        await axios.post(`/api/itau/boleto/${nossoNumero}/baixar`, { motivo });
    },
};

// ===== Hook =====

export function useItauBank() {
    const queryClient = useQueryClient();

    // Status query
    const statusQuery = useQuery({
        queryKey: ['itau', 'status'],
        queryFn: api.getStatus,
        staleTime: 30000,
    });

    // Saldo query
    const saldoQuery = useQuery({
        queryKey: ['itau', 'saldo'],
        queryFn: api.getSaldo,
        enabled: statusQuery.data?.initialized === true,
        staleTime: 60000,
    });

    // Test connection mutation
    const testConnectionMutation = useMutation({
        mutationFn: api.testConnection,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['itau'] });
        },
    });

    // Upload certificates mutation
    const uploadCertificatesMutation = useMutation({
        mutationFn: api.uploadCertificates,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['itau', 'status'] });
        },
    });

    // Create PIX mutation
    const criarPixMutation = useMutation({
        mutationFn: api.criarPixCobranca,
    });

    // Emit boleto mutation
    const emitirBoletoMutation = useMutation({
        mutationFn: api.emitirBoleto,
    });

    // Baixar boleto mutation
    const baixarBoletoMutation = useMutation({
        mutationFn: ({ nossoNumero, motivo }: { nossoNumero: string; motivo?: string }) =>
            api.baixarBoleto(nossoNumero, motivo),
    });

    // Extrato query factory
    const useExtrato = (dataInicio: string, dataFim: string) => {
        return useQuery({
            queryKey: ['itau', 'extrato', dataInicio, dataFim],
            queryFn: () => api.getExtrato(dataInicio, dataFim),
            enabled: statusQuery.data?.initialized === true && !!dataInicio && !!dataFim,
        });
    };

    // PIX recebidos query factory
    const usePixRecebidos = (inicio: string, fim: string) => {
        return useQuery({
            queryKey: ['itau', 'pix', 'recebidos', inicio, fim],
            queryFn: () => api.getPixRecebidos(inicio, fim),
            enabled: statusQuery.data?.initialized === true && !!inicio && !!fim,
        });
    };

    // Boletos query factory
    const useBoletos = (params: { dataInicial?: string; dataFinal?: string; situacao?: string }) => {
        return useQuery({
            queryKey: ['itau', 'boletos', params],
            queryFn: () => api.listarBoletos(params),
            enabled: statusQuery.data?.initialized === true,
        });
    };

    return {
        // Status
        status: statusQuery.data,
        statusLoading: statusQuery.isLoading,
        refetchStatus: statusQuery.refetch,
        isInitialized: statusQuery.data?.initialized === true,

        // Saldo
        saldo: saldoQuery.data,
        saldoLoading: saldoQuery.isLoading,
        refetchSaldo: saldoQuery.refetch,

        // Actions
        testConnection: testConnectionMutation.mutateAsync,
        testConnectionLoading: testConnectionMutation.isPending,

        uploadCertificates: uploadCertificatesMutation.mutateAsync,
        uploadCertificatesLoading: uploadCertificatesMutation.isPending,

        criarPixCobranca: criarPixMutation.mutateAsync,
        criarPixLoading: criarPixMutation.isPending,

        emitirBoleto: emitirBoletoMutation.mutateAsync,
        emitirBoletoLoading: emitirBoletoMutation.isPending,

        baixarBoleto: baixarBoletoMutation.mutateAsync,
        baixarBoletoLoading: baixarBoletoMutation.isPending,

        // Query factories
        useExtrato,
        usePixRecebidos,
        useBoletos,

        // API direct access
        api,
    };
}
