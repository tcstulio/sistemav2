import fs from 'fs';
import path from 'path';
import { atomicWriteSync } from '../utils/atomicWrite';
import { logger } from '../utils/logger';

const log = logger.child('FinancialAnalysisStore');

// --- Types ---

export interface FinancialAnalysisSnapshot {
    data: unknown; // Payload completo da análise IA
    lastRunAt: string; // ISO timestamp da última execução
    status: 'success' | 'error';
    error?: string; // Mensagem de erro quando status === 'error'
}

export interface AutomationSchedule {
    dayOfWeek: number; // 0 = Domingo, 6 = Sábado
    hour: number; // 0-23
    minute: number; // 0-59
}

export interface AutomationConfig {
    enabled: boolean;
    schedule: AutomationSchedule;
    lastRunAt: string | null;
    lastRunStatus: string | null;
}

interface FinancialAnalysisStore {
    analysis: FinancialAnalysisSnapshot | null;
    automationConfig: AutomationConfig;
}

const STORE_PATH = path.join(__dirname, '../../data/financial_analysis.json');

const DEFAULT_CONFIG: AutomationConfig = {
    enabled: false,
    schedule: { dayOfWeek: 1, hour: 8, minute: 0 },
    lastRunAt: null,
    lastRunStatus: null
};

const DEFAULT_DATA: FinancialAnalysisStore = {
    analysis: null,
    automationConfig: { ...DEFAULT_CONFIG, schedule: { ...DEFAULT_CONFIG.schedule } }
};

class FinancialAnalysisStoreService {
    private data: FinancialAnalysisStore;

    constructor() {
        this.data = JSON.parse(JSON.stringify(DEFAULT_DATA));
        this.load();
    }

    private load() {
        try {
            const dir = path.dirname(STORE_PATH);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }

            if (fs.existsSync(STORE_PATH)) {
                const content = fs.readFileSync(STORE_PATH, 'utf-8');
                const parsed = JSON.parse(content);
                this.data = {
                    analysis: parsed.analysis ?? null,
                    automationConfig: this.normalizeConfig(parsed.automationConfig)
                };
            }
        } catch (error) {
            log.error('Load Error', error);
        }
    }

    private normalizeConfig(raw: any): AutomationConfig {
        const cfg = raw && typeof raw === 'object' ? raw : {};
        const schedule = cfg.schedule && typeof cfg.schedule === 'object' ? cfg.schedule : {};
        return {
            enabled: typeof cfg.enabled === 'boolean' ? cfg.enabled : DEFAULT_CONFIG.enabled,
            schedule: {
                dayOfWeek: typeof schedule.dayOfWeek === 'number' ? schedule.dayOfWeek : DEFAULT_CONFIG.schedule.dayOfWeek,
                hour: typeof schedule.hour === 'number' ? schedule.hour : DEFAULT_CONFIG.schedule.hour,
                minute: typeof schedule.minute === 'number' ? schedule.minute : DEFAULT_CONFIG.schedule.minute
            },
            lastRunAt: typeof cfg.lastRunAt === 'string' ? cfg.lastRunAt : null,
            lastRunStatus: typeof cfg.lastRunStatus === 'string' ? cfg.lastRunStatus : null
        };
    }

    private save() {
        try {
            atomicWriteSync(STORE_PATH, this.data);
        } catch (error) {
            log.error('Save Error', error);
        }
    }

    // --- Analysis ---

    getAnalysis(): FinancialAnalysisSnapshot | null {
        return this.data.analysis;
    }

    saveAnalysis(input: {
        data: unknown;
        status: 'success' | 'error';
        error?: string;
        lastRunAt?: string;
    }): FinancialAnalysisSnapshot {
        const snapshot: FinancialAnalysisSnapshot = {
            data: input.data,
            status: input.status,
            lastRunAt: input.lastRunAt ?? new Date().toISOString(),
            ...(input.error !== undefined ? { error: input.error } : {})
        };
        this.data.analysis = snapshot;
        this.save();
        log.info(`Saved analysis snapshot (status=${snapshot.status})`);
        return snapshot;
    }

    // --- Automation Config ---

    getAutomationConfig(): AutomationConfig {
        return this.data.automationConfig;
    }

    saveAutomationConfig(config: Partial<AutomationConfig>): AutomationConfig {
        const current = this.data.automationConfig;
        const merged: AutomationConfig = {
            enabled: typeof config.enabled === 'boolean' ? config.enabled : current.enabled,
            schedule: config.schedule
                ? {
                    dayOfWeek: typeof config.schedule.dayOfWeek === 'number' ? config.schedule.dayOfWeek : current.schedule.dayOfWeek,
                    hour: typeof config.schedule.hour === 'number' ? config.schedule.hour : current.schedule.hour,
                    minute: typeof config.schedule.minute === 'number' ? config.schedule.minute : current.schedule.minute
                }
                : current.schedule,
            lastRunAt: config.lastRunAt !== undefined ? config.lastRunAt : current.lastRunAt,
            lastRunStatus: config.lastRunStatus !== undefined ? config.lastRunStatus : current.lastRunStatus
        };
        this.data.automationConfig = merged;
        this.save();
        log.info(`Updated automation config (enabled=${merged.enabled})`);
        return merged;
    }
}

export const financialAnalysisStore = new FinancialAnalysisStoreService();
