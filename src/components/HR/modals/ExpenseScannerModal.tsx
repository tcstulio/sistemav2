import React, { useState, useRef } from 'react';
import { DolibarrConfig, DolibarrUser } from '../../../types';
import { DolibarrService } from '../../../services/dolibarrService';
import { AiService } from '../../../services/aiService';
import { Scan, Upload, Loader2, CheckCircle, Info, X, Save } from 'lucide-react';

interface ExpenseScannerModalProps {
    isOpen: boolean;
    onClose: () => void;
    config: DolibarrConfig;
    currentUser?: DolibarrUser | null;
    users: DolibarrUser[];
    onRefresh?: () => void;
}

export const ExpenseScannerModal: React.FC<ExpenseScannerModalProps> = ({
    isOpen,
    onClose,
    config,
    currentUser,
    users,
    onRefresh
}) => {
    const [scannedData, setScannedData] = useState<{ vendor: string, date: string, amount: number, description: string } | null>(null);
    const [initialScannedDataStr, setInitialScannedDataStr] = useState<string>(''); // To detect changes
    const [scannedLogId, setScannedLogId] = useState<string | null>(null);
    const [scannedFile, setScannedFile] = useState<File | null>(null);
    const [isSavingExpense, setIsSavingExpense] = useState(false);
    const [isScanning, setIsScanning] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleFileScan = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setScannedFile(file); // Save for upload

        setIsScanning(true);
        const reader = new FileReader();
        reader.onloadend = async () => {
            const base64String = reader.result as string;
            const base64Data = base64String.split(',')[1];
            try {
                const result = await AiService.extractReceiptData(base64Data);
                if (result && result.text) {
                    const data = JSON.parse(result.text);
                    setScannedData(data);
                    setInitialScannedDataStr(JSON.stringify(data)); // Snapshot
                    setScannedLogId(result.logId); // Track log ID
                }
            } catch (err) { console.error(err); } finally { setIsScanning(false); }
        };
        reader.readAsDataURL(file);
    };

    const handleSaveExpense = async () => {
        if (!scannedData) return;
        setIsSavingExpense(true);

        // Check if user corrected the AI data
        if (scannedLogId && scannedData) {
            const currentDataStr = JSON.stringify(scannedData);
            if (currentDataStr !== initialScannedDataStr) {
                // Log the correction!
                AiService.logCorrection(scannedLogId, currentDataStr);
            }
        }

        try {
            // Use ID from currentUser if available, or fallback to first user (Admin usually) if lists loaded, or '1' strict fallback
            const userId = currentUser?.id || users[0]?.id || '1';
            const expenseDate = scannedData.date ? new Date(scannedData.date).getTime() / 1000 : Date.now() / 1000;

            const expensePayload = {
                fk_user_author: userId,
                date_debut: expenseDate,
                date_fin: expenseDate,
                note_public: `${scannedData.description} (Vendor: ${scannedData.vendor})`,
                total_ttc: scannedData.amount,
            };

            const result = await DolibarrService.createExpenseReport(config, expensePayload);

            if (scannedFile && result) {
                if (result.id) {
                    await DolibarrService.uploadDocument(config, scannedFile, 'expensereport', result.ref);
                }
            }

            alert("Despesa Salva e Recibo Anexado!");
            onClose();
            setScannedData(null);
            setScannedLogId(null);
            setScannedFile(null);
            if (onRefresh) onRefresh();

        } catch (e) {
            console.error("Failed to save expense", e);
            alert("Falha ao salvar relatório de despesas.");
        } finally {
            setIsSavingExpense(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-white dark:bg-slate-900 rounded-xl p-6 w-full max-w-md shadow-2xl">
                <div className="flex justify-between items-center mb-4">
                    <h3 className="font-bold text-lg dark:text-white flex items-center gap-2"><Scan size={20} className="text-indigo-500" /> Escanear & Verificar</h3>
                    <button onClick={onClose}><X size={20} /></button>
                </div>

                {!scannedData ? (
                    <div className="border-2 border-dashed border-slate-300 dark:border-slate-700 p-8 text-center cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors rounded-xl" onClick={() => fileInputRef.current?.click()}>
                        {isScanning ? <Loader2 className="animate-spin mx-auto text-indigo-500" size={32} /> : <Upload className="mx-auto text-slate-400" size={32} />}
                        <p className="mt-4 text-sm text-slate-500 font-medium">Clique para enviar imagem do recibo</p>
                        <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleFileScan} />
                    </div>
                ) : (
                    <div className="space-y-4">
                        <div className="bg-indigo-50 dark:bg-indigo-900/20 p-3 rounded-lg text-xs text-indigo-800 dark:text-indigo-200 flex items-start gap-2">
                            <Info size={14} className="shrink-0 mt-0.5" />
                            Verifique os dados extraídos pela IA abaixo. Corrija quaisquer erros antes de salvar para ajudar o sistema a melhorar.
                        </div>

                        <div>
                            <label className="text-xs font-bold text-slate-500 uppercase">Fornecedor</label>
                            <input
                                className="w-full p-2 border rounded dark:bg-slate-800 dark:border-slate-700 dark:text-white"
                                value={scannedData.vendor}
                                onChange={(e) => setScannedData({ ...scannedData, vendor: e.target.value })}
                            />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="text-xs font-bold text-slate-500 uppercase">Data</label>
                                <input
                                    className="w-full p-2 border rounded dark:bg-slate-800 dark:border-slate-700 dark:text-white"
                                    value={scannedData.date}
                                    onChange={(e) => setScannedData({ ...scannedData, date: e.target.value })}
                                />
                            </div>
                            <div>
                                <label className="text-xs font-bold text-slate-500 uppercase">Valor</label>
                                <input
                                    type="number"
                                    className="w-full p-2 border rounded dark:bg-slate-800 dark:border-slate-700 dark:text-white font-bold text-indigo-600"
                                    value={scannedData.amount}
                                    onChange={(e) => setScannedData({ ...scannedData, amount: parseFloat(e.target.value) })}
                                />
                            </div>
                        </div>
                        <div>
                            <label className="text-xs font-bold text-slate-500 uppercase">Descrição</label>
                            <textarea
                                className="w-full p-2 border rounded dark:bg-slate-800 dark:border-slate-700 dark:text-white"
                                value={scannedData.description}
                                onChange={(e) => setScannedData({ ...scannedData, description: e.target.value })}
                            />
                        </div>

                        <div className="flex justify-end gap-2 pt-2">
                            <button onClick={() => setScannedData(null)} className="px-4 py-2 text-slate-500 hover:text-slate-700">Re-escanear</button>
                            <button onClick={handleSaveExpense} disabled={isSavingExpense} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded font-medium flex items-center gap-2">
                                {isSavingExpense ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} Salvar Despesa
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};
