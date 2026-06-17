import { createLogger } from '../utils/logger';
import { dolibarrService } from './dolibarr';
import { aiService } from './aiService';
import { financialAnalysisStore, FinancialAnalysisSnapshot } from './financialAnalysisStore';

const log = createLogger('Analyze');

export interface SalesForecastAnalysisResult {
    result: string;
    snapshot: FinancialAnalysisSnapshot;
}

// A IA retorna um JSON em texto; tenta estruturar para persistência, com fallback.
function safeJsonParse(raw: string): unknown {
    try {
        return JSON.parse(raw);
    } catch {
        return raw;
    }
}

/**
 * Executa o pipeline de análise de forecast de vendas usando a MESMA função
 * (aiService.generateSalesForecast) que a rota POST /analyze/sales-forecast usa,
 * buscando as faturas server-side e persistindo o snapshot resultante via
 * financialAnalysisStore. Sem duplicar a lógica de geração do forecast.
 */
export async function runSalesForecastAnalysis(): Promise<SalesForecastAnalysisResult> {
    log.info('Running sales forecast analysis');

    const invoices = await dolibarrService.listInvoices({ limit: 200 });
    const referenceDate = new Date().toISOString();
    const result = await aiService.generateSalesForecast(invoices, { referenceDate });

    const snapshot = financialAnalysisStore.saveAnalysis({
        data: safeJsonParse(result),
        status: 'success',
        lastRunAt: new Date().toISOString(),
    });

    log.info(`Sales forecast analysis persisted (status=${snapshot.status})`);
    return { result, snapshot };
}
