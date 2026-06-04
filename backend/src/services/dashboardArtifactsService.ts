/**
 * Dashboard Artifacts Service — guarda os RESULTADOS gerados no dashboard (Análise
 * Financeira IA e Previsão de Vendas) de forma ORG-WIDE: uma vez gerados, ficam
 * disponíveis para todos até alguém regerar (#124). Persiste em JSON (padrão storeService).
 */
import fs from 'fs';
import path from 'path';
import { atomicWriteSync } from '../utils/atomicWrite';
import { logger } from '../utils/logger';

const log = logger.child('DashboardArtifacts');

export interface Artifact {
    value: any;          // texto (markdown) da análise OU objeto da previsão
    generatedBy: string; // login/nome de quem gerou
    generatedAt: number; // epoch ms
}

export interface ArtifactsStore {
    financialAnalysis: Artifact | null;
    salesForecast: Artifact | null;
}

const DEFAULTS: ArtifactsStore = { financialAnalysis: null, salesForecast: null };
const DEFAULT_STORE_PATH = path.join(__dirname, '../../data/dashboard_artifacts.json');

export class DashboardArtifactsService {
    private data: ArtifactsStore;
    private storePath: string;

    constructor(storePath: string = DEFAULT_STORE_PATH) {
        this.storePath = storePath;
        this.data = { ...DEFAULTS };
        this.load();
    }

    private load(): void {
        try {
            const dir = path.dirname(this.storePath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            if (fs.existsSync(this.storePath)) {
                const parsed = JSON.parse(fs.readFileSync(this.storePath, 'utf-8'));
                this.data = { ...DEFAULTS, ...parsed };
            }
        } catch (error) {
            log.error('Load Error', error);
        }
    }

    private save(): void {
        try { atomicWriteSync(this.storePath, this.data); } catch (error) { log.error('Save Error', error); }
    }

    private makeAt(): number {
        // Date.now() é evitado em workflow scripts, mas aqui é serviço normal — ok.
        return Date.now();
    }

    get(): ArtifactsStore {
        return { ...this.data };
    }

    setFinancialAnalysis(text: string, generatedBy: string): Artifact {
        this.data.financialAnalysis = { value: String(text || ''), generatedBy: generatedBy || 'desconhecido', generatedAt: this.makeAt() };
        this.save();
        return this.data.financialAnalysis;
    }

    setSalesForecast(data: any, generatedBy: string): Artifact {
        this.data.salesForecast = { value: data, generatedBy: generatedBy || 'desconhecido', generatedAt: this.makeAt() };
        this.save();
        return this.data.salesForecast;
    }
}

export const dashboardArtifactsService = new DashboardArtifactsService();
