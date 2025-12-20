import React, { useState, useRef } from 'react';
import { Camera, Upload, X, Loader2, Check, FileText } from 'lucide-react';
import { AiService } from '../../services/aiService';
import { toast } from 'sonner';

interface ReceiptScannerProps {
    onScanComplete: (data: any) => void;
    onClose: () => void;
}

export const ReceiptScanner: React.FC<ReceiptScannerProps> = ({ onScanComplete, onClose }) => {
    const [isScanning, setIsScanning] = useState(false);
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        // Preview
        const reader = new FileReader();
        reader.onloadend = () => {
            const base64 = reader.result as string;
            setPreviewUrl(base64);
            processImage(base64);
        };
        reader.readAsDataURL(file);
    };

    const processImage = async (base64: string) => {
        setIsScanning(true);
        try {
            const result = await AiService.extractReceiptData(base64);
            if (result) {
                onScanComplete(result);
                toast.success("Recibo processado com sucesso!");
            } else {
                toast.error("Não foi possível extrair dados do recibo.");
                setPreviewUrl(null);
            }
        } catch (error) {
            console.error(error);
            toast.error("Erro ao processar imagem.");
            setPreviewUrl(null);
        } finally {
            setIsScanning(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in">
            <div className="bg-white dark:bg-slate-900 rounded-xl max-w-md w-full overflow-hidden shadow-2xl border border-slate-200 dark:border-slate-800">
                <div className="p-4 bg-slate-50 dark:bg-slate-800/50 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center">
                    <h3 className="font-bold text-lg flex items-center gap-2 dark:text-white">
                        <Camera size={20} className="text-indigo-600" />
                        Digitalizar Recibo
                    </h3>
                    <button onClick={onClose} className="p-1 hover:bg-slate-200 dark:hover:bg-slate-700 rounded transition-colors text-slate-500">
                        <X size={20} />
                    </button>
                </div>

                <div className="p-8 flex flex-col items-center justify-center gap-6 min-h-[300px]">
                    {isScanning ? (
                        <div className="flex flex-col items-center gap-4 text-center">
                            <div className="relative">
                                <div className="absolute inset-0 bg-indigo-500 blur-xl opacity-20 animate-pulse rounded-full"></div>
                                <Loader2 size={48} className="text-indigo-600 animate-spin relative z-10" />
                            </div>
                            <div className="space-y-1">
                                <h4 className="font-bold text-slate-800 dark:text-white">Analisando Imagem...</h4>
                                <p className="text-sm text-slate-500 dark:text-slate-400">A IA está extraindo os dados do recibo.</p>
                            </div>
                            {previewUrl && (
                                <img src={previewUrl} alt="Preview" className="w-32 h-32 object-cover rounded-lg opacity-50 border-2 border-dashed border-indigo-300" />
                            )}
                        </div>
                    ) : (
                        <>
                            <div className="w-20 h-20 bg-indigo-50 dark:bg-indigo-900/20 rounded-full flex items-center justify-center mb-2">
                                <FileText size={32} className="text-indigo-600 dark:text-indigo-400" />
                            </div>

                            <div className="text-center space-y-2">
                                <h4 className="font-bold text-slate-800 dark:text-white text-lg">Envie uma foto</h4>
                                <p className="text-sm text-slate-500 dark:text-slate-400 max-w-[250px] mx-auto">
                                    Tire uma foto clara do recibo ou fatura para preenchimento automático.
                                </p>
                            </div>

                            <div className="grid grid-cols-2 gap-3 w-full mt-2">
                                <input
                                    type="file"
                                    accept="image/*"
                                    className="hidden"
                                    ref={fileInputRef}
                                    onChange={handleFileChange}
                                />
                                <button
                                    onClick={() => fileInputRef.current?.click()}
                                    className="flex flex-col items-center justify-center gap-2 p-4 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-xl transition-all border-2 border-transparent hover:border-indigo-500 group"
                                >
                                    <Upload size={24} className="text-slate-600 dark:text-slate-300 group-hover:scale-110 transition-transform" />
                                    <span className="font-bold text-sm text-slate-700 dark:text-slate-200">Galeria</span>
                                </button>
                                <button
                                    onClick={() => fileInputRef.current?.click()} // For Mobile, capturing from camera is usually same input with capture
                                    className="flex flex-col items-center justify-center gap-2 p-4 bg-indigo-600 hover:bg-indigo-700 rounded-xl transition-all shadow-lg shadow-indigo-200 dark:shadow-none group"
                                >
                                    <Camera size={24} className="text-white group-hover:scale-110 transition-transform" />
                                    <span className="font-bold text-sm text-white">Câmera</span>
                                </button>
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
};
