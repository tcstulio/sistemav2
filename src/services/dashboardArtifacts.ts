import axios from 'axios';
import { safeStorage } from '../utils/safeStorage';

// Artefatos do dashboard (Análise Financeira IA / Previsão de Vendas) persistidos org-wide (#124):
// uma vez gerados, ficam disponíveis para todos até alguém regerar.
export interface Artifact { value: any; generatedBy: string; generatedAt: number; }
export interface ArtifactsStore { financialAnalysis: Artifact | null; salesForecast: Artifact | null; }

const getAuthHeaders = () => {
    const cfg = safeStorage.getJSON<Record<string, any>>('coolgroove_config', {});
    return { headers: { Authorization: 'Bearer ' + (cfg.apiKey || '') } };
};

export async function getDashboardArtifacts(): Promise<ArtifactsStore | null> {
    try {
        const r = await axios.get('/api/dashboard/artifacts', getAuthHeaders());
        return r.data as ArtifactsStore;
    } catch {
        return null;
    }
}

export async function saveFinancialAnalysis(text: string): Promise<Artifact | null> {
    try {
        const r = await axios.put('/api/dashboard/artifacts/financial', { text }, getAuthHeaders());
        return r.data as Artifact;
    } catch {
        return null;
    }
}

export async function saveSalesForecast(data: any): Promise<Artifact | null> {
    try {
        const r = await axios.put('/api/dashboard/artifacts/forecast', { data }, getAuthHeaders());
        return r.data as Artifact;
    } catch {
        return null;
    }
}
