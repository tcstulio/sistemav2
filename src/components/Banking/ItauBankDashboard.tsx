/**
 * Itau Bank Dashboard
 * 
 * Main dashboard for Banco Itaú operations
 */

import React, { useState, useMemo } from 'react';
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
    Plus
} from 'lucide-react';
import { useItauBank, TransacaoItau, PixRecebidoItau, BoletoItau } from '../../hooks/useItauBank';

interface ItauBankDashboardProps {
    onOpenSettings?: () => void;
}

export function ItauBankDashboard({ onOpenSettings }: ItauBankDashboardProps) {
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
        emitirBoleto,
        emitirBoletoLoading,
        api,
    } = useItauBank();

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
    const [pixDialog, setPixDialog] = useState(false);
    const [boletoDialog, setBoletoDialog] = useState(false);
    const [pixForm, setPixForm] = useState({ valor: '', chave: '', descricao: '' });
    const [boletoForm, setBoletoForm] = useState({
        valorTitulo: '',
        dataVencimento: '',
        pagadorNome: '',
        pagadorCpfCnpj: '',
    });

    // Stats
    const stats = useMemo(() => {
        const transacoes = extratoQuery.data?.transacoes || [];
        const creditos = transacoes.filter(t => t.tipoOperacao === 'C');
        const debitos = transacoes.filter(t => t.tipoOperacao === 'D');

        return {
            totalCreditos: creditos.reduce((sum, t) => sum + t.valor, 0),
            totalDebitos: debitos.reduce((sum, t) => sum + t.valor, 0),
            qtdTransacoes: transacoes.length,
        };
    }, [extratoQuery.data]);

    // Handlers
    const handleCriarPix = async () => {
        try {
            await criarPixCobranca({
                valor: { original: pixForm.valor },
                chave: pixForm.chave,
                solicitacaoPagador: pixForm.descricao,
            });
            setPixDialog(false);
            setPixForm({ valor: '', chave: '', descricao: '' });
        } catch (error) {
            console.error('Erro ao criar Pix:', error);
        }
    };

    const handleEmitirBoleto = async () => {
        try {
            await emitirBoleto({
                etapa_processo_boleto: 'efetivacao',
                dado_boleto: {
                    descricao_instrumento_cobranca: 'boleto_pix',
                    tipo_boleto: 'a_vista',
                    codigo_carteira: '109',
                    valor_total_titulo: parseFloat(boletoForm.valorTitulo),
                    data_emissao: new Date().toISOString().split('T')[0],
                    data_vencimento: boletoForm.dataVencimento,
                    pagador: {
                        pessoa: {
                            nome_pessoa: boletoForm.pagadorNome,
                            tipo_pessoa: boletoForm.pagadorCpfCnpj.replace(/\D/g, '').length > 11 ? 'juridica' : 'fisica',
                            cpf: boletoForm.pagadorCpfCnpj.replace(/\D/g, '').length <= 11 ? boletoForm.pagadorCpfCnpj.replace(/\D/g, '') : undefined,
                            cnpj: boletoForm.pagadorCpfCnpj.replace(/\D/g, '').length > 11 ? boletoForm.pagadorCpfCnpj.replace(/\D/g, '') : undefined,
                        },
                        endereco: {
                            nome_logradouro: 'Não informado',
                            nome_bairro: 'Não informado',
                            nome_cidade: 'Não informado',
                            sigla_UF: 'SP',
                            numero_CEP: '00000000',
                        },
                    },
                    dados_individuais_boleto: [{
                        valor_titulo: parseFloat(boletoForm.valorTitulo),
                        data_vencimento: boletoForm.dataVencimento,
                    }],
                },
            });
            setBoletoDialog(false);
            setBoletoForm({ valorTitulo: '', dataVencimento: '', pagadorNome: '', pagadorCpfCnpj: '' });
            boletosQuery.refetch();
        } catch (error) {
            console.error('Erro ao emitir boleto:', error);
        }
    };

    if (!isInitialized) {
        return (
            <div className="p-6">
                <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-xl p-6">
                    <div className="flex items-center gap-3 mb-2">
                        <AlertCircle className="h-6 w-6 text-yellow-600" />
                        <h3 className="text-lg font-semibold text-yellow-800 dark:text-yellow-300">
                            Banco Itaú não configurado
                        </h3>
                    </div>
                    <p className="text-yellow-700 dark:text-yellow-400 mb-4">
                        Configure os certificados e credenciais na aba Configurações → Banco Itaú
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
        <div className="p-6 space-y-6">
            {/* Header */}
            <div className="flex justify-between items-center">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-blue-500/10 rounded-lg">
                        <Landmark className="h-8 w-8 text-blue-600" />
                    </div>
                    <h1 className="text-2xl font-bold text-slate-800 dark:text-white">Banco Itaú</h1>
                    <span className={`px-2 py-1 rounded text-xs font-medium ${status?.environment === 'sandbox'
                        ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400'
                        : 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                        }`}>
                        {status?.environment === 'sandbox' ? 'SANDBOX' : 'PRODUÇÃO'}
                    </span>
                </div>
                <div className="flex gap-2">
                    <button
                        onClick={() => setPixDialog(true)}
                        className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors"
                    >
                        <QrCode className="h-4 w-4" />
                        Novo Pix
                    </button>
                    <button
                        onClick={() => setBoletoDialog(true)}
                        className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors"
                    >
                        <FileText className="h-4 w-4" />
                        Novo Boleto
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
                <div className="bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl p-5 text-white">
                    <p className="text-blue-100 text-sm">Saldo Disponível</p>
                    {saldoLoading ? (
                        <Loader2 className="h-6 w-6 animate-spin mt-2" />
                    ) : (
                        <p className="text-2xl font-bold mt-1">
                            R$ {saldo?.disponivel?.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) || '0,00'}
                        </p>
                    )}
                </div>
                <div className="bg-gradient-to-br from-green-500 to-green-600 rounded-xl p-5 text-white">
                    <p className="text-green-100 text-sm">Entradas (período)</p>
                    <div className="flex items-center gap-2 mt-1">
                        <TrendingUp className="h-5 w-5" />
                        <p className="text-2xl font-bold">
                            R$ {stats.totalCreditos.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                        </p>
                    </div>
                </div>
                <div className="bg-gradient-to-br from-red-500 to-red-600 rounded-xl p-5 text-white">
                    <p className="text-red-100 text-sm">Saídas (período)</p>
                    <div className="flex items-center gap-2 mt-1">
                        <TrendingDown className="h-5 w-5" />
                        <p className="text-2xl font-bold">
                            R$ {stats.totalDebitos.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                        </p>
                    </div>
                </div>
                <div className="bg-white dark:bg-slate-800 rounded-xl p-5 border border-slate-200 dark:border-slate-700">
                    <p className="text-slate-500 dark:text-slate-400 text-sm">Limite Disponível</p>
                    <p className="text-2xl font-bold text-slate-800 dark:text-white mt-1">
                        R$ {saldo?.limite?.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) || '0,00'}
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
                        className="px-4 py-1.5 border border-blue-500 text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg font-medium text-sm transition-colors mt-5"
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
                                ? 'text-blue-600 border-b-2 border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                                : 'text-slate-600 dark:text-slate-400 hover:text-blue-600'
                                }`}
                        >
                            {tab === 'extrato' && `Extrato (${extratoQuery.data?.transacoes?.length || 0})`}
                            {tab === 'pix' && `Pix Recebidos (${pixQuery.data?.pix?.length || 0})`}
                            {tab === 'boletos' && `Boletos (${boletosQuery.data?.data?.length || 0})`}
                        </button>
                    ))}
                </div>

                <div className="p-4">
                    {/* Extrato Tab */}
                    {tabValue === 'extrato' && (
                        extratoQuery.isLoading ? (
                            <div className="flex justify-center py-8">
                                <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
                            </div>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full">
                                    <thead>
                                        <tr className="text-left text-xs text-slate-500 dark:text-slate-400 uppercase">
                                            <th className="px-4 py-2">Data</th>
                                            <th className="px-4 py-2">Tipo</th>
                                            <th className="px-4 py-2">Descrição</th>
                                            <th className="px-4 py-2 text-right">Valor</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                                        {(extratoQuery.data?.transacoes || []).map((t: TransacaoItau, i: number) => (
                                            <tr key={i} className="hover:bg-slate-50 dark:hover:bg-slate-700/50">
                                                <td className="px-4 py-3 text-sm text-slate-800 dark:text-white">
                                                    {new Date(t.dataMovimento).toLocaleDateString('pt-BR')}
                                                </td>
                                                <td className="px-4 py-3">
                                                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${t.tipoOperacao === 'C'
                                                        ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                                                        : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                                                        }`}>
                                                        {t.tipoTransacao}
                                                    </span>
                                                </td>
                                                <td className="px-4 py-3 text-sm text-slate-600 dark:text-slate-300">{t.descricao}</td>
                                                <td className={`px-4 py-3 text-sm font-medium text-right ${t.tipoOperacao === 'C' ? 'text-green-600' : 'text-red-600'
                                                    }`}>
                                                    {t.tipoOperacao === 'C' ? '+' : '-'} R$ {t.valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
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
                                <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
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
                                        {(pixQuery.data?.pix || []).map((p: PixRecebidoItau) => (
                                            <tr key={p.endToEndId} className="hover:bg-slate-50 dark:hover:bg-slate-700/50">
                                                <td className="px-4 py-3 text-sm text-slate-800 dark:text-white">
                                                    {new Date(p.horario).toLocaleString('pt-BR')}
                                                </td>
                                                <td className="px-4 py-3">
                                                    <code className="text-xs bg-slate-100 dark:bg-slate-700 px-2 py-1 rounded">
                                                        {p.endToEndId.substring(0, 20)}...
                                                    </code>
                                                </td>
                                                <td className="px-4 py-3 text-sm text-slate-600 dark:text-slate-300">{p.pagador?.nome || 'N/A'}</td>
                                                <td className="px-4 py-3 text-sm font-medium text-right text-green-600">
                                                    R$ {parseFloat(p.valor).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
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
                                <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
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
                                        {(boletosQuery.data?.data || []).map((b: BoletoItau) => (
                                            <tr key={b.numero_nosso_numero} className="hover:bg-slate-50 dark:hover:bg-slate-700/50">
                                                <td className="px-4 py-3 text-sm text-slate-800 dark:text-white">{b.numero_nosso_numero}</td>
                                                <td className="px-4 py-3 text-sm text-slate-600 dark:text-slate-300">
                                                    {new Date(b.data_vencimento).toLocaleDateString('pt-BR')}
                                                </td>
                                                <td className="px-4 py-3 text-sm text-slate-800 dark:text-white">
                                                    R$ {b.valor_titulo.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                                                </td>
                                                <td className="px-4 py-3">
                                                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${b.situacao_geral_boleto === 'liquidado' ? 'bg-green-100 text-green-700' :
                                                        b.situacao_geral_boleto === 'baixado' ? 'bg-red-100 text-red-700' :
                                                            'bg-yellow-100 text-yellow-700'
                                                        }`}>
                                                        {b.situacao_geral_boleto || 'em_aberto'}
                                                    </span>
                                                </td>
                                                <td className="px-4 py-3 text-center">
                                                    <button
                                                        onClick={async () => {
                                                            const pdf = await api.downloadBoletoPdf(b.numero_nosso_numero);
                                                            const url = URL.createObjectURL(pdf);
                                                            window.open(url);
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

            {/* Pix Dialog */}
            {pixDialog && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-white dark:bg-slate-800 rounded-xl p-6 w-full max-w-md mx-4 shadow-xl">
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="text-lg font-semibold text-slate-800 dark:text-white">Criar Cobrança Pix</h3>
                            <button onClick={() => setPixDialog(false)} className="text-slate-400 hover:text-slate-600">
                                <X className="h-5 w-5" />
                            </button>
                        </div>
                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Valor (R$)</label>
                                <input
                                    type="number"
                                    step="0.01"
                                    value={pixForm.valor}
                                    onChange={(e) => setPixForm(prev => ({ ...prev, valor: e.target.value }))}
                                    className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-800 dark:text-white"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Chave Pix</label>
                                <input
                                    type="text"
                                    value={pixForm.chave}
                                    onChange={(e) => setPixForm(prev => ({ ...prev, chave: e.target.value }))}
                                    placeholder="CPF, CNPJ, Email, Telefone ou Chave Aleatória"
                                    className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-800 dark:text-white"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Descrição (opcional)</label>
                                <textarea
                                    value={pixForm.descricao}
                                    onChange={(e) => setPixForm(prev => ({ ...prev, descricao: e.target.value }))}
                                    rows={2}
                                    className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-800 dark:text-white"
                                />
                            </div>
                        </div>
                        <div className="flex justify-end gap-2 mt-6">
                            <button
                                onClick={() => setPixDialog(false)}
                                className="px-4 py-2 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={handleCriarPix}
                                disabled={criarPixLoading || !pixForm.valor || !pixForm.chave}
                                className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50"
                            >
                                {criarPixLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                                Criar Pix
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Boleto Dialog */}
            {boletoDialog && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-white dark:bg-slate-800 rounded-xl p-6 w-full max-w-lg mx-4 shadow-xl">
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="text-lg font-semibold text-slate-800 dark:text-white">Emitir Boleto</h3>
                            <button onClick={() => setBoletoDialog(false)} className="text-slate-400 hover:text-slate-600">
                                <X className="h-5 w-5" />
                            </button>
                        </div>
                        <div className="space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Valor (R$)</label>
                                    <input type="number" step="0.01" value={boletoForm.valorTitulo} onChange={(e) => setBoletoForm(prev => ({ ...prev, valorTitulo: e.target.value }))} className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-800 dark:text-white" />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Vencimento</label>
                                    <input type="date" value={boletoForm.dataVencimento} onChange={(e) => setBoletoForm(prev => ({ ...prev, dataVencimento: e.target.value }))} className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-800 dark:text-white" />
                                </div>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Nome do Pagador</label>
                                <input type="text" value={boletoForm.pagadorNome} onChange={(e) => setBoletoForm(prev => ({ ...prev, pagadorNome: e.target.value }))} className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-800 dark:text-white" />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">CPF/CNPJ</label>
                                <input type="text" value={boletoForm.pagadorCpfCnpj} onChange={(e) => setBoletoForm(prev => ({ ...prev, pagadorCpfCnpj: e.target.value }))} className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-800 dark:text-white" />
                            </div>
                        </div>
                        <div className="flex justify-end gap-2 mt-6">
                            <button onClick={() => setBoletoDialog(false)} className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg">Cancelar</button>
                            <button onClick={handleEmitirBoleto} disabled={emitirBoletoLoading} className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium disabled:opacity-50">
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

export default ItauBankDashboard;
