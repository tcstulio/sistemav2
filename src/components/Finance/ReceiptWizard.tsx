import React, { useState, useRef, useEffect } from 'react';
import { Camera, Upload, X, Loader2, Check, FileText, ArrowRight, ArrowLeft, Calendar, DollarSign, Building, Plus, Trash2, AlertTriangle, Search } from 'lucide-react';
import { AiService } from '../../services/aiService';
import { DolibarrService } from '../../services/dolibarrService';
import { toast } from 'sonner';
import { useConfirm } from '../../hooks/useConfirm';
import { useSuppliers, useProducts } from '../../hooks/dolibarr';
import { useDolibarr } from '../../context/DolibarrContext';
import { logger } from '../../utils/logger';

const log = logger.child('ReceiptWizard');

interface ReceiptWizardProps {
    onClose: () => void;
    onInvoiceCreated: () => void;
}

type WizardStep = 'upload' | 'details' | 'items' | 'review';

export const ReceiptWizard: React.FC<ReceiptWizardProps> = ({ onClose, onInvoiceCreated }) => {
    const confirmDlg = useConfirm();
    const { config } = useDolibarr();
    const { data: suppliers = [] } = useSuppliers(config);
    const { data: products = [] } = useProducts(config);

    // State
    const [step, setStep] = useState<WizardStep>('upload');
    const [isProcessing, setIsProcessing] = useState(false);
    const [imagePreview, setImagePreview] = useState<string | null>(null);

    // Data State
    const [invoiceData, setInvoiceData] = useState({
        socid: '',
        ref: '',
        date: new Date().toISOString().split('T')[0],
        date_ech: '', // Due date
        total: 0,
        notes: ''
    });

    const [items, setItems] = useState<{
        id: string;
        desc: string;
        qty: number;
        price: number;
        vat: number;
        linkedProductId?: string;
        matchType?: 'exact' | 'approximate' | 'none';
        candidates?: { product: any, score: number }[];
    }[]>([]);

    const fileInputRef = useRef<HTMLInputElement>(null);

    // Helper: Find best product match with scoring
    // Helper: Find best product match with scoring
    const findBestMatch = (desc: string) => {
        // console.log("Matching for:", desc); 
        if (!desc || products.length === 0) return { best: null, candidates: [] };

        try {
            // Force string and clean
            const normalize = (s: any) => String(s || '').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
            const searchStr = normalize(desc);

            // Ignore short inputs or inputs that become empty after normalization
            if (searchStr.length < 2) return { best: null, candidates: [] };

            const searchTokens = searchStr.split(/\s+/).filter(t => t.length > 2);

            const scores = products.map(p => {
                if (!p || !p.label) return { product: p, score: 0 };
                const label = normalize(p.label);
                const ref = normalize(p.ref); // ref can be null/undefined

                // 1. Exact Match
                if (label === searchStr || ref === searchStr) return { product: p, score: 100 };

                // 2. Token Overlap Score
                let score = 0;

                // Check tokens
                if (searchTokens.length > 0) {
                    const labelTokens = label.split(/\s+/);
                    searchTokens.forEach(token => {
                        if (label.includes(token)) score += 10; // Partial match
                        if (labelTokens.includes(token)) score += 20; // Exact token match
                    });
                } else {
                    // Fallback for no tokens (short words): simple contains
                    if (label.includes(searchStr)) score += 30;
                }

                // Penalty for length difference (to avoid matching "Agua" with "Agua Sanitaria")
                const lenDiff = Math.abs(label.length - searchStr.length);
                score -= lenDiff * 0.5;

                return { product: p, score };
            });

            // Filter and Sort
            const candidates = scores
                .filter(s => s.score > 10) // Min score > 10 to reduce noise
                .sort((a, b) => b.score - a.score)
                .slice(0, 5); // Top 5

            if (candidates.length > 0) {
                // Determine confidence threshold for auto-link
                const best = candidates[0];
                const matchType = best.score > 50 ? 'approximate' : 'none'; // Threshold 50
                // console.log(`Matched ${desc} -> ${best.product.label} (${best.score})`);
                return {
                    best: best.score > 50 ? best.product : null,
                    matchType: matchType,
                    candidates: candidates
                };
            }

        } catch (e) {
            log.error("Match error details", e);
        }

        return { best: null, candidates: [] };
    };

    const [fileToUpload, setFileToUpload] = useState<File | null>(null);

    // --- Step 1: Upload Logic ---
    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        try {
            const file = e.target.files?.[0];
            if (!file) return;

            setFileToUpload(file); // Store file

            const reader = new FileReader();
            reader.onloadend = () => {
                const base64 = reader.result as string;
                if (!base64) return;
                setImagePreview(base64);
                processImage(base64);
            };
            reader.onerror = () => {
                toast.error("Erro ao ler arquivo.");
            };
            reader.readAsDataURL(file);
        } catch (err) {
            log.error("Failed to handle file change", err);
        }
    };

    const processImage = async (base64: string) => {
        setIsProcessing(true);
        try {
            const result = await AiService.extractReceiptData(base64);

            // Safely handle result
            let data = result;
            if (typeof result === 'string') {
                try {
                    const cleanJson = result.replace(/```json|```/g, '').trim();
                    data = JSON.parse(cleanJson);
                } catch (e) {
                    log.error("Error parsing AI JSON", e);
                    data = { total: 0 };
                }
            }

            if (!data) data = {};

            // Try to match supplier
            let matchedSupplierId = '';
            if (data.vendor) {
                const match = suppliers.find(s => s.name.toLowerCase().includes(data.vendor.toLowerCase()));
                if (match) matchedSupplierId = match.id;
            }

            setInvoiceData(prev => ({
                ...prev,
                socid: matchedSupplierId,
                date: data.date || prev.date,
                total: parseFloat(data.total) || 0,
                notes: data.category ? `Categoria: ${data.category}` : ''
            }));

            // Process Items
            const newItems: typeof items = [];
            if (data.items && Array.isArray(data.items) && data.items.length > 0) {
                data.items.forEach((item: any) => {
                    if (!item) return;

                    // Match product
                    const match = findBestMatch(item.description);

                    newItems.push({
                        id: Date.now().toString() + Math.random(),
                        desc: item.description || 'Item sem nome',
                        qty: parseFloat(item.quantity) || 1,
                        price: parseFloat(item.unit_price) || (parseFloat(item.total_price) / (parseFloat(item.quantity) || 1)) || 0,
                        vat: 0,
                        linkedProductId: match.best ? match.best.id : undefined,
                        matchType: match.matchType as any,
                        candidates: match.candidates
                    });
                });
            } else if (data.total) {
                // Fallback to single item
                newItems.push({
                    id: Date.now().toString(),
                    desc: data.category ? `${data.category} (Digitalizado)` : 'Despesa Digitalizada',
                    qty: 1,
                    price: parseFloat(data.total) || 0,
                    vat: 0
                });
            }

            // If items is still empty, add a default one
            if (newItems.length === 0) {
                newItems.push({
                    id: Date.now().toString(),
                    desc: 'Despesa Digitalizada',
                    qty: 1,
                    price: parseFloat(data.total || '0') || 0,
                    vat: 0
                });
            }

            setItems(newItems);
            setStep('details');
            toast.success("Dados extraídos com sucesso!");

        } catch (error) {
            log.error("Failed to process image", error);
            toast.error("Erro ao processar imagem.");
            setStep('details');
        } finally {
            setIsProcessing(false);
        }
    };

    // --- Computed ---
    const itemsTotal = items.reduce((acc, item) => acc + (item.qty * item.price), 0);
    const difference = Math.abs(invoiceData.total - itemsTotal);
    const isTotalMatching = difference < 0.05; // 5 cents tolerance

    // --- Actions ---
    const handleSave = async (mode: 'draft' | 'validate' | 'paid') => {
        if (!invoiceData.socid) {
            toast.error("Selecione um fornecedor.");
            return;
        }
        if (!config) return;

        setIsProcessing(true);
        try {
            // 1. Create Invoice
            const invoiceId = await DolibarrService.createSupplierInvoice(config, {
                socid: invoiceData.socid,
                date: new Date(invoiceData.date).getTime() / 1000,
                type: '0',
                ref_supplier: invoiceData.ref || `AUTO-${Date.now()}`,
                lines: items.map(item => ({
                    desc: item.desc,
                    subprice: item.price,
                    qty: item.qty,
                    remise_percent: 0,
                    tva_tx: item.vat,
                    fk_product: item.linkedProductId // Link product ID if available
                }))
            });

            // 2. Upload Document (if file exists)
            if (fileToUpload && invoiceId) {
                try {
                    // Fetch invoice to get the correct Ref/Dir
                    const invoice = await DolibarrService.getSupplierInvoice(config, invoiceId);
                    if (invoice && invoice.ref) {
                        // Standard modulepart for supplier invoices is often 'fournisseur' or 'supplier_invoice'
                        // Checking Dolibarr docs: usually 'fournisseur/facture' or just 'supplier_invoice' in modern API?
                        // Actually the helper might expect just 'supplier_invoice'.
                        // Let's rely on standard 'supplier_invoice' which mapped to 'facture_fournisseur' in some versions?
                        // Try 'supplier_invoice' first.
                        await DolibarrService.uploadDocument(config, fileToUpload, 'supplier_invoice', invoice.ref);
                        // toast.success("Recibo anexado!");
                    }
                } catch (docErr) {
                    log.error("Failed to attach image", docErr);
                    // toast.error("Erro ao anexar imagem.");
                }
            }

            // 3. Actions
            if (mode === 'validate' || mode === 'paid') {
                await DolibarrService.validateSupplierInvoice(config, invoiceId);
            }

            if (mode === 'paid') {
                await DolibarrService.markSupplierInvoiceAsPaid(config, invoiceId);
            }

            toast.success("Fatura criada com sucesso!");
            onInvoiceCreated();
            onClose();
        } catch (e: any) {
            log.error("Failed to save invoice", e);
            toast.error("Erro ao salvar: " + e.message);
        } finally {
            setIsProcessing(false);
        }
    };

    const handleCreateProduct = async (idx: number) => {
        const item = items[idx];
        const confirmed = await confirmDlg(`Deseja criar o produto "${item.desc}" automaticamente?`);
        if (!confirmed) return;
        if (!config) return;

        try {
            const newId = await DolibarrService.createProduct(config, {
                label: item.desc,
                ref: `PROD-${Date.now()}`, // Temporary ref generation
                price: item.price.toString(),
                type: '0', // Product
                status: '1' // Active
            });

            // Link to item
            const newItems = [...items];
            newItems[idx].linkedProductId = newId;
            newItems[idx].matchType = 'exact';
            setItems(newItems);
            toast.success("Produto criado e vinculado!");
            // Refresh products? React Query should handle it eventually or we manually invalidate
        } catch (e) {
            log.error("Failed to create product", e);
            toast.error("Erro ao criar produto.");
        }
    };

    // --- Renderers ---

    const renderStepIndicator = () => (
        <div className="flex items-center justify-center gap-2 mb-6">
            <div className={`w-3 h-3 rounded-full transition-colors ${step === 'upload' ? 'bg-indigo-600' : 'bg-slate-300 dark:bg-slate-700'}`} />
            <div className={`w-3 h-3 rounded-full transition-colors ${step === 'details' ? 'bg-indigo-600' : 'bg-slate-300 dark:bg-slate-700'}`} />
            <div className={`w-3 h-3 rounded-full transition-colors ${step === 'items' ? 'bg-indigo-600' : 'bg-slate-300 dark:bg-slate-700'}`} />
            <div className={`w-3 h-3 rounded-full transition-colors ${step === 'review' ? 'bg-indigo-600' : 'bg-slate-300 dark:bg-slate-700'}`} />
        </div>
    );

    const renderUpload = () => (
        <div className="flex flex-col items-center justify-center h-full min-h-[400px]">
            <div className="text-center space-y-4">
                <div className="w-20 h-20 bg-indigo-50 dark:bg-indigo-900/20 rounded-full flex items-center justify-center mx-auto mb-4">
                    <FileText size={32} className="text-indigo-600 dark:text-indigo-400" />
                </div>
                <h3 className="text-xl font-bold text-slate-800 dark:text-white">Digitalizar Recibo</h3>
                <p className="text-slate-500 dark:text-slate-400 max-w-xs mx-auto">
                    Envie uma foto ou use a câmera para extrair os dados automaticamente.
                </p>

                <div className="flex gap-3 justify-center mt-6">
                    <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        ref={fileInputRef}
                        onChange={handleFileChange}
                    />
                    <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="flex items-center gap-2 px-6 py-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors font-medium text-slate-700 dark:text-slate-200"
                    >
                        <Upload size={20} /> Upload
                    </button>
                    <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="flex items-center gap-2 px-6 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl transition-colors font-medium shadow-lg shadow-indigo-200 dark:shadow-none"
                    >
                        <Camera size={20} /> Câmera
                    </button>
                </div>
            </div>
        </div>
    );

    const renderDetails = () => (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 h-full">
            {/* Left: Image */}
            <div className="hidden md:flex bg-slate-100 dark:bg-slate-900 rounded-xl items-center justify-center overflow-hidden border border-slate-200 dark:border-slate-800">
                {imagePreview ? (
                    <img src={imagePreview} alt="Receipt" className="max-h-[500px] object-contain" />
                ) : (
                    <span className="text-slate-400">Sem imagem</span>
                )}
            </div>

            {/* Right: Form */}
            <div className="flex flex-col gap-4 overflow-y-auto">
                <h3 className="font-bold text-lg text-slate-800 dark:text-white mb-2">Dados Gerais</h3>

                <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Fornecedor</label>
                    <select
                        className="w-full p-2.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg outline-none focus:ring-2 focus:ring-indigo-500"
                        value={invoiceData.socid}
                        onChange={e => setInvoiceData({ ...invoiceData, socid: e.target.value })}
                    >
                        <option value="">Selecione...</option>
                        {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                </div>

                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Data Emissão</label>
                        <input
                            type="date"
                            className="w-full p-2.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg outline-none focus:ring-2 focus:ring-indigo-500"
                            value={invoiceData.date}
                            onChange={e => setInvoiceData({ ...invoiceData, date: e.target.value })}
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Ref. Fornecedor</label>
                        <input
                            type="text"
                            placeholder="Ex: NF-001"
                            className="w-full p-2.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg outline-none focus:ring-2 focus:ring-indigo-500"
                            value={invoiceData.ref}
                            onChange={e => setInvoiceData({ ...invoiceData, ref: e.target.value })}
                        />
                    </div>
                </div>

                <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Valor Total (Recibo)</label>
                    <div className="relative">
                        <DollarSign size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input
                            type="number"
                            step="0.01"
                            className="w-full pl-9 p-2.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg outline-none focus:ring-2 focus:ring-indigo-500"
                            value={invoiceData.total}
                            onChange={e => setInvoiceData({ ...invoiceData, total: parseFloat(e.target.value) || 0 })}
                        />
                    </div>
                    <p className="text-xs text-slate-500 mt-1">Insira o valor total exato que consta no recibo.</p>
                </div>

                <div className="flex-1"></div>

                <button
                    type="button"
                    onClick={() => setStep('items')}
                    className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold transition-colors flex items-center justify-center gap-2"
                >
                    Próximo: Itens <ArrowRight size={18} />
                </button>
            </div>
        </div>
    );

    const renderItems = () => (
        <div className="flex flex-col h-full">
            <div className="flex items-center justify-between mb-4">
                <h3 className="font-bold text-lg text-slate-800 dark:text-white">Itens da Fatura</h3>
                <button
                    type="button"
                    onClick={() => setItems([...items, { id: Date.now().toString(), desc: '', qty: 1, price: 0, vat: 0 }])}
                    className="flex items-center gap-1 text-sm font-medium text-indigo-600 dark:text-indigo-400 hover:underline"
                >
                    <Plus size={16} /> Adicionar Item
                </button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-3 pr-2 pb-4">
                {items.map((item, index) => {
                    const linkedProduct = products.find(p => p.id === item.linkedProductId);

                    return (

                        <div key={item.id} className={`p-3 rounded-lg border relative group ${item.linkedProductId ? 'bg-emerald-50/50 dark:bg-emerald-900/10 border-emerald-200 dark:border-emerald-800' : 'bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700'}`}>
                            <div className="flex justify-between items-start mb-2">
                                <button
                                    type="button"
                                    onClick={() => setItems(items.filter((_, i) => i !== index))}
                                    className="text-slate-400 hover:text-red-500 transition-colors p-1"
                                >
                                    <Trash2 size={16} />
                                </button>
                            </div>

                            <div className="grid grid-cols-12 gap-3">
                                <div className="col-span-6">
                                    <label className="text-xs text-slate-500 mb-1 flex justify-between">
                                        <span>Descrição / Produto</span>
                                        {!item.linkedProductId && <span className="text-orange-500 flex items-center gap-1 cursor-pointer hover:underline" onClick={() => handleCreateProduct(index)}><AlertTriangle size={10} /> Criar Produto</span>}
                                        {item.linkedProductId && <span className="text-emerald-600 flex items-center gap-1"><Check size={10} /> Vinculado</span>}
                                    </label>
                                    <div className="relative">
                                        <input
                                            type="text"
                                            className={`w-full p-2 text-sm border rounded outline-none ${item.linkedProductId ? 'border-emerald-300 bg-emerald-50 dark:bg-emerald-900/20 dark:border-emerald-800' : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700'}`}
                                            value={item.desc}
                                            onChange={e => {
                                                const newItems = [...items];
                                                newItems[index].desc = e.target.value;
                                                setItems(newItems);
                                            }}
                                            placeholder="Nome do Item"
                                        />

                                        {/* Suggestions List (Inline) */}
                                        {!item.linkedProductId && item.candidates && item.candidates.length > 0 && (
                                            <div className="mt-2 w-full bg-white dark:bg-slate-800 border border-indigo-100 dark:border-slate-700 rounded-lg shadow-sm overflow-hidden">
                                                <div className="px-3 py-1.5 bg-indigo-50 dark:bg-indigo-900/20 text-xs font-bold text-indigo-700 dark:text-indigo-300 border-b border-indigo-100 dark:border-indigo-800/50 flex items-center gap-1">
                                                    <Search size={10} />
                                                    Sugestões encontradas:
                                                </div>
                                                <div className="max-h-40 overflow-y-auto">
                                                    {item.candidates.map((cand, cIdx) => (
                                                        <div
                                                            key={`cand-${index}-${cIdx}`}
                                                            className="px-3 py-2 text-xs hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer flex justify-between items-center border-b last:border-0 border-slate-50 dark:border-slate-800"
                                                            onClick={() => {
                                                                const newItems = [...items];
                                                                newItems[index].linkedProductId = cand.product.id;
                                                                newItems[index].matchType = 'exact';
                                                                setItems(newItems);
                                                            }}
                                                        >
                                                            <span className="dark:text-slate-200">{cand.product.label}</span>
                                                            <div className="flex items-center gap-2">
                                                                <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${cand.score > 70 ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
                                                                    {Math.round(cand.score)}%
                                                                </span>
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                    {item.linkedProductId && linkedProduct && (
                                        <div className="flex items-center justify-between mt-1 text-xs">
                                            <div className="text-emerald-600 dark:text-emerald-400 truncate">
                                                Produto: <b>{linkedProduct.label}</b>
                                            </div>
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    const newItems = [...items];
                                                    newItems[index].linkedProductId = undefined;
                                                    setItems(newItems);
                                                }}
                                                className="text-slate-400 hover:text-slate-600 underline text-[10px]"
                                            >
                                                Desvincular
                                            </button>
                                        </div>
                                    )}
                                </div>
                                <div className="col-span-2">
                                    <label className="text-xs text-slate-500 mb-1 block">Qtd</label>
                                    <input
                                        type="number"
                                        className="w-full p-2 text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded outline-none text-center"
                                        value={item.qty}
                                        onChange={e => {
                                            const newItems = [...items];
                                            newItems[index].qty = parseFloat(e.target.value) || 0;
                                            setItems(newItems);
                                        }}
                                    />
                                </div>
                                <div className="col-span-4">
                                    <label className="text-xs text-slate-500 mb-1 block">Preço Unit.</label>
                                    <input
                                        type="number"
                                        step="0.01"
                                        className="w-full p-2 text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded outline-none text-right"
                                        value={item.price}
                                        onChange={e => {
                                            const newItems = [...items];
                                            newItems[index].price = parseFloat(e.target.value) || 0;
                                            setItems(newItems);
                                        }}
                                    />
                                </div>
                            </div>
                        </div>
                    )
                })}
            </div>

            <div className={`mt-4 p-4 rounded-xl border ${isTotalMatching ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800' : 'bg-orange-50 dark:bg-orange-900/20 border-orange-200 dark:border-orange-800'}`}>
                <div className="flex justify-between items-center mb-1">
                    <span className="text-sm font-medium text-slate-600 dark:text-slate-300">Total dos Itens:</span>
                    <span className="font-bold text-slate-900 dark:text-white">${itemsTotal.toFixed(2)}</span>
                </div>
                <div className="flex justify-between items-center">
                    <span className="text-sm font-medium text-slate-600 dark:text-slate-300">Total do Recibo:</span>
                    <span className="font-bold text-slate-900 dark:text-white">${invoiceData.total.toFixed(2)}</span>
                </div>

                {!isTotalMatching && (
                    <div className="flex items-center gap-2 mt-2 text-xs text-orange-600 dark:text-orange-400 font-medium">
                        <AlertTriangle size={12} />
                        <span>Os valores não batem (Diferença: ${difference.toFixed(2)})</span>
                    </div>
                )}
            </div>

            <div className="flex gap-3 mt-4">
                <button
                    type="button"
                    onClick={() => setStep('details')}
                    className="flex-1 py-3 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-xl font-bold transition-colors"
                >
                    Voltar
                </button>
                <button
                    type="button"
                    onClick={() => setStep('review')}
                    className="flex-[2] py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold transition-colors flex items-center justify-center gap-2"
                >
                    Revisar e Finalizar <ArrowRight size={18} />
                </button>
            </div>
        </div>
    );

    const renderReview = () => (
        <div className="flex flex-col h-full">
            <div className="text-center mb-6">
                <div className="w-16 h-16 bg-emerald-100 dark:bg-emerald-900/30 rounded-full flex items-center justify-center mx-auto mb-3">
                    <Check size={32} className="text-emerald-600 dark:text-emerald-400" />
                </div>
                <h3 className="font-bold text-xl text-slate-800 dark:text-white">Tudo Pronto!</h3>
                <p className="text-slate-500 dark:text-slate-400 text-sm">Revise os dados antes de criar a fatura.</p>
            </div>

            <div className="bg-slate-50 dark:bg-slate-800/50 rounded-xl p-4 border border-slate-200 dark:border-slate-700 space-y-3 mb-6">
                <div className="flex justify-between text-sm">
                    <span className="text-slate-500">Fornecedor:</span>
                    <span className="font-medium dark:text-white">
                        {suppliers.find(s => s.id === invoiceData.socid)?.name || 'N/A'}
                    </span>
                </div>
                <div className="flex justify-between text-sm">
                    <span className="text-slate-500">Data:</span>
                    <span className="font-medium dark:text-white">{invoiceData.date}</span>
                </div>
                <div className="flex justify-between text-sm">
                    <span className="text-slate-500">Itens:</span>
                    <span className="font-medium dark:text-white">{items.length} itens</span>
                </div>
                <div className="border-t border-slate-200 dark:border-slate-700 pt-2 flex justify-between font-bold">
                    <span className="text-slate-700 dark:text-slate-300">Total:</span>
                    <span className="text-emerald-600 dark:text-emerald-400">${itemsTotal.toFixed(2)}</span>
                </div>
            </div>

            <div className="flex flex-col gap-3 mt-auto">
                <button
                    type="button"
                    onClick={() => handleSave('validate')}
                    disabled={isProcessing}
                    className="w-full py-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold transition-colors shadow-lg shadow-emerald-200 dark:shadow-none flex items-center justify-center gap-2"
                >
                    {isProcessing ? <Loader2 className="animate-spin" /> : <Check size={20} />}
                    Salvar e Validar
                </button>
                <div className="grid grid-cols-2 gap-3">
                    <button
                        type="button"
                        onClick={() => handleSave('draft')}
                        disabled={isProcessing}
                        className="py-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-xl font-medium transition-colors"
                    >
                        Salvar Rascunho
                    </button>
                    <button
                        type="button"
                        onClick={() => setStep('items')}
                        disabled={isProcessing}
                        className="py-3 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-400 rounded-xl font-medium transition-colors"
                    >
                        Voltar
                    </button>
                </div>
            </div>
        </div>
    );

    return (
        <div className="fixed inset-0 z-[60] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
            <div className="bg-white dark:bg-slate-900 rounded-2xl w-full max-w-4xl h-[600px] flex overflow-hidden shadow-2xl border border-slate-200 dark:border-slate-800">
                {/* Cancel Button */}
                <button
                    type="button"
                    onClick={onClose}
                    className="absolute top-4 right-4 p-2 bg-white/10 hover:bg-white/20 text-white rounded-full z-10 backdrop-blur-md"
                >
                    <X size={20} />
                </button>

                {/* Sidebar / Progress (Mobile hidden) */}
                <div className="hidden md:flex flex-col w-64 bg-slate-50 dark:bg-slate-950 border-r border-slate-200 dark:border-slate-800 p-6">
                    <h2 className="font-bold text-lg mb-8 text-slate-800 dark:text-white flex items-center gap-2">
                        <FileText className="text-indigo-600" />
                        Novo Recibo
                    </h2>

                    <div className="space-y-6">
                        <div className={`flex items-start gap-3 ${step === 'upload' ? 'opacity-100' : 'opacity-50'}`}>
                            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold shadow-sm transition-colors ${step === 'upload' ? 'bg-indigo-600 text-white' : 'bg-white dark:bg-slate-800 text-slate-500 border border-slate-200 dark:border-slate-700'}`}>1</div>
                            <div className="pt-1">
                                <p className="font-bold text-sm dark:text-white">Upload</p>
                                <p className="text-xs text-slate-500">Foto do recibo</p>
                            </div>
                        </div>

                        <div className={`flex items-start gap-3 ${step === 'details' ? 'opacity-100' : 'opacity-50'}`}>
                            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold shadow-sm transition-colors ${step === 'details' ? 'bg-indigo-600 text-white' : 'bg-white dark:bg-slate-800 text-slate-500 border border-slate-200 dark:border-slate-700'}`}>2</div>
                            <div className="pt-1">
                                <p className="font-bold text-sm dark:text-white">Dados</p>
                                <p className="text-xs text-slate-500">Fornecedor e Data</p>
                            </div>
                        </div>

                        <div className={`flex items-start gap-3 ${step === 'items' ? 'opacity-100' : 'opacity-50'}`}>
                            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold shadow-sm transition-colors ${step === 'items' ? 'bg-indigo-600 text-white' : 'bg-white dark:bg-slate-800 text-slate-500 border border-slate-200 dark:border-slate-700'}`}>3</div>
                            <div className="pt-1">
                                <p className="font-bold text-sm dark:text-white">Itens</p>
                                <p className="text-xs text-slate-500">Produtos e Serviços</p>
                            </div>
                        </div>

                        <div className={`flex items-start gap-3 ${step === 'review' ? 'opacity-100' : 'opacity-50'}`}>
                            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold shadow-sm transition-colors ${step === 'review' ? 'bg-indigo-600 text-white' : 'bg-white dark:bg-slate-800 text-slate-500 border border-slate-200 dark:border-slate-700'}`}>4</div>
                            <div className="pt-1">
                                <p className="font-bold text-sm dark:text-white">Revisão</p>
                                <p className="text-xs text-slate-500">Finalizar</p>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Main Content */}
                <div className="flex-1 flex flex-col relative w-full h-full">
                    {/* Mobile Step Indicator */}
                    <div className="md:hidden p-4 border-b border-slate-100 dark:border-slate-800">
                        {renderStepIndicator()}
                    </div>

                    {/* Loading Overlay */}
                    {isProcessing && (
                        <div className="absolute inset-0 bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm z-50 flex flex-col items-center justify-center">
                            <Loader2 size={48} className="text-indigo-600 animate-spin mb-4" />
                            <p className="font-bold text-slate-800 dark:text-white">Processando...</p>
                        </div>
                    )}

                    <div className="flex-1 p-4 md:p-8 overflow-y-auto">
                        {step === 'upload' && renderUpload()}
                        {step === 'details' && renderDetails()}
                        {step === 'items' && renderItems()}
                        {step === 'review' && renderReview()}
                    </div>
                </div>
            </div>
        </div>
    );
};
