import React, { useState, useCallback, useRef } from 'react';
import { Upload, FileText, X, CheckCircle2, AlertCircle, Loader2, Table, ArrowDownRight, ArrowUpRight } from 'lucide-react';
import { formatDateOnly } from '../../utils/dateUtils';

interface ParsedTransaction {
    id: string;
    date: string;
    amount: number;
    description: string;
    type: 'credit' | 'debit';
}

interface ImportResult {
    accountNumber?: string;
    balance?: number;
    transactionCount: number;
    transactions: ParsedTransaction[];
}

interface BankStatementImportProps {
    onImport: (transactions: ParsedTransaction[], accountId?: string) => void;
    onClose: () => void;
    accountId?: string;
}

const BankStatementImport: React.FC<BankStatementImportProps> = ({ onImport, onClose, accountId }) => {
    const [isDragging, setIsDragging] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [result, setResult] = useState<ImportResult | null>(null);
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleDragOver = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(true);
    }, []);

    const handleDragLeave = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
    }, []);

    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);

        const files = e.dataTransfer.files;
        if (files.length > 0) {
            processFile(files[0]);
        }
    }, []);

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (files && files.length > 0) {
            processFile(files[0]);
        }
    };

    const processFile = async (file: File) => {
        const allowedExtensions = ['.ofx', '.qfx', '.csv', '.txt'];
        const ext = '.' + file.name.split('.').pop()?.toLowerCase();

        if (!allowedExtensions.includes(ext)) {
            setError('Formato não suportado. Use OFX, QFX ou CSV.');
            return;
        }

        setSelectedFile(file);
        setIsLoading(true);
        setError(null);
        setResult(null);

        try {
            const formData = new FormData();
            formData.append('file', file);

            const response = await fetch('/api/banking/import/auto', {
                method: 'POST',
                body: formData,
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'Falha ao processar arquivo');
            }

            setResult({
                accountNumber: data.data.accountNumber,
                balance: data.data.balance,
                transactionCount: data.data.transactionCount,
                transactions: data.data.transactions.map((t: any) => ({
                    ...t,
                    date: formatDateOnly(t.date),
                })),
            });
        } catch (err: any) {
            setError(err.message || 'Erro ao importar arquivo');
        } finally {
            setIsLoading(false);
        }
    };

    const handleConfirmImport = () => {
        if (result) {
            onImport(result.transactions, result.accountNumber);
        }
    };

    const formatCurrency = (value: number) => {
        return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
    };

    return (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col border border-slate-200 dark:border-slate-800 animate-in zoom-in-95">
                {/* Header */}
                <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-slate-50 dark:bg-slate-800/50 rounded-t-xl">
                    <h3 className="font-bold text-lg dark:text-white flex items-center gap-2">
                        <Upload size={20} className="text-indigo-600" />
                        Importar Extrato Bancário
                    </h3>
                    <button onClick={onClose} className="p-1 hover:bg-slate-200 dark:hover:bg-slate-700 rounded">
                        <X size={20} />
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-6">
                    {!result ? (
                        <>
                            {/* Drop Zone */}
                            <div
                                onDragOver={handleDragOver}
                                onDragLeave={handleDragLeave}
                                onDrop={handleDrop}
                                onClick={() => fileInputRef.current?.click()}
                                className={`border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-all ${isDragging
                                    ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20'
                                    : 'border-slate-300 dark:border-slate-700 hover:border-indigo-400 hover:bg-slate-50 dark:hover:bg-slate-800/50'
                                    }`}
                            >
                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    accept=".ofx,.qfx,.csv,.txt"
                                    onChange={handleFileSelect}
                                    className="hidden"
                                />

                                {isLoading ? (
                                    <div className="flex flex-col items-center gap-3">
                                        <Loader2 className="w-12 h-12 text-indigo-600 animate-spin" />
                                        <p className="text-slate-600 dark:text-slate-400">Processando arquivo...</p>
                                    </div>
                                ) : (
                                    <div className="flex flex-col items-center gap-3">
                                        <div className="w-16 h-16 bg-indigo-100 dark:bg-indigo-900/30 rounded-full flex items-center justify-center">
                                            <FileText className="w-8 h-8 text-indigo-600 dark:text-indigo-400" />
                                        </div>
                                        <div>
                                            <p className="text-slate-700 dark:text-slate-300 font-medium">
                                                {selectedFile ? selectedFile.name : 'Arraste o arquivo aqui ou clique para selecionar'}
                                            </p>
                                            <p className="text-sm text-slate-500 mt-1">
                                                Formatos suportados: OFX, QFX, CSV
                                            </p>
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* Error Message */}
                            {error && (
                                <div className="mt-4 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg flex items-center gap-3">
                                    <AlertCircle className="text-red-500" size={20} />
                                    <p className="text-red-700 dark:text-red-400">{error}</p>
                                </div>
                            )}

                            {/* Instructions */}
                            <div className="mt-6 p-4 bg-slate-50 dark:bg-slate-800/50 rounded-lg">
                                <h4 className="font-medium text-slate-700 dark:text-slate-300 mb-2">Como exportar seu extrato:</h4>
                                <ul className="text-sm text-slate-600 dark:text-slate-400 space-y-1">
                                    <li>• <strong>Banco do Brasil:</strong> Internet Banking → Conta Corrente → Extrato → Exportar OFX</li>
                                    <li>• <strong>Itaú:</strong> Extratos → Exportar → Formato OFX</li>
                                    <li>• <strong>Bradesco:</strong> Extrato → Exportar → OFX/QFX</li>
                                    <li>• <strong>Nubank:</strong> App → Extrato → Exportar CSV</li>
                                </ul>
                            </div>
                        </>
                    ) : (
                        <>
                            {/* Success Summary */}
                            <div className="p-4 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-lg flex items-center gap-3 mb-4">
                                <CheckCircle2 className="text-emerald-500" size={24} />
                                <div>
                                    <p className="font-medium text-emerald-700 dark:text-emerald-400">
                                        Arquivo processado com sucesso!
                                    </p>
                                    <p className="text-sm text-emerald-600 dark:text-emerald-500">
                                        {result.transactionCount} transações encontradas
                                        {result.balance !== undefined && ` • Saldo: ${formatCurrency(result.balance)}`}
                                    </p>
                                </div>
                            </div>

                            {/* Transactions Preview */}
                            <div className="border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden">
                                <div className="bg-slate-50 dark:bg-slate-800 p-3 border-b border-slate-200 dark:border-slate-700 flex items-center gap-2">
                                    <Table size={16} className="text-slate-500" />
                                    <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                                        Preview das Transações (mostrando até 20)
                                    </span>
                                </div>
                                <div className="max-h-64 overflow-y-auto">
                                    {result.transactions.slice(0, 20).map((t, i) => (
                                        <div
                                            key={t.id}
                                            className={`p-3 flex items-center justify-between border-b border-slate-100 dark:border-slate-800 last:border-b-0 ${i % 2 === 0 ? 'bg-white dark:bg-slate-900' : 'bg-slate-50/50 dark:bg-slate-800/30'
                                                }`}
                                        >
                                            <div className="flex items-center gap-3">
                                                <div className={`p-1.5 rounded-full ${t.type === 'credit'
                                                    ? 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400'
                                                    : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
                                                    }`}>
                                                    {t.type === 'credit' ? <ArrowDownRight size={14} /> : <ArrowUpRight size={14} />}
                                                </div>
                                                <div>
                                                    <p className="text-sm font-medium text-slate-700 dark:text-slate-300 truncate max-w-xs">
                                                        {t.description}
                                                    </p>
                                                    <p className="text-xs text-slate-500">{t.date}</p>
                                                </div>
                                            </div>
                                            <span className={`font-bold text-sm ${t.type === 'credit' ? 'text-emerald-600' : 'text-slate-700 dark:text-slate-300'
                                                }`}>
                                                {t.type === 'credit' ? '+' : '-'}{formatCurrency(t.amount)}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </>
                    )}
                </div>

                {/* Footer */}
                <div className="p-4 border-t border-slate-100 dark:border-slate-800 flex justify-end gap-3">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-slate-600 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 font-medium"
                    >
                        Cancelar
                    </button>
                    {result && (
                        <button
                            onClick={handleConfirmImport}
                            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium shadow-sm flex items-center gap-2"
                        >
                            <CheckCircle2 size={16} />
                            Importar {result.transactionCount} Transações
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

export default BankStatementImport;
