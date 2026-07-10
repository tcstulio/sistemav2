import React, { useState } from 'react';
import { useDolibarr } from '../context/DolibarrContext';
import { AiService } from '../services/aiService';
import { formatCurrency } from '../utils/formatUtils';
import {
    Search,
    ShoppingCart,
    ArrowRight,
    Check,
    Package,
    Truck,
    Globe,
    Loader2,
    AlertTriangle,
    Plus,
    X,
    ExternalLink,
    Wand2
} from 'lucide-react';
import { toast } from 'sonner';
import { useProducts, useSuppliers } from '../hooks/dolibarr';
import * as CommercialService from '../services/api/commercial';
import * as InventoryService from '../services/api/inventory';
import { generateSupplierRequests, ParsedItem, PriceOffer } from '../services/quotationWizard';
import { logger } from '../utils/logger';

const log = logger.child('SmartQuotationWizard');

// --- Types ---

interface WizardStep {
    id: number;
    title: string;
    description: string;
    icon: any;
}

const STEPS: WizardStep[] = [
    { id: 1, title: 'Definir Necessidades', description: 'O que você precisa comprar?', icon: ShoppingCart },
    { id: 2, title: 'Produtos', description: 'Identificação e Cadastro', icon: Package },
    { id: 3, title: 'Cotação Inteligente', description: 'Busca de Preços e Fornecedores', icon: Globe },
    { id: 4, title: 'Finalizar', description: 'Geração de Solicitações', icon: Check },
];

