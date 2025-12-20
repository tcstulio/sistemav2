
import React, { useState } from 'react';
import { Code, Loader2 } from 'lucide-react';
import { AiService } from '../../services/aiService';

export const CodegenTab: React.FC = () => {
    const [genEndpoint, setGenEndpoint] = useState('products');
    const [genMethod, setGenMethod] = useState('POST');
    const [genDesc, setGenDesc] = useState('Create a new product with stock management enabled');
    const [genResult, setGenResult] = useState('');
    const [isGeneratingCode, setIsGeneratingCode] = useState(false);

    const handleGenerateCode = async () => {
        setIsGeneratingCode(true);
        try {
            const code = await AiService.generateServiceCode(genEndpoint, genMethod, genDesc);
            setGenResult(code);
        } catch (e: any) {
            setGenResult(`// Erro: ${e.message}`);
        } finally {
            setIsGeneratingCode(false);
        }
    };

    return (
        <div className="flex h-full">
            <div className="w-1/3 border-r border-slate-200 dark:border-slate-800 p-4 bg-white dark:bg-slate-900">
                <h3 className="font-bold mb-4 dark:text-white">Gerador de Código de Serviço</h3>
                <div className="space-y-4">
                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Endpoint</label>
                        <input className="w-full p-2 border rounded dark:bg-slate-800 dark:border-slate-700 dark:text-white" value={genEndpoint} onChange={e => setGenEndpoint(e.target.value)} />
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Método</label>
                        <select className="w-full p-2 border rounded dark:bg-slate-800 dark:border-slate-700 dark:text-white" value={genMethod} onChange={e => setGenMethod(e.target.value)}>
                            <option value="GET">GET</option>
                            <option value="POST">POST</option>
                            <option value="PUT">PUT</option>
                            <option value="DELETE">DELETE</option>
                        </select>
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Descrição</label>
                        <textarea className="w-full p-2 border rounded dark:bg-slate-800 dark:border-slate-700 dark:text-white h-24" value={genDesc} onChange={e => setGenDesc(e.target.value)} placeholder="Descreva o que esta função deve fazer..." />
                    </div>
                    <button onClick={handleGenerateCode} disabled={isGeneratingCode} className="w-full bg-violet-600 text-white py-2 rounded font-bold flex items-center justify-center gap-2 hover:bg-violet-700 disabled:opacity-50">
                        {isGeneratingCode ? <Loader2 className="animate-spin" size={16} /> : <Code size={16} />} Gerar TypeScript
                    </button>
                </div>
            </div>
            <div className="flex-1 p-4 bg-slate-50 dark:bg-slate-950/50 overflow-y-auto">
                <h3 className="font-bold mb-4 dark:text-white">Código Gerado</h3>
                <div className="bg-slate-900 text-purple-300 p-4 rounded-lg font-mono text-xs whitespace-pre-wrap shadow-inner border border-slate-700 h-[calc(100%-3rem)] overflow-auto">
                    {genResult || "// O código gerado aparecerá aqui..."}
                </div>
            </div>
        </div>
    );
};
