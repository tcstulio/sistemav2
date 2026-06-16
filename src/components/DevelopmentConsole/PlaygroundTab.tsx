
import React, { useState } from 'react';
import { Play, Loader2 } from 'lucide-react';
import { DolibarrService } from '../../services/dolibarrService';
import { DolibarrConfig } from '../../types';
import { toast } from 'sonner';

interface PlaygroundTabProps {
    config: DolibarrConfig;
    onSuccess?: () => void; // Callback to refresh logs after request
}

export const PlaygroundTab: React.FC<PlaygroundTabProps> = ({ config, onSuccess }) => {
    const [playMethod, setPlayMethod] = useState<'GET' | 'POST' | 'PUT' | 'DELETE'>('GET');
    const [playEndpoint, setPlayEndpoint] = useState('status');
    const [playBody, setPlayBody] = useState('');
    const [playResponse, setPlayResponse] = useState<string | null>(null);
    const [isPlayLoading, setIsPlayLoading] = useState(false);

    const handlePlaygroundSend = async () => {
        setIsPlayLoading(true);
        setPlayResponse(null);
        try {
            const url = `${DolibarrService.sanitizeUrl(config.apiUrl)}/${playEndpoint.replace(/^\//, '')}`;
            const options: RequestInit = {
                method: playMethod,
                headers: {
                    ...DolibarrService.getHeaders(config.apiKey),
                    'Content-Type': 'application/json'
                }
            };

            if (['POST', 'PUT'].includes(playMethod) && playBody) {
                try {
                    JSON.parse(playBody); // Validate JSON
                    options.body = playBody;
                } catch (e) {
                    toast.error("JSON Inválido");
                    setIsPlayLoading(false);
                    return;
                }
            }

            const res = await DolibarrService.request(url, options);
            setPlayResponse(JSON.stringify(res, null, 2));
            if (onSuccess) onSuccess();
        } catch (e: any) {
            setPlayResponse(`Erro: ${e.message}`);
            if (onSuccess) onSuccess(); // Refresh logs even on error
        } finally {
            setIsPlayLoading(false);
        }
    };

    return (
        <div className="flex h-full">
            <div className="w-1/3 border-r border-slate-200 dark:border-slate-800 p-4 bg-white dark:bg-slate-900 overflow-y-auto">
                <h3 className="font-bold mb-4 dark:text-white">Construtor de Requisição</h3>
                <div className="space-y-4">
                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Método</label>
                        <select className="w-full p-2 border rounded dark:bg-slate-800 dark:border-slate-700 dark:text-white" value={playMethod} onChange={e => setPlayMethod(e.target.value as any)}>
                            <option value="GET">GET</option>
                            <option value="POST">POST</option>
                            <option value="PUT">PUT</option>
                            <option value="DELETE">DELETE</option>
                        </select>
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Endpoint</label>
                        <input className="w-full p-2 border rounded dark:bg-slate-800 dark:border-slate-700 dark:text-white" value={playEndpoint} onChange={e => setPlayEndpoint(e.target.value)} />
                    </div>
                    {['POST', 'PUT'].includes(playMethod) && (
                        <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Corpo JSON</label>
                            <textarea className="w-full p-2 border rounded dark:bg-slate-800 dark:border-slate-700 dark:text-white h-40 font-mono text-xs" value={playBody} onChange={e => setPlayBody(e.target.value)} placeholder="{...}" />
                        </div>
                    )}
                    <button onClick={handlePlaygroundSend} disabled={isPlayLoading} className="w-full bg-indigo-600 text-white py-2 rounded font-bold flex items-center justify-center gap-2 hover:bg-indigo-700 disabled:opacity-50">
                        {isPlayLoading ? <Loader2 className="animate-spin" size={16} /> : <Play size={16} />} Enviar Requisição
                    </button>
                </div>
            </div>
            <div className="flex-1 p-4 bg-slate-50 dark:bg-slate-950/50 overflow-y-auto">
                <h3 className="font-bold mb-4 dark:text-white">Resposta</h3>
                {playResponse ? (
                    <div className="bg-slate-900 text-green-400 p-4 rounded-lg font-mono text-xs whitespace-pre-wrap shadow-inner border border-slate-700">
                        {playResponse}
                    </div>
                ) : (
                    <div className="text-center py-20 text-slate-400 border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-lg">
                        Resposta aparecerá aqui...
                    </div>
                )}
            </div>
        </div>
    );
};
