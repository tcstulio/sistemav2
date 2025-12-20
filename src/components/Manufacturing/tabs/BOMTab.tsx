import React, { useMemo } from 'react';
import { BOM, DolibarrConfig, Product } from '../../../types';
import { Layers } from 'lucide-react';
import { getProductName } from '../utils';

interface BOMTabProps {
    boms: BOM[];
    products: Product[];
    searchTerm: string;
    config: DolibarrConfig;
    selectedBOMId?: string;
    onSelectBOM: (bom: BOM) => void;
}

export const BOMTab: React.FC<BOMTabProps> = ({
    boms,
    products,
    searchTerm,
    config,
    selectedBOMId,
    onSelectBOM
}) => {
    const filteredBOMs = boms.filter(b =>
        b.ref.toLowerCase().includes(searchTerm.toLowerCase()) ||
        b.label.toLowerCase().includes(searchTerm.toLowerCase())
    );

    if (filteredBOMs.length === 0) {
        return (
            <div className="text-center py-20 text-slate-400">
                <Layers size={48} className="mx-auto mb-4 opacity-50" />
                <p>Nenhuma BOM encontrada.</p>
            </div>
        );
    }

    return (
        <div className="grid gap-4">
            {filteredBOMs.map(bom => (
                <div
                    key={bom.id}
                    onClick={() => onSelectBOM(bom)}
                    className={`bg-white dark:bg-slate-900 p-5 rounded-xl border transition-all cursor-pointer ${selectedBOMId === bom.id ? `border-${config.themeColor}-500 bg-${config.themeColor}-50 dark:bg-${config.themeColor}-900/20` : 'border-slate-200 dark:border-slate-800 hover:shadow-md'}`}
                >
                    <div className="flex justify-between items-start mb-2">
                        <h4 className="font-bold text-slate-800 dark:text-white">{bom.ref}</h4>
                        <span className="text-xs bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded">{bom.status === '1' ? 'Ativo' : 'Rascunho'}</span>
                    </div>
                    <div className="text-sm text-slate-600 dark:text-slate-300 mb-2">{bom.label}</div>
                    <div className="bg-slate-50 dark:bg-slate-800/50 p-3 rounded text-sm text-slate-700 dark:text-slate-300 border border-slate-100 dark:border-slate-700">
                        Produz: <strong className="cursor-pointer hover:text-indigo-600 dark:hover:text-indigo-400">
                            {getProductName(bom.product_id, products)}
                        </strong> (x{bom.qty})
                    </div>
                    <div className="mt-3 text-xs text-slate-500">Duração: {bom.duration}s</div>
                </div>
            ))}
        </div>
    );
};
