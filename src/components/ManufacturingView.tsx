import React, { useState, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { usePrefill, PrefillResult } from '../hooks/usePrefill';
import { ManufacturingOrder, BOM, AppView } from '../types';
import { Factory, Search, Plus, List, Layers, Loader2 } from 'lucide-react';
import { DolibarrService } from '../services/dolibarrService';
import { useDolibarr } from '../context/DolibarrContext';
import { useManufacturingOrders, useBOMs, useProjects, useProducts, useStockMovements, useWarehouses } from '../hooks/dolibarr';
import { ManufacturingOrdersTab } from './Manufacturing/tabs/ManufacturingOrdersTab';
import { BOMTab } from './Manufacturing/tabs/BOMTab';
import { CreateMOModal } from './Manufacturing/modals/CreateMOModal';
import { CreateBOMModal } from './Manufacturing/modals/CreateBOMModal';
import { ConsumeModal } from './Manufacturing/modals/ConsumeModal';
import { ProduceModal } from './Manufacturing/modals/ProduceModal';
import { ManufacturingOrderDetail } from './Manufacturing/details/ManufacturingOrderDetail';
import { BOMDetail } from './Manufacturing/details/BOMDetail';
import { logger } from '../utils/logger';

const log = logger.child('ManufacturingView');

interface ManufacturingViewProps {
    onNavigate?: (view: AppView, id: string) => void;
}

const ManufacturingView: React.FC<ManufacturingViewProps> = ({ onNavigate }) => {
    const { config, refreshData } = useDolibarr();

    // Data Hooks
    const { data: orders = [], isLoading: isLoadingOrders, refetch: refetchOrders } = useManufacturingOrders(config || null, !!config);
    const { data: boms = [], isLoading: isLoadingBOMs, refetch: refetchBoms } = useBOMs(config || null, !!config);
    const { data: projects = [], isLoading: isLoadingProjects } = useProjects(config || null, !!config);
    const { data: products = [], isLoading: isLoadingProducts } = useProducts(config || null, !!config);
    const { data: stockMovements = [], isLoading: isLoadingMovements } = useStockMovements(config || null, !!config);
    const { data: warehouses = [], isLoading: isLoadingWarehouses } = useWarehouses(config || null, !!config);

    const loading = isLoadingOrders || isLoadingBOMs || isLoadingProjects || isLoadingProducts || isLoadingMovements || isLoadingWarehouses;

    const [searchTerm, setSearchTerm] = useState('');
    const [activeTab, setActiveTab] = useState<'mo' | 'bom'>('mo');

    // Selection State
    const [selectedMO, setSelectedMO] = useState<ManufacturingOrder | null>(null);
    const [selectedBOM, setSelectedBOM] = useState<BOM | null>(null);

    // Create MO State
    const [isMoModalOpen, setIsMoModalOpen] = useState(false);

    // Create BOM State
    const [isBomModalOpen, setIsBomModalOpen] = useState(false);

    // Deeplink HITL do agente (#57/#78): create_mo / create_bom abrem o modal pré-preenchido.
    const prefill = usePrefill();
    const appliedPrefillRef = useRef<PrefillResult | null>(null);
    const [moPrefill, setMoPrefill] = useState<Record<string, string> | undefined>(undefined);
    const [bomPrefill, setBomPrefill] = useState<Record<string, string> | undefined>(undefined);
    useEffect(() => {
        if (!prefill || appliedPrefillRef.current === prefill) return;
        if (prefill.kind === 'create_mo') {
            appliedPrefillRef.current = prefill;
            setMoPrefill(prefill.data);
            setActiveTab('mo');
            setIsMoModalOpen(true);
            toast.info('Revise os dados e confirme a criação da ordem de produção.');
        } else if (prefill.kind === 'create_bom') {
            appliedPrefillRef.current = prefill;
            setBomPrefill(prefill.data);
            setActiveTab('bom');
            setIsBomModalOpen(true);
            toast.info('Revise os dados e confirme a criação da BOM.');
        }
    }, [prefill]);

    // Execution State (Consumption/Production)
    const [isConsumeModalOpen, setIsConsumeModalOpen] = useState(false);
    const [isProduceModalOpen, setIsProduceModalOpen] = useState(false);

    // Fetch full BOM details when selected
    useEffect(() => {
        const fetchBOMDetail = async () => {
            if (config && selectedBOM && (!selectedBOM.lines || selectedBOM.lines.length === 0)) {
                try {
                    const fullBOM = await DolibarrService.getBOM(config, selectedBOM.id);
                    if (fullBOM) {
                        setSelectedBOM(fullBOM);
                    }
                } catch (e) {
                    log.error("Error fetching full BOM", e);
                }
            }
        };

        if (selectedBOM) {
            fetchBOMDetail();
        }
    }, [selectedBOM?.id, config]);

    const handleRefresh = async () => {
        // Trigger both local refetches and global data refresh if needed
        await Promise.all([
            refetchOrders(),
            refetchBoms(),
            refreshData()
        ]);
    };

    if (!config) {
        return (
            <div className="flex items-center justify-center p-20 text-slate-400">
                <p>Carregando configurações...</p>
            </div>
        )
    }

    return (
        <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-950 transition-colors relative">

            {/* Modals */}
            <CreateMOModal
                isOpen={isMoModalOpen}
                onClose={() => { setIsMoModalOpen(false); setMoPrefill(undefined); }}
                config={config}
                products={products}
                projects={projects}
                onSuccess={handleRefresh}
                initialForm={moPrefill}
            />
            <CreateBOMModal
                isOpen={isBomModalOpen}
                onClose={() => { setIsBomModalOpen(false); setBomPrefill(undefined); }}
                config={config}
                products={products}
                onSuccess={handleRefresh}
                initialForm={bomPrefill}
            />
            <ConsumeModal
                isOpen={isConsumeModalOpen}
                onClose={() => setIsConsumeModalOpen(false)}
                config={config}
                products={products}
                warehouses={warehouses}
                selectedMORef={selectedMO?.ref || ''}
                onNavigate={onNavigate}
            />
            <ProduceModal
                isOpen={isProduceModalOpen}
                onClose={() => setIsProduceModalOpen(false)}
                config={config}
                warehouses={warehouses}
                selectedMO={selectedMO}
                onNavigate={onNavigate}
            />

            {/* Header */}
            <div className={`p-4 md:p-6 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex-none ${(selectedMO || selectedBOM) ? 'hidden lg:block' : 'block'}`}>
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4">
                    <div>
                        <h2 className="text-2xl font-bold text-slate-800 dark:text-white flex items-center gap-2">
                            <Factory className="text-orange-500" /> Produção (MRP)
                        </h2>
                        <p className="text-sm text-slate-500 dark:text-slate-400">Gerencie ordens de produção e BOMs</p>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                            <input
                                type="text"
                                placeholder={activeTab === 'mo' ? "Buscar MO..." : "Buscar BOM..."}
                                className="pl-10 pr-4 py-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white w-64"
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                            />
                        </div>
                        {activeTab === 'mo' ? (
                            <button onClick={() => setIsMoModalOpen(true)} className="flex items-center gap-1.5 px-3 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-lg text-sm font-medium transition-colors">
                                <Plus size={18} /> Nova MO
                            </button>
                        ) : (
                            <button onClick={() => setIsBomModalOpen(true)} className="flex items-center gap-1.5 px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium transition-colors">
                                <Plus size={18} /> Nova BOM
                            </button>
                        )}
                    </div>
                </div>

                <div className="flex gap-2 border-b border-slate-100 dark:border-slate-800">
                    <button onClick={() => { setActiveTab('mo'); setSelectedBOM(null); }} className={`pb-2 px-3 text-sm font-medium transition-colors border-b-2 flex items-center gap-2 ${activeTab === 'mo' ? `border-${config.themeColor}-600 text-${config.themeColor}-600 dark:text-${config.themeColor}-400 dark:border-${config.themeColor}-400` : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}>
                        <List size={16} /> Ordens de Produção
                    </button>
                    <button onClick={() => { setActiveTab('bom'); setSelectedMO(null); }} className={`pb-2 px-3 text-sm font-medium transition-colors border-b-2 flex items-center gap-2 ${activeTab === 'bom' ? `border-${config.themeColor}-600 text-${config.themeColor}-600 dark:text-${config.themeColor}-400 dark:border-${config.themeColor}-400` : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}>
                        <Layers size={16} /> Listas de Materiais (BOM)
                    </button>
                </div>
            </div>

            {/* Content */}
            <div className="flex-1 min-h-0 flex overflow-hidden">
                {/* List Side */}
                <div className={`flex-1 overflow-y-auto p-4 md:p-6 ${(selectedMO || selectedBOM) ? 'hidden lg:block lg:w-1/3 xl:w-1/4 border-r border-slate-200 dark:border-slate-800' : 'w-full'}`}>
                    {loading ? (
                        <div className="flex justify-center py-20"><Loader2 className="animate-spin text-slate-400" size={32} /></div>
                    ) : (
                        activeTab === 'mo' ? (
                            <ManufacturingOrdersTab
                                orders={orders}
                                projects={projects}
                                products={products}
                                searchTerm={searchTerm}
                                config={config}
                                selectedMOId={selectedMO?.id}
                                onSelectMO={setSelectedMO}
                            />
                        ) : (
                            <BOMTab
                                boms={boms}
                                products={products}
                                searchTerm={searchTerm}
                                config={config}
                                selectedBOMId={selectedBOM?.id}
                                onSelectBOM={setSelectedBOM}
                            />
                        )
                    )}
                </div>

                {/* Detail Side (MO & BOM) */}
                <div className={`flex-1 bg-white dark:bg-slate-900 flex flex-col ${(selectedMO || selectedBOM) ? 'block absolute inset-0 z-20 lg:static lg:inset-auto' : 'hidden lg:flex lg:items-center lg:justify-center'}`}>
                    {activeTab === 'mo' && selectedMO ? (
                        <ManufacturingOrderDetail
                            order={selectedMO}
                            products={products}
                            stockMovements={stockMovements}
                            config={config}
                            onClose={() => setSelectedMO(null)}
                            onOpenConsume={() => setIsConsumeModalOpen(true)}
                            onOpenProduce={() => setIsProduceModalOpen(true)}
                        />
                    ) : activeTab === 'bom' && selectedBOM ? (
                        <BOMDetail
                            bom={selectedBOM}
                            products={products}
                            config={config}
                            onClose={() => setSelectedBOM(null)}
                        />
                    ) : (
                        <div className="flex flex-col items-center justify-center h-full text-slate-400">
                            <Factory size={48} className="mb-4 opacity-50" />
                            <p>Selecione uma Ordem de Produção ou BOM para ver detalhes.</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default ManufacturingView;