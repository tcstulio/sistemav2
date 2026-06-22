
import React from 'react';
import { FileText, X, Printer, Download } from 'lucide-react';
import { ExtratoItem } from '../../types';
import { money } from '../../utils';

interface Props {
    dados: ExtratoItem[];
    onClose: () => void;
}

const ExtratoDetalhado: React.FC<Props> = ({ dados, onClose }) => {
    if (!dados) return null;
    // Filter out informational items for the total sum
    const totalOp = dados
        .filter(d => d.tipo !== 'informativo')
        .reduce((a, b) => a + b.valor, 0);

    const handlePrint = () => {
        window.print();
    };

    return (
        <div className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white dark:bg-slate-800 rounded-xl w-full max-w-md shadow-2xl flex flex-col max-h-[90vh] ring-1 ring-gray-200 dark:ring-slate-700 print-area">
                <div className="flex justify-between items-center p-4 border-b border-gray-100 dark:border-slate-700">
                    <h3 className="font-bold text-gray-800 dark:text-slate-100 flex items-center gap-2 text-lg">
                        <FileText size={20} className="text-indigo-600" /> Extrato Financeiro (DRE)
                    </h3>
                    <div className="flex gap-2 no-print">
                        <button
                            onClick={handlePrint}
                            className="p-2 text-gray-500 dark:text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-slate-700 rounded-lg transition-colors flex items-center gap-1"
                            title="Imprimir ou Salvar como PDF"
                        >
                            <Printer size={18} />
                        </button>
                        <button onClick={onClose} className="text-gray-400 dark:text-slate-500 hover:text-gray-700 dark:hover:text-slate-200 transition-colors p-2 hover:bg-gray-100 dark:hover:bg-slate-700 rounded-lg">
                            <X size={20} />
                        </button>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto p-6 space-y-1 text-sm bg-white dark:bg-slate-800">
                    <div className="mb-4 pb-4 border-b border-gray-100 hidden print:block">
                        <h1 className="text-2xl font-bold text-gray-900">Simulador CoolGroove</h1>
                        <p className="text-sm text-gray-500">Relatório Gerencial de Evento</p>
                        <p className="text-xs text-gray-400 mt-1">Gerado em {new Date().toLocaleDateString()}</p>
                    </div>

                    {dados.map((item, idx) => {
                        const isInformativo = item.tipo === 'informativo';
                        return (
                            <div
                                key={idx}
                                className={`flex justify-between py-2.5 px-2 border-b border-gray-50 ${isInformativo
                                        ? 'text-gray-400 italic text-xs'
                                        : item.tipo === 'deducao' || item.tipo === 'custo'
                                            ? 'text-rose-600 font-medium'
                                            : 'text-slate-700 font-medium'
                                    }`}
                            >
                                <span>{item.item}</span>
                                <span className="font-mono">{money(item.valor)}</span>
                            </div>
                        );
                    })}

                    <div className="border-t-2 border-slate-900 mt-6 pt-4 flex justify-between font-bold text-xl px-2">
                        <span>Resultado Operacional</span>
                        <span className={totalOp >= 0 ? 'text-emerald-600' : 'text-rose-600'}>{money(totalOp)}</span>
                    </div>

                    <div className="mt-8 p-4 bg-gray-50 rounded-lg border border-gray-100 print:bg-transparent print:border-gray-200">
                        <p className="text-xs text-center text-gray-500 leading-relaxed">
                            *Este documento é uma simulação financeira. <br />
                            Itens em cinza são apenas referência bruta e não somam no resultado final (que considera apenas entradas e saídas do caixa da casa).
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ExtratoDetalhado;
