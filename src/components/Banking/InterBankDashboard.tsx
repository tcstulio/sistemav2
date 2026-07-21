/**
 * Inter Bank Dashboard
 * 
 * Main dashboard for Banco Inter operations
 */

import React, { useState, useMemo, useEffect } from 'react';
import { toast } from 'sonner';
import {
    Landmark,
    TrendingUp,
    TrendingDown,
    RefreshCcw,
    QrCode,
    FileText,
    Download,
    Settings,
    Loader2,
    AlertCircle,
    X,
    Plus,
    ArrowUpRight,
    CreditCard
} from 'lucide-react';
import { useInterBank, TransacaoInter, PixRecebido, BoletoResponse } from '../../hooks/useInterBank';
import { io } from 'socket.io-client';
import { formatDateOnly, formatDateTime } from '../../utils/dateUtils';
import { formatCurrency } from '../../utils/formatUtils';
import { logger } from '../../utils/logger';
import { safeStorage } from '../../utils/safeStorage';

const log = logger.child('InterBankDashboard');


interface InterBankDashboardProps {
    onOpenSettings?: () => void;
}

export function InterBankDashboard({ onOpenSettings }: InterBankDashboardProps) {
    const {
        status,
        saldo,
        saldoLoading,
        refetchSaldo,
        isInitialized,
        useExtrato,
        usePixRecebidos,
        useBoletos,
        criarPixCobranca,
        criarPixLoading,
        enviarPix,
        enviarPixLoading,
        pagarBoleto,
        pagarBoletoLoading,
        emitirBoleto,
        emitirBoletoLoading,
        api,
    } = useInterBank();

    const [tabValue, setTabValue] = useState<'extrato' | 'pix' | 'boletos'>('extrato');
    const [dateRange, setDateRange] = useState({
        dataInicio: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        dataFim: new Date().toISOString().split('T')[0],
    });

    // Queries
    const extratoQuery = useExtrato(dateRange.dataInicio, dateRange.dataFim);
    const pixQuery = usePixRecebidos(
        new Date(dateRange.dataInicio).toISOString(),
        new Date(dateRange.dataFim + 'T23:59:59').toISOString()
    );
    const boletosQuery = useBoletos({
        dataInicial: dateRange.dataInicio,
        dataFinal: dateRange.dataFim,
    });

    // Dialogs
    const [receberPixDialog, setReceberPixDialog] = useState(false);
    const [enviarPixDialog, setEnviarPixDialog] = useState(false);
    const [pagarBoletoDialog, setPagarBoletoDialog] = useState(false);
    const [emitirBoletoDialog, setEmitirBoletoDialog] = useState(false);

    // Forms
    const [receberPixForm, setReceberPixForm] = useState({
        valor: '',
        chave: '',
        descricao: '',
        devedorNome: '',
        devedorDocumento: '',
    });
    const [enviarPixForm, setEnviarPixForm] = useState({
        valor: '',
        chave: '',
        tipoChave: 'CHAVE' as 'CHAVE' | 'DADOS_BANCARIOS',
        descricao: ''
    });
    const [pagarBoletoForm, setPagarBoletoForm] = useState({
        codigoBarras: '',
        valor: '',
        descricao: ''
    });
    const [emitirBoletoForm, setEmitirBoletoForm] = useState({
        seuNumero: '',
        valorNominal: '',
        dataVencimento: '',
        pagadorNome: '',
        pagadorCpfCnpj: '',
        pagadorEndereco: '',
        pagadorBairro: '',
        pagadorCidade: '',
        pagadorUf: '',
        pagadorCep: '',
    });

    // Socket Listener
    useEffect(() => {
        // Token de sessão (opaco) lido da config — antes lia localStorage 'dolapikey', que NUNCA
        // é gravado, então o socket conectava sem token e a auth falhava (#33).
        const sessionToken = safeStorage.getJSON<Record<string, any>>('coolgroove_config', {})?.apiKey || '';
        const socket = io({
            auth: {
                token: sessionToken
            }
        });

        socket.on('inter:transaction', (data) => {

            refetchSaldo();
            if (data.type === 'pix') pixQuery.refetch();
            if (data.type === 'boleto') boletosQuery.refetch();
            extratoQuery.refetch();
        });

        return () => {
            socket.disconnect();
        };
    }, []);

    // Stats
    const stats = useMemo(() => {
        const transacoes = extratoQuery.data?.transacoes || [];
        const creditos = transacoes.filter(t => t.tipoOperacao === 'C');
        const debitos = transacoes.filter(t => t.tipoOperacao === 'D');

        const parseValue = (val: any) => {
            if (typeof val === 'number') return val;
            if (typeof val === 'string') return parseFloat(val);
            return 0;
        };

        return {
            totalCreditos: creditos.reduce((sum, t) => sum + parseValue(t.valor), 0),
            totalDebitos: debitos.reduce((sum, t) => sum + parseValue(t.valor), 0),
            qtdTransacoes: transacoes.length,
        };
    }, [extratoQuery.data]);

    // Handlers
    // Handlers
    const handleCriarPixCobranca = async () => {
        try {
            const documento = receberPixForm.devedorDocumento.replace(/\D/g, '');
            await criarPixCobranca({
                valor: { original: receberPixForm.valor },
                chave: receberPixForm.chave,
                solicitacaoPagador: receberPixForm.descricao,
                devedor: {
                    ...(documento.length > 11 ? { cnpj: documento } : { cpf: documento }),
                    nome: receberPixForm.devedorNome,
                },
            });
            setReceberPixDialog(false);
            setReceberPixForm({
                valor: '',
                chave: '',
                descricao: '',
                devedorNome: '',
                devedorDocumento: '',
            });
        } catch (error) {
            log.error("Failed to create Pix charge", error);
        }
    };

    const handleEnviarPix = async () => {
        try {
            await enviarPix({
                valor: enviarPixForm.valor,
                destinatario: {
                    tipo: enviarPixForm.tipoChave,
                    chave: enviarPixForm.chave
                },
                descricao: enviarPixForm.descricao
            });
            setEnviarPixDialog(false);
            setEnviarPixForm({ valor: '', chave: '', tipoChave: 'CHAVE', descricao: '' });
            refetchSaldo();
        } catch (error) {
            log.error("Failed to send Pix", error);
            toast.error('Erro ao enviar Pix. Verifique os dados e tente novamente.');
        }
    };

    const handlePagarBoleto = async () => {
        try {
            await pagarBoleto({
                codBarraLinhaDigitavel: pagarBoletoForm.codigoBarras,
                valorPagar: parseFloat(pagarBoletoForm.valor)
            });
            setPagarBoletoDialog(false);
            setPagarBoletoForm({ codigoBarras: '', valor: '', descricao: '' });
            refetchSaldo();
        } catch (error) {
            log.error("Failed to pay boleto", error);
            toast.error('Erro ao pagar boleto. Verifique o código de barras e saldo.');
        }
    };

    const handleEmitirBoleto = async () => {
        try {
            await emitirBoleto({
                seuNumero: emitirBoletoForm.seuNumero,
                valorNominal: parseFloat(emitirBoletoForm.valorNominal),
                dataVencimento: emitirBoletoForm.dataVencimento,
                pagador: {
                    cpfCnpj: emitirBoletoForm.pagadorCpfCnpj.replace(/\D/g, ''),
                    tipoPessoa: emitirBoletoForm.pagadorCpfCnpj.replace(/\D/g, '').length > 11 ? 'JURIDICA' : 'FISICA',
                    nome: emitirBoletoForm.pagadorNome,
                    endereco: emitirBoletoForm.pagadorEndereco,
                    bairro: emitirBoletoForm.pagadorBairro,
                    cidade: emitirBoletoForm.pagadorCidade,
                    uf: emitirBoletoForm.pagadorUf,
                    cep: emitirBoletoForm.pagadorCep.replace(/\D/g, ''),
                },
            });
            setEmitirBoletoDialog(false);
            setEmitirBoletoForm({
                seuNumero: '', valorNominal: '', dataVencimento: '',
                pagadorNome: '', pagadorCpfCnpj: '', pagadorEndereco: '',
                pagadorBairro: '', pagadorCidade: '', pagadorUf: '', pagadorCep: '',
            });
            boletosQuery.refetch();
        } catch (error) {
            log.error("Failed to issue boleto", error);
        }
    };

    if (!isInitialized) {
        return (
            <div className="p-6">
                <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-xl p-6">
                    <div className="flex items-center gap-3 mb-2">
                        <AlertCircle className="h-6 w-6 text-yellow-600" />
                        <h3 className="text-lg font-semibold text-yellow-800 dark:text-yellow-300">
                            Banco Inter não configurado
                        </h3>
                    </div>
                    <p className="text-yellow-700 dark:text-yellow-400 mb-4">
                        Configure os certificados e credenciais na aba Configurações → Banco Inter
                    </p>
                    <button
                        onClick={() => onOpenSettings?.()}
                        className="inline-flex items-center gap-2 px-4 py-2 border border-yellow-400 text-yellow-700 dark:text-yellow-400 rounded-lg hover:bg-yellow-100 dark:hover:bg-yellow-900/40 transition-colors"
                    >
                        <Settings className="h-4 w-4" />
                        Ir para Configurações
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="p-6 space-y-6 h-full overflow-y-auto">
            {/* Header */}
            <div className="flex justify-between items-center">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-orange-500/10 rounded-lg">
                        <Landmark className="h-8 w-8 text-orange-500" />
                    </div>
                    <h1 className="text-2xl font-bold text-slate-800 dark:text-white">Banco Inter</h1>
                    <span className={`px-2 py-1 rounded text-xs font-medium ${status?.environment === 'sandbox'
                        ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400'
                        : 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                        }`}>
                        {status?.environment === 'sandbox' ? 'SANDBOX' : 'PRODUÇÃO'}
                    </span>
                </div>
                <div className="flex gap-2">
                    <button
                        onClick={() => setEnviarPixDialog(true)}
                        className="inline-flex items-center gap-2 px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg font-medium transition-colors"
                    >
                        <ArrowUpRight className="h-4 w-4" />
                        Pagar Pix
                    </button>
                    <button
                        onClick={() => setPagarBoletoDialog(true)}
                        className="inline-flex items-center gap-2 px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg font-medium transition-colors"
                    >
                        <CreditCard className="h-4 w-4" />
                        Pagar Boleto
                    </button>
                    <div className="w-px h-8 bg-slate-200 dark:bg-slate-700 mx-2" />
                    <button
                        onClick={() => setReceberPixDialog(true)}
                        className="inline-flex items-center gap-2 px-4 py-2 bg-green-500 hover:bg-green-600 text-white rounded-lg font-medium transition-colors"
                    >
                        <QrCode className="h-4 w-4" />
                        Receber Pix
                    </button>
                    <button
                        onClick={() => setEmitirBoletoDialog(true)}
                        className="inline-flex items-center gap-2 px-4 py-2 bg-green-500 hover:bg-green-600 text-white rounded-lg font-medium transition-colors"
                    >
                        <FileText className="h-4 w-4" />
                        Gerar Boleto
                    </button>
                    <button
                        onClick={() => refetchSaldo()}
                        className="p-2 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
                    >
                        <RefreshCcw className="h-5 w-5" />
                    </button>
                </div>
            </div>

            {/* Balance Cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="bg-gradient-to-br from-orange-500 to-orange-600 rounded-xl p-5 text-white">
                    <p className="text-orange-100 text-sm">Saldo Disponível</p>
                    {saldoLoading ? (
                        <Loader2 className="h-6 w-6 animate-spin mt-2" />
                    ) : (
                        <p className="text-2xl font-bold mt-1">
                            {formatCurrency(saldo?.disponivel ?? 0)}
                        </p>
                    )}
                </div>
                <div className="bg-gradient-to-br from-green-500 to-green-600 rounded-xl p-5 text-white">
                    <p className="text-green-100 text-sm">Entradas (período)</p>
                    <div className="flex items-center gap-2 mt-1">
                        <TrendingUp className="h-5 w-5" />
                        <p className="text-2xl font-bold">
                            {formatCurrency(stats.totalCreditos)}
                        </p>
                    </div>
                </div>
                <div className="bg-gradient-to-br from-red-500 to-red-600 rounded-xl p-5 text-white">
                    <p className="text-red-100 text-sm">Saídas (período)</p>
                    <div className="flex items-center gap-2 mt-1">
                        <TrendingDown className="h-5 w-5" />
                        <p className="text-2xl font-bold">
                            {formatCurrency(stats.totalDebitos)}
                        </p>
                    </div>
                </div>
                <div className="bg-white dark:bg-slate-800 rounded-xl p-5 border border-slate-200 dark:border-slate-700">
                    <p className="text-slate-500 dark:text-slate-400 text-sm">Limite Disponível</p>
                    <p className="text-2xl font-bold text-slate-800 dark:text-white mt-1">
                        {formatCurrency(saldo?.limite ?? 0)}
                    </p>
                </div>
            </div>

            {/* Date Range Filter */}
            <div className="bg-white dark:bg-slate-800 rounded-xl p-4 border border-slate-200 dark:border-slate-700">
                <div className="flex items-center gap-4">
                    <div>
                        <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">Data Início</label>
                        <input
                            type="date"
                            value={dateRange.dataInicio}
                            onChange={(e) => setDateRange(prev => ({ ...prev, dataInicio: e.target.value }))}
                            className="px-3 py-1.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-800 dark:text-white text-sm"
                        />
                    </div>
                    <div>
                        <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">Data Fim</label>
                        <input
                            type="date"
                            value={dateRange.dataFim}
                            onChange={(e) => setDateRange(prev => ({ ...prev, dataFim: e.target.value }))}
                            className="px-3 py-1.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-800 dark:text-white text-sm"
                        />
                    </div>
                    <button
                        onClick={() => {
                            extratoQuery.refetch();
                            pixQuery.refetch();
                            boletosQuery.refetch();
                        }}
                        className="px-4 py-1.5 border border-orange-500 text-orange-500 hover:bg-orange-50 dark:hover:bg-orange-900/20 rounded-lg font-medium text-sm transition-colors mt-5"
                    >
                        Atualizar
                    </button>
                </div>
            </div>

            {/* Tabs */}
            <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
                <div className="flex border-b border-slate-200 dark:border-slate-700">
                    {['extrato', 'pix', 'boletos'].map((tab) => (
                        <button
                            key={tab}
                            onClick={() => setTabValue(tab as any)}
                            className={`px-6 py-3 text-sm font-medium transition-colors ${tabValue === tab
                                ? 'text-orange-600 border-b-2 border-orange-500 bg-orange-50 dark:bg-orange-900/20'
                                : 'text-slate-600 dark:text-slate-400 hover:text-orange-600'
                                }`}
                        >
                            {tab === 'extrato' && `Extrato (${extratoQuery.data?.transacoes?.length || 0})`}
                            {tab === 'pix' && `Pix Recebidos (${pixQuery.data?.pix?.length || 0})`}
                            {tab === 'boletos' && `Boletos (${boletosQuery.data?.content?.length || 0})`}
                        </button>
                    ))}
                </div>

                <div className="p-4">
                    {/* Extrato Tab */}
                    {tabValue === 'extrato' && (
                        extratoQuery.isLoading ? (
                            <div className="flex justify-center py-8">
                                <Loader2 className="h-8 w-8 animate-spin text-orange-500" />
                            </div>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full">
                                    <thead>
                                        <tr className="text-left text-xs text-slate-500 dark:text-slate-400 uppercase">
                                            <th className="px-4 py-2">Data</th>
                                            <th className="px-4 py-2">Tipo</th>
                                            <th className="px-4 py-2">Descrição / Finalidade</th>
                                            <th className="px-4 py-2">Cliente</th>
                                            <th className="px-4 py-2 text-right">Valor</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                                        {(extratoQuery.data?.transacoes || []).map((t: TransacaoInter, i: number) => (
                                            <tr key={i} className="hover:bg-slate-50 dark:hover:bg-slate-700/50">
                                                <td className="px-4 py-3 text-sm text-slate-800 dark:text-white">
                                                    {formatDateOnly(t.dataMovimento || t.dataEntrada)}
                                                </td>
                                                <td className="px-4 py-3">
                                                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${t.tipoOperacao === 'C'
                                                        ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                                                        : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                                                        }`}>
                                                        {t.tipoTransacao}
                                                    </span>
                                                </td>
                                                <td className="px-4 py-3 text-sm text-slate-600 dark:text-slate-300">
                                                    <div>{t.tipoOperacao === 'D' ? (t.vinculo?.finalidade || t.titulo || t.descricao) : (t.titulo || t.descricao)}</div>
                                                </td>
                                                <td className="px-4 py-3 text-sm text-slate-500 dark:text-slate-400">
                                                    {t.tipoOperacao === 'D' ? (t.vinculo?.cliente || <span className="text-slate-300 dark:text-slate-600">—</span>) : <span className="text-slate-300 dark:text-slate-600">—</span>}
                                                </td>
                                                <td className={`px-4 py-3 text-sm font-medium text-right ${t.tipoOperacao === 'C' ? 'text-green-600' : 'text-red-600'
                                                    }`}>
                                                    {t.tipoOperacao === 'C' ? '+' : '-'} {formatCurrency(Number(t.valor))}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )
                    )}

                    {/* PIX Tab */}
                    {tabValue === 'pix' && (
                        pixQuery.isLoading ? (
                            <div className="flex justify-center py-8">
                                <Loader2 className="h-8 w-8 animate-spin text-orange-500" />
                            </div>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full">
                                    <thead>
                                        <tr className="text-left text-xs text-slate-500 dark:text-slate-400 uppercase">
                                            <th className="px-4 py-2">Data/Hora</th>
                                            <th className="px-4 py-2">E2E ID</th>
                                            <th className="px-4 py-2">Pagador</th>
                                            <th className="px-4 py-2 text-right">Valor</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                                        {(pixQuery.data?.pix || []).map((p: PixRecebido) => (
                                            <tr key={p.endToEndId} className="hover:bg-slate-50 dark:hover:bg-slate-700/50">
                                                <td className="px-4 py-3 text-sm text-slate-800 dark:text-white">
                                                    {formatDateTime(p.horario)}
                                                </td>
                                                <td className="px-4 py-3">
                                                    <code className="text-xs bg-slate-100 dark:bg-slate-700 px-2 py-1 rounded">
                                                        {p.endToEndId.substring(0, 20)}...
                                                    </code>
                                                </td>
                                                <td className="px-4 py-3 text-sm text-slate-600 dark:text-slate-300">{p.pagador?.nome || 'N/A'}</td>
                                                <td className="px-4 py-3 text-sm font-medium text-right text-green-600">
                                                    {formatCurrency(parseFloat(p.valor))}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )
                    )}

                    {/* Boletos Tab */}
                    {tabValue === 'boletos' && (
                        boletosQuery.isLoading ? (
                            <div className="flex justify-center py-8">
                                <Loader2 className="h-8 w-8 animate-spin text-orange-500" />
                            </div>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full">
                                    <thead>
                                        <tr className="text-left text-xs text-slate-500 dark:text-slate-400 uppercase">
                                            <th className="px-4 py-2">Nosso Número</th>
                                            <th className="px-4 py-2">Vencimento</th>
                                            <th className="px-4 py-2">Valor</th>
                                            <th className="px-4 py-2">Situação</th>
                                            <th className="px-4 py-2 text-center">Ações</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                                        {(boletosQuery.data?.content || []).map((b: BoletoResponse) => (
                                            <tr key={b.nossoNumero} className="hover:bg-slate-50 dark:hover:bg-slate-700/50">
                                                <td className="px-4 py-3 text-sm text-slate-800 dark:text-white">{b.nossoNumero}</td>
                                                <td className="px-4 py-3 text-sm text-slate-600 dark:text-slate-300">
                                                    {formatDateOnly(b.dataVencimento)}
                                                </td>
                                                <td className="px-4 py-3 text-sm text-slate-800 dark:text-white">
                                                    {formatCurrency(Number(b.valorNominal))}
                                                </td>
                                                <td className="px-4 py-3">
                                                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${b.situacao === 'PAGO' ? 'bg-green-100 text-green-700' :
                                                        b.situacao === 'CANCELADO' ? 'bg-red-100 text-red-700' :
                                                            'bg-yellow-100 text-yellow-700'
                                                        }`}>
                                                        {b.situacao || 'EMABERTO'}
                                                    </span>
                                                </td>
                                                <td className="px-4 py-3 text-center">
                                                    <button
                                                        onClick={async () => {
                                                            const pdf = await api.downloadBoletoPdf(b.nossoNumero);
                                                            const url = URL.createObjectURL(pdf);
                                                            window.open(url);
                                                            setTimeout(() => URL.revokeObjectURL(url), 60_000); // libera o blob após a aba carregar (evita memory leak, #33)
                                                        }}
                                                        className="p-1.5 text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700 rounded transition-colors"
                                                        title="Download PDF"
                                                    >
                                                        <Download className="h-4 w-4" />
                                                    </button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )
                    )}
                </div>
            </div>

            {/* Modal: Receber Pix (Cobrança) */}
            {receberPixDialog && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-white dark:bg-slate-800 rounded-xl p-6 w-full max-w-md mx-4 shadow-xl">
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="text-lg font-semibold text-slate-800 dark:text-white">Gerar Cobrança Pix</h3>
                            <button onClick={() => setReceberPixDialog(false)} className="text-slate-400 hover:text-slate-600">
                                <X className="h-5 w-5" />
                            </button>
                        </div>
                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Valor (R$)</label>
                                <input
                                    type="number"
                                    step="0.01"
                                    value={receberPixForm.valor}
                                    onChange={(e) => setReceberPixForm(prev => ({ ...prev, valor: e.target.value }))}
                                    className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-800 dark:text-white"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Chave Pix (opcional)</label>
                                <input
                                    type="text"
                                    value={receberPixForm.chave}
                                    onChange={(e) => setReceberPixForm(prev => ({ ...prev, chave: e.target.value }))}
                                    placeholder="CPF, CNPJ, Email, Telefone ou Chave Aleatória"
                                    className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-800 dark:text-white"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Nome do pagador</label>
                                <input
                                    type="text"
                                    value={receberPixForm.devedorNome}
                                    onChange={(e) => setReceberPixForm(prev => ({ ...prev, devedorNome: e.target.value }))}
                                    className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-800 dark:text-white"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">CPF/CNPJ do pagador</label>
                                <input
                                    type="text"
                                    value={receberPixForm.devedorDocumento}
                                    onChange={(e) => setReceberPixForm(prev => ({ ...prev, devedorDocumento: e.target.value }))}
                                    className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-800 dark:text-white"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Descrição</label>
                                <textarea
                                    value={receberPixForm.descricao}
                                    onChange={(e) => setReceberPixForm(prev => ({ ...prev, descricao: e.target.value }))}
                                    rows={2}
                                    className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-800 dark:text-white"
                                />
                            </div>
                        </div>
                        <div className="flex justify-end gap-2 mt-6">
                            <button
                                onClick={() => setReceberPixDialog(false)}
                                className="px-4 py-2 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={handleCriarPixCobranca}
                                disabled={
                                    criarPixLoading
                                    || !receberPixForm.valor
                                    || !receberPixForm.chave
                                    || !receberPixForm.devedorNome
                                    || !receberPixForm.devedorDocumento
                                }
                                className="inline-flex items-center gap-2 px-4 py-2 bg-green-500 hover:bg-green-600 text-white rounded-lg font-medium transition-colors disabled:opacity-50"
                            >
                                {criarPixLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <QrCode className="h-4 w-4" />}
                                Gerar QR Code
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Modal: Enviar Pix (Pagamento) */}
            {enviarPixDialog && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-white dark:bg-slate-800 rounded-xl p-6 w-full max-w-md mx-4 shadow-xl">
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="text-lg font-semibold text-slate-800 dark:text-white">Fazer Pagamento Pix</h3>
                            <button onClick={() => setEnviarPixDialog(false)} className="text-slate-400 hover:text-slate-600">
                                <X className="h-5 w-5" />
                            </button>
                        </div>
                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Valor (R$)</label>
                                <input
                                    type="number"
                                    step="0.01"
                                    value={enviarPixForm.valor}
                                    onChange={(e) => setEnviarPixForm(prev => ({ ...prev, valor: e.target.value }))}
                                    className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-800 dark:text-white"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Chave do Destinatário</label>
                                <input
                                    type="text"
                                    value={enviarPixForm.chave}
                                    onChange={(e) => setEnviarPixForm(prev => ({ ...prev, chave: e.target.value }))}
                                    placeholder="CPF, CNPJ, Email, Telefone..."
                                    className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-800 dark:text-white"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Descrição</label>
                                <textarea
                                    value={enviarPixForm.descricao}
                                    onChange={(e) => setEnviarPixForm(prev => ({ ...prev, descricao: e.target.value }))}
                                    rows={2}
                                    className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-800 dark:text-white"
                                />
                            </div>
                        </div>
                        <div className="flex justify-end gap-2 mt-6">
                            <button
                                onClick={() => setEnviarPixDialog(false)}
                                className="px-4 py-2 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={handleEnviarPix}
                                disabled={enviarPixLoading || !enviarPixForm.valor || !enviarPixForm.chave}
                                className="inline-flex items-center gap-2 px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg font-medium transition-colors disabled:opacity-50"
                            >
                                {enviarPixLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUpRight className="h-4 w-4" />}
                                Enviar Pix
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Modal: Pagar Boleto */}
            {pagarBoletoDialog && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-white dark:bg-slate-800 rounded-xl p-6 w-full max-w-md mx-4 shadow-xl">
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="text-lg font-semibold text-slate-800 dark:text-white">Pagar Boleto</h3>
                            <button onClick={() => setPagarBoletoDialog(false)} className="text-slate-400 hover:text-slate-600">
                                <X className="h-5 w-5" />
                            </button>
                        </div>
                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Código de Barras (Linha Digitável)</label>
                                <input
                                    type="text"
                                    value={pagarBoletoForm.codigoBarras}
                                    onChange={(e) => setPagarBoletoForm(prev => ({ ...prev, codigoBarras: e.target.value }))}
                                    className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-800 dark:text-white font-mono text-sm"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Valor (R$)</label>
                                <input
                                    type="number"
                                    step="0.01"
                                    value={pagarBoletoForm.valor}
                                    onChange={(e) => setPagarBoletoForm(prev => ({ ...prev, valor: e.target.value }))}
                                    className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-800 dark:text-white"
                                />
                            </div>
                        </div>
                        <div className="flex justify-end gap-2 mt-6">
                            <button
                                onClick={() => setPagarBoletoDialog(false)}
                                className="px-4 py-2 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={handlePagarBoleto}
                                disabled={pagarBoletoLoading || !pagarBoletoForm.codigoBarras || !pagarBoletoForm.valor}
                                className="inline-flex items-center gap-2 px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg font-medium transition-colors disabled:opacity-50"
                            >
                                {pagarBoletoLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />}
                                Pagar
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Boleto Emitir Dialog - Simplified for brevity */}
            {emitirBoletoDialog && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-white dark:bg-slate-800 rounded-xl p-6 w-full max-w-2xl mx-4 shadow-xl max-h-[90vh] overflow-y-auto">
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="text-lg font-semibold text-slate-800 dark:text-white">Emitir Boleto</h3>
                            <button onClick={() => setEmitirBoletoDialog(false)} className="text-slate-400 hover:text-slate-600">
                                <X className="h-5 w-5" />
                            </button>
                        </div>
                        <div className="grid grid-cols-3 gap-4 mb-4">
                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Seu Número</label>
                                <input type="text" value={emitirBoletoForm.seuNumero} onChange={(e) => setEmitirBoletoForm(prev => ({ ...prev, seuNumero: e.target.value }))} className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-800 dark:text-white text-sm" />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Valor (R$)</label>
                                <input type="number" step="0.01" value={emitirBoletoForm.valorNominal} onChange={(e) => setEmitirBoletoForm(prev => ({ ...prev, valorNominal: e.target.value }))} className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-800 dark:text-white text-sm" />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Vencimento</label>
                                <input type="date" value={emitirBoletoForm.dataVencimento} onChange={(e) => setEmitirBoletoForm(prev => ({ ...prev, dataVencimento: e.target.value }))} className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-800 dark:text-white text-sm" />
                            </div>
                        </div>
                        <p className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Dados do Pagador</p>
                        <div className="grid grid-cols-2 gap-4 mb-4">
                            <div>
                                <label className="block text-xs text-slate-500 mb-1">Nome</label>
                                <input type="text" value={emitirBoletoForm.pagadorNome} onChange={(e) => setEmitirBoletoForm(prev => ({ ...prev, pagadorNome: e.target.value }))} className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-800 dark:text-white text-sm" />
                            </div>
                            <div>
                                <label className="block text-xs text-slate-500 mb-1">CPF/CNPJ</label>
                                <input type="text" value={emitirBoletoForm.pagadorCpfCnpj} onChange={(e) => setEmitirBoletoForm(prev => ({ ...prev, pagadorCpfCnpj: e.target.value }))} className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-800 dark:text-white text-sm" />
                            </div>
                        </div>
                        <div className="flex justify-end gap-2">
                            <button onClick={() => setEmitirBoletoDialog(false)} className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg">Cancelar</button>
                            <button onClick={handleEmitirBoleto} disabled={emitirBoletoLoading} className="inline-flex items-center gap-2 px-4 py-2 bg-green-500 hover:bg-green-600 text-white rounded-lg font-medium disabled:opacity-50">
                                {emitirBoletoLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                                Emitir Boleto
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

export default InterBankDashboard;