export const SmartQuotationWizard: React.FC = () => {
    const { config } = useDolibarr();
    const [currentStep, setCurrentStep] = useState(1);
    const [loading, setLoading] = useState(false);

    // Data Hooks
    const { data: products } = useProducts(config);
    const { data: suppliers } = useSuppliers(config);

    // State Step 1
    const [inputText, setInputText] = useState('');

    // State Step 2
    const [parsedItems, setParsedItems] = useState<ParsedItem[]>([]);

    // State Step 3
    const [priceOffers, setPriceOffers] = useState<PriceOffer[]>([]);

    // --- Actions ---

    const handleParseNeeds = async () => {
        if (!inputText.trim()) return;
        setLoading(true);
        try {
            // Simulate AI Parsing via Chat for now as we don't have a dedicated endpoint yet
            // In a real impl, we would add parseNeeds to AiService
            const prompt = `
                Analise este pedido de compra e extraia os itens: "${inputText}".
                Retorne APENAS um JSON array. Cada objeto deve ter:
                - productName (string)
                - qty (number)
                - spec (string, detalhes técnicos)
                - type (string, "product" ou "service")
            `;

            // We use chatWithData as a proxy to general generate
            const response = await AiService.chatWithData(prompt, []);
            const replyText = typeof response === 'string' ? response : response?.reply;
            // Extract JSON
            const jsonMatch = replyText?.match(/\[[\s\S]*\]/);
            if (jsonMatch) {
                const rawItems = JSON.parse(jsonMatch[0]);

                // Process and Match with existing products
                const items: ParsedItem[] = rawItems.map((item: any, idx: number) => {
                    // Simple fuzzy match by name (ref or label)
                    const match = products?.find(p =>
                        p.label.toLowerCase().includes(item.productName.toLowerCase()) ||
                        p.ref.toLowerCase().includes(item.productName.toLowerCase())
                    );

                    return {
                        id: `item-${Date.now()}-${idx}`,
                        rawText: `${item.qty}x ${item.productName}`,
                        productName: item.productName,
                        qty: item.qty || 1,
                        spec: item.spec || '',
                        matchedProduct: match,
                        isNew: !match,
                        productDraft: !match ? {
                            ref: item.productName.toUpperCase().replace(/\s+/g, '-').slice(0, 10),
                            label: item.productName,
                            description: item.spec,
                            price: 0
                        } : undefined
                    };
                });

                setParsedItems(items);
                setCurrentStep(2);
            } else {
                toast.error("Não foi possível interpretar o pedido. Tente ser mais específico.");
            }

        } catch (e) {
            log.error("Failed to process AI request", e);
            toast.error("Erro ao processar com IA.");
        } finally {
            setLoading(false);
        }
    };

    const handleResearchPrices = async () => {
        setLoading(true);
        try {
            const newOffers: PriceOffer[] = [];

            // For each item, perform a "Simulated" Web Search via AI
            // In reality, we call the chat endpoint which calls the 'search_web' tool we just added
            for (const item of parsedItems) {
                const query = `Preço de ${item.productName} ${item.spec} no Brasil`;
                const searchResponseRaw = await AiService.chatWithData(query, []);
                const searchResponse = typeof searchResponseRaw === 'string' ? searchResponseRaw : searchResponseRaw?.reply;

                // Parse the "Simulation" text returned by the tool (or hallucinated)
                // We expect lines like "1. Loja: R$ Price"
                // This is unstructured, so we'll do a best-effort regex or asking AI to structure it

                // Ask AI to structure the search result it just found/generated
                const structurePrompt = `
                    Transforme o resultado da pesquisa anterior em JSON.
                    Texto da pesquisa: "${searchResponse}"
                    Retorne APENAS um JSON array de ofertas:
                    [{ "source": "Nome Loja", "price": 100.00, "link": "http..." }]
                `;
                const structureResRaw = await AiService.chatWithData(structurePrompt, []);
                const structureRes = typeof structureResRaw === 'string' ? structureResRaw : structureResRaw?.reply;
                const jsonMatch = structureRes?.match(/\[[\s\S]*\]/);

                if (jsonMatch) {
                    const offers = JSON.parse(jsonMatch[0]);
                    offers.forEach((o: any, idx: number) => {
                        // Try to match supplier
                        const supplierMatch = suppliers?.find(s => s.name.toLowerCase().includes(o.source.toLowerCase()));

                        newOffers.push({
                            id: `offer-${item.id}-${idx}`,
                            itemId: item.id,
                            source: o.source,
                            supplierName: o.source,
                            price: o.price,
                            link: o.link || '#',
                            selected: false,
                            matchedSupplier: supplierMatch,
                            isNewSupplier: !supplierMatch,
                            supplierDraft: !supplierMatch ? {
                                name: o.source,
                                email: ''
                            } : undefined
                        });
                    });
                }
            }

            setPriceOffers(newOffers);
            setCurrentStep(3);

        } catch (e) {
            log.error("Failed to search prices", e);
            toast.error("Erro na pesquisa de preços.");
        } finally {
            setLoading(false);
        }
    };

    const handleGenerate = async () => {
        if (!config) {
            toast.error("Configuração do Dolibarr não disponível.");
            return;
        }
        setLoading(true);
        const toastId = toast.loading("Gerando solicitações...");
        try {
            const selectedOffers = priceOffers.filter(o => o.selected);
            const result = await generateSupplierRequests(config, parsedItems, selectedOffers, {
                createProduct: InventoryService.createProduct,
                createThirdParty: CommercialService.createThirdParty,
                createSupplierProposal: CommercialService.createSupplierProposal,
                addSupplierProposalLine: CommercialService.addSupplierProposalLine,
            });
            toast.success(`${result.proposalsCreated} solicitação(ões) gerada(s) com sucesso!`, { id: toastId });
        } catch (e) {
            log.error("Failed to generate proposals", e);
            toast.error("Erro ao gerar solicitações.", { id: toastId });
        } finally {
            setLoading(false);
        }
    };

    // --- Render Steps ---

    const renderStep1 = () => (
        <div className="flex flex-col h-full">
            <h2 className="text-xl font-bold text-slate-800 dark:text-white mb-4">O que você precisa hoje?</h2>
            <p className="text-slate-500 mb-6">Descreva sua necessidade em linguagem natural. Ex: "Preciso de 5 notebooks Dell i7 e 10 mouses sem fio Logitech".</p>

            <textarea
                className="w-full h-48 p-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-white resize-none focus:ring-2 focus:ring-indigo-500 outline-none"
                placeholder="Digite sua lista aqui..."
                value={inputText}
                onChange={e => setInputText(e.target.value)}
            />

            <div className="mt-6 flex justify-end">
                <button
                    onClick={handleParseNeeds}
                    disabled={!inputText.trim() || loading}
                    className="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-3 rounded-lg font-medium flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                    {loading ? <Loader2 className="animate-spin" /> : <Wand2 size={20} />}
                    Analisar com IA
                </button>
            </div>
        </div>
    );

    const renderStep2 = () => (
        <div className="flex flex-col h-full">
            <h2 className="text-xl font-bold text-slate-800 dark:text-white mb-4">Itens Identificados</h2>
            <p className="text-slate-500 mb-6">Verifique se interpretamos corretamente. Itens desconhecidos serão cadastrados.</p>

            <div className="flex-1 overflow-y-auto space-y-3">
                {parsedItems.map((item, idx) => (
                    <div key={item.id} className="p-4 bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 flex flex-col md:flex-row md:items-center gap-4">
                        <div className="w-12 h-12 rounded-lg bg-indigo-50 dark:bg-indigo-900/20 flex items-center justify-center text-indigo-600 font-bold shrink-0">
                            {item.qty}x
                        </div>
                        <div className="flex-1">
                            <div className="flex items-center gap-2">
                                <h3 className="font-bold text-slate-800 dark:text-white">{item.productName}</h3>
                                {item.isNew ? (
                                    <span className="px-2 py-0.5 bg-yellow-100 text-yellow-700 text-xs rounded-full font-bold">Novo Produto</span>
                                ) : (
                                    <span className="px-2 py-0.5 bg-green-100 text-green-700 text-xs rounded-full font-bold">Em Estoque</span>
                                )}
                            </div>
                            <p className="text-sm text-slate-500">{item.spec || 'Sem especificações'}</p>
                        </div>
                        <div className="w-full md:w-auto">
                            {item.isNew ? (
                                <div className="text-xs text-slate-400 italic">Será cadastrado como {item.productDraft?.ref}</div>
                            ) : (
                                <div className="text-xs text-slate-400">Ref: {item.matchedProduct?.ref}</div>
                            )}
                        </div>
                    </div>
                ))}
            </div>

            <div className="mt-6 flex justify-between">
                <button onClick={() => setCurrentStep(1)} className="text-slate-500 hover:text-slate-800">Voltar</button>
                <button
                    onClick={handleResearchPrices}
                    disabled={loading}
                    className="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-3 rounded-lg font-medium flex items-center gap-2 disabled:opacity-50 transition-colors"
                >
                    {loading ? <Loader2 className="animate-spin" /> : <Globe size={20} />}
                    Pesquisar Preços na Web
                </button>
            </div>
        </div>
    );

    const renderStep3 = () => (
        <div className="flex flex-col h-full">
            <h2 className="text-xl font-bold text-slate-800 dark:text-white mb-4">Ofertas Encontradas</h2>
            <p className="text-slate-500 mb-6">Selecione as ofertas que deseja incluir nas cotações.</p>

            <div className="flex-1 overflow-y-auto space-y-6">
                {parsedItems.map(item => {
                    const offers = priceOffers.filter(o => o.itemId === item.id);
                    return (
                        <div key={item.id} className="space-y-3">
                            <h3 className="font-bold text-slate-700 dark:text-slate-300 flex items-center gap-2">
                                <Package size={16} /> {item.qty}x {item.productName}
                            </h3>
                            {offers.length === 0 ? (
                                <div className="p-3 bg-slate-50 dark:bg-slate-900 rounded-lg text-sm text-slate-500 italic">Nenhuma oferta encontrada.</div>
                            ) : (
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                    {offers.map(offer => (
                                        <div
                                            key={offer.id}
                                            onClick={() => {
                                                const updated = priceOffers.map(o => o.id === offer.id ? { ...o, selected: !o.selected } : o);
                                                setPriceOffers(updated);
                                            }}
                                            className={`p-3 rounded-lg border cursor-pointer transition-all ${offer.selected ? 'bg-indigo-50 border-indigo-500 ring-1 ring-indigo-500 dark:bg-indigo-900/20' : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 hover:border-indigo-300'}`}
                                        >
                                            <div className="flex justify-between items-start">
                                                <div>
                                                    <div className="font-bold text-slate-800 dark:text-white">{offer.source}</div>
                                                    <div className="text-xs text-slate-500">{offer.isNewSupplier ? '(Novo Fornecedor)' : '(Já Cadastrado)'}</div>
                                                </div>
                                                <div className="text-lg font-bold text-emerald-600">
                                                    {formatCurrency(offer.price)}
                                                </div>
                                            </div>
                                            <div className="mt-2 flex items-center justify-between text-xs">
                                                <a href={offer.link} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} className="flex items-center gap-1 text-blue-500 hover:underline">
                                                    Ver Link <ExternalLink size={10} />
                                                </a>
                                                {offer.selected && <Check size={16} className="text-indigo-600" />}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

            <div className="mt-6 flex justify-between">
                <button onClick={() => setCurrentStep(2)} className="text-slate-500 hover:text-slate-800">Voltar</button>
                <button
                    onClick={handleGenerate}
                    disabled={priceOffers.filter(o => o.selected).length === 0 || loading}
                    className="bg-green-600 hover:bg-green-700 text-white px-6 py-3 rounded-lg font-medium flex items-center gap-2 disabled:opacity-50 transition-colors"
                >
                    {loading ? <Loader2 className="animate-spin" /> : <Check size={20} />}
                    Gerar Solicitações ({priceOffers.filter(o => o.selected).length})
                </button>
            </div>
        </div>
    );

    return (
        <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-950 overflow-y-auto">
            {/* Header */}
            <div className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 p-6">
                <div className="max-w-4xl mx-auto">
                    <h1 className="text-2xl font-bold text-slate-800 dark:text-white flex items-center gap-2">
                        <Wand2 className="text-indigo-500" /> Assistente de Cotação Inteligente
                    </h1>
                    <p className="text-slate-500 dark:text-slate-400 mt-1">Busque produtos, encontre preços na web e gere solicitações automaticamente.</p>
                </div>
            </div>

            {/* Stepper */}
            <div className="max-w-4xl mx-auto w-full py-8 px-6">
                <div className="flex items-center justify-between relative mb-8">
                    {/* Line */}
                    <div className="absolute left-0 top-1/2 w-full h-0.5 bg-slate-200 dark:bg-slate-800 -z-10" />

                    {STEPS.map((step, idx) => {
                        const isActive = currentStep === step.id;
                        const isCompleted = currentStep > step.id;
                        const Icon = step.icon;

                        return (
                            <div key={step.id} className="flex flex-col items-center bg-slate-50 dark:bg-slate-950 px-2">
                                <div className={`w-10 h-10 rounded-full flex items-center justify-center border-2 transition-colors ${isActive ? 'border-indigo-600 bg-indigo-600 text-white' :
                                    isCompleted ? 'border-green-500 bg-green-500 text-white' :
                                        'border-slate-300 bg-white dark:bg-slate-800 text-slate-300'
                                    }`}>
                                    {isCompleted ? <Check size={20} /> : <Icon size={20} />}
                                </div>
                                <span className={`text-xs font-bold mt-2 ${isActive ? 'text-indigo-600' : 'text-slate-500'}`}>{step.title}</span>
                            </div>
                        );
                    })}
                </div>

                {/* Content */}
                <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800 p-6 min-h-[400px]">
                    {currentStep === 1 && renderStep1()}
                    {currentStep === 2 && renderStep2()}
                    {currentStep === 3 && renderStep3()}
                </div>
            </div>
        </div>
    );
};
