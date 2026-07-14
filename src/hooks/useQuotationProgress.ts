import { useCallback, useState } from 'react';
import { safeStorage } from '../utils/safeStorage';
import type { GenerationProgress } from '../services/quotationWizard';

/**
 * #1416 — Hook que persiste o progresso de geração de cotações entre tentativas
 * (localStorage). Usado pelo SmartQuotationWizard para retomar uma execução
 * interrompida por falha parcial sem recriar produtos/fornecedores/linhas
 * já efetivados no ERP.
 *
 * Mantém `savedProgress` em estado sincronizado com `localStorage` para que a UI
 * consiga mostrar um banner de "Retomar" automaticamente ao montar (ex.: após
 * reload da página).
 */
export const QUOTATION_PROGRESS_KEY = 'coolgroove_quotation_wizard_progress';

export const emptyQuotationProgress = (): GenerationProgress => ({
    productIdsByRef: {},
    supplierIdsByName: {},
    processedOfferIds: [],
});

const hasMeaningfulWork = (p: GenerationProgress): boolean =>
    Object.keys(p.productIdsByRef).length > 0 ||
    Object.keys(p.supplierIdsByName).length > 0 ||
    p.processedOfferIds.length > 0;

export interface UseQuotationProgressResult {
    /** Progresso persistido (null = nada p/ retomar). */
    savedProgress: GenerationProgress | null;
    /** Persiste o progresso. Se vazio, limpa o storage. */
    persistProgress: (progress: GenerationProgress) => void;
    /** Limpa o progresso persistido (storage + estado). */
    clearSavedProgress: () => void;
}

export const useQuotationProgress = (): UseQuotationProgressResult => {
    const [savedProgress, setSavedProgress] = useState<GenerationProgress | null>(() =>
        safeStorage.getJSON<GenerationProgress | null>(QUOTATION_PROGRESS_KEY, null),
    );

    const persistProgress = useCallback((progress: GenerationProgress) => {
        if (!hasMeaningfulWork(progress)) {
            safeStorage.removeItem(QUOTATION_PROGRESS_KEY);
            setSavedProgress(null);
            return;
        }
        safeStorage.setJSON(QUOTATION_PROGRESS_KEY, progress);
        setSavedProgress(progress);
    }, []);

    const clearSavedProgress = useCallback(() => {
        safeStorage.removeItem(QUOTATION_PROGRESS_KEY);
        setSavedProgress(null);
    }, []);

    return { savedProgress, persistProgress, clearSavedProgress };
};