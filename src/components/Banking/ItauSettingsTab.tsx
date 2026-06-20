/**
 * Itau Settings Tab
 * 
 * Component for configuring Banco Itaú API integration
 */

import React, { useState, useRef, useEffect } from 'react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import {
    Shield,
    Upload,
    Check,
    X,
    RefreshCcw,
    Key,
    Link2,
    Loader2,
    AlertCircle,
    CheckCircle2,
    Landmark,
    Save
} from 'lucide-react';
import { useItauBank } from '../../hooks/useItauBank';
import { saveBankingCredentials, getBankingCredentialsStatus } from '../../services/bankingConfigService';
import { formatCurrency } from '../../utils/formatUtils';

interface ItauSettingsTabProps {
    onSave?: () => void;
}

export function ItauSettingsTab({ onSave }: ItauSettingsTabProps) {
    const {
        status,
        statusLoading,
        testConnection,
        testConnectionLoading,
        uploadCertificates,
        uploadCertificatesLoading,
        saldo,
    } = useItauBank();

    const queryClient = useQueryClient();
    const [clientId, setClientId] = useState('');
    const [clientSecret, setClientSecret] = useState('');
    const [contaCorrente, setContaCorrente] = useState('');
    const [agencia, setAgencia] = useState('');
    const [environment, setEnvironment] = useState<'sandbox' | 'production'>('sandbox');
    const [savingCreds, setSavingCreds] = useState(false);
    const [secretConfigured, setSecretConfigured] = useState(false);
    const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
    const [uploadResult, setUploadResult] = useState<{ success: boolean; message: string } | null>(null);

    const certInputRef = useRef<HTMLInputElement>(null);
    const keyInputRef = useRef<HTMLInputElement>(null);

    // Prefill do ambiente e flag de "secret já configurado" (nunca traz o valor do secret).
    useEffect(() => {
        getBankingCredentialsStatus('itau')
            .then((st) => {
                setSecretConfigured(st.hasClientSecret);
                setEnvironment(st.environment);
            })
            .catch(() => { /* sem credenciais salvas ou sem permissão — ignora */ });
    }, []);

    const handleUploadCertificates = async () => {
        const certFile = certInputRef.current?.files?.[0];
        const keyFile = keyInputRef.current?.files?.[0];

        if (!certFile || !keyFile) {
            setUploadResult({ success: false, message: 'Selecione os arquivos .crt e .key' });
            return;
        }

        try {
            const result = await uploadCertificates([certFile, keyFile]);
            setUploadResult({
                success: true,
                message: `Certificados enviados: ${result.uploaded.join(', ')}`,
            });
        } catch (error: any) {
            setUploadResult({
                success: false,
                message: error.response?.data?.error || error.message,
            });
        }
    };

    const handleTestConnection = async () => {
        setTestResult(null);
        try {
            const result = await testConnection();
            if (result.success) {
                setTestResult({
                    success: true,
                    message: `Conexão OK! Saldo disponível: ${formatCurrency(result.saldo?.disponivel ?? 0)}`,
                });
            } else {
                setTestResult({
                    success: false,
                    message: result.error || 'Falha na conexão',
                });
            }
        } catch (error: any) {
            setTestResult({
                success: false,
                message: error.response?.data?.error || error.message,
            });
        }
    };

    const handleSaveCredentials = async () => {
        if (!clientId && !clientSecret && !contaCorrente && !agencia) {
            toast.error('Preencha ao menos um campo para salvar.');
            return;
        }
        setSavingCreds(true);
        try {
            const st = await saveBankingCredentials('itau', {
                clientId: clientId || undefined,
                clientSecret: clientSecret || undefined, // vazio preserva o secret já salvo
                environment,
                contaCorrente: contaCorrente || undefined,
                agencia: agencia || undefined,
            });
            setSecretConfigured(st.hasClientSecret);
            setClientSecret('');
            toast.success('Credenciais salvas e aplicadas.');
            queryClient.invalidateQueries({ queryKey: ['itau'] });
            onSave?.();
        } catch (error: any) {
            const msg = error.response?.status === 403
                ? 'Apenas administradores podem salvar credenciais.'
                : (error.response?.data?.error || error.message);
            toast.error('Erro ao salvar: ' + msg);
        } finally {
            setSavingCreds(false);
        }
    };

    return (
        <div className="p-6 space-y-6">
            <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-500/10 rounded-lg">
                    <Landmark className="h-6 w-6 text-blue-600" />
                </div>
                <h2 className="text-xl font-semibold text-slate-800 dark:text-white">
                    Configuração do Banco Itaú
                </h2>
            </div>

            {/* Status Card */}
            <div className="bg-white dark:bg-slate-800 rounded-xl p-6 shadow-sm border border-slate-200 dark:border-slate-700">
                <h3 className="text-lg font-medium text-slate-800 dark:text-white mb-4">
                    Status da Integração
                </h3>

                {statusLoading ? (
                    <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
                ) : (
                    <div className="flex flex-wrap gap-2">
                        <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium ${status?.hasCertificates
                                ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                                : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                            }`}>
                            {status?.hasCertificates ? <Check className="h-4 w-4" /> : <X className="h-4 w-4" />}
                            {status?.hasCertificates ? 'Certificados OK' : 'Certificados Pendentes'}
                        </span>
                        <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium ${status?.hasCredentials
                                ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                                : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                            }`}>
                            {status?.hasCredentials ? <Check className="h-4 w-4" /> : <X className="h-4 w-4" />}
                            {status?.hasCredentials ? 'Credenciais OK' : 'Credenciais Pendentes'}
                        </span>
                        <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium ${status?.initialized
                                ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                                : 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400'
                            }`}>
                            {status?.initialized ? <Check className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
                            {status?.initialized ? 'Inicializado' : 'Não Inicializado'}
                        </span>
                        <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium ${status?.environment === 'sandbox'
                                ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                                : 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400'
                            }`}>
                            {status?.environment === 'sandbox' ? 'SANDBOX' : 'PRODUÇÃO'}
                        </span>
                    </div>
                )}

                {saldo && (
                    <div className="mt-4 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                        <p className="text-sm text-slate-600 dark:text-slate-400">Saldo Disponível</p>
                        <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                            {formatCurrency(saldo.disponivel)}
                        </p>
                    </div>
                )}
            </div>

            {/* Certificates Card */}
            <div className="bg-white dark:bg-slate-800 rounded-xl p-6 shadow-sm border border-slate-200 dark:border-slate-700">
                <div className="flex items-center gap-2 mb-4">
                    <Key className="h-5 w-5 text-slate-600 dark:text-slate-400" />
                    <h3 className="text-lg font-medium text-slate-800 dark:text-white">
                        Certificados mTLS
                    </h3>
                </div>

                <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4 mb-4">
                    <p className="text-sm text-blue-800 dark:text-blue-300">
                        Os certificados são gerados no portal Itaú for Developers:
                        <br />
                        <strong>https://developer.itau.com.br</strong>
                    </p>
                </div>

                <div className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                            Certificado (.crt ou .pem)
                        </label>
                        <input
                            ref={certInputRef}
                            type="file"
                            accept=".crt,.pem"
                            className="block w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 dark:file:bg-blue-900/30 dark:file:text-blue-400"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                            Chave Privada (.key)
                        </label>
                        <input
                            ref={keyInputRef}
                            type="file"
                            accept=".key"
                            className="block w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 dark:file:bg-blue-900/30 dark:file:text-blue-400"
                        />
                    </div>

                    <button
                        onClick={handleUploadCertificates}
                        disabled={uploadCertificatesLoading}
                        className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50"
                    >
                        {uploadCertificatesLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                        Enviar Certificados
                    </button>

                    {uploadResult && (
                        <div className={`p-3 rounded-lg ${uploadResult.success ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400' : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400'}`}>
                            {uploadResult.message}
                        </div>
                    )}
                </div>
            </div>

            {/* Credentials Card */}
            <div className="bg-white dark:bg-slate-800 rounded-xl p-6 shadow-sm border border-slate-200 dark:border-slate-700">
                <div className="flex items-center gap-2 mb-4">
                    <Link2 className="h-5 w-5 text-slate-600 dark:text-slate-400" />
                    <h3 className="text-lg font-medium text-slate-800 dark:text-white">
                        Credenciais da API
                    </h3>
                </div>

                <div className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                            Client ID
                        </label>
                        <input
                            type="text"
                            value={clientId}
                            onChange={(e) => setClientId(e.target.value)}
                            placeholder="Seu Client ID do Itaú"
                            className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-800 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                            Client Secret
                        </label>
                        <input
                            type="password"
                            value={clientSecret}
                            onChange={(e) => setClientSecret(e.target.value)}
                            placeholder={secretConfigured ? '•••••••• (configurado — deixe em branco p/ manter)' : 'Seu Client Secret'}
                            className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-800 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                                Agência
                            </label>
                            <input
                                type="text"
                                value={agencia}
                                onChange={(e) => setAgencia(e.target.value)}
                                placeholder="0000"
                                className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-800 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                                Conta Corrente
                            </label>
                            <input
                                type="text"
                                value={contaCorrente}
                                onChange={(e) => setContaCorrente(e.target.value)}
                                placeholder="00000-0"
                                className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-800 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                            />
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                            Ambiente
                        </label>
                        <select
                            value={environment}
                            onChange={(e) => setEnvironment(e.target.value as 'sandbox' | 'production')}
                            className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-800 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        >
                            <option value="sandbox">Sandbox (Testes)</option>
                            <option value="production">Produção</option>
                        </select>
                    </div>

                    <div className="bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-700 rounded-lg p-4">
                        <p className="text-sm text-slate-600 dark:text-slate-400">
                            As credenciais são salvas com o <strong>Client Secret criptografado</strong> no backend e
                            aplicadas imediatamente (sem reiniciar).{secretConfigured ? ' ✓ Secret já configurado.' : ''}
                        </p>
                    </div>

                    <button
                        onClick={handleSaveCredentials}
                        disabled={savingCreds}
                        className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50"
                    >
                        {savingCreds ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                        Salvar Credenciais
                    </button>
                </div>
            </div>

            {/* Test Connection Card */}
            <div className="bg-white dark:bg-slate-800 rounded-xl p-6 shadow-sm border border-slate-200 dark:border-slate-700">
                <h3 className="text-lg font-medium text-slate-800 dark:text-white mb-4">
                    Testar Conexão
                </h3>

                <div className="space-y-4">
                    <button
                        onClick={handleTestConnection}
                        disabled={testConnectionLoading}
                        className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50 text-lg"
                    >
                        {testConnectionLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : <RefreshCcw className="h-5 w-5" />}
                        Testar Conexão com o Banco Itaú
                    </button>

                    {testResult && (
                        <div className={`flex items-center gap-2 p-4 rounded-lg ${testResult.success ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400' : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400'}`}>
                            {testResult.success ? <CheckCircle2 className="h-5 w-5" /> : <AlertCircle className="h-5 w-5" />}
                            {testResult.message}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

export default ItauSettingsTab;
