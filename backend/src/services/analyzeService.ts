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

    const invoices = await dolibarrService.listInvoices({ limit: 500 });
    const referenceDate = new Date().toISOString();

    const currentYear = new Date().getFullYear();
    const currentMonth = new Date().getMonth();
    const targetMonths = [currentMonth, (currentMonth + 1) % 12, (currentMonth + 2) % 12];

    const relevantInvoices = invoices.filter(inv => {
        const dateVal = inv.date || (inv as any).datec || 0;
        const timestamp = typeof dateVal === 'string' ? new Date(dateVal).getTime() : (dateVal < 10000000000 ? dateVal * 1000 : dateVal);
        const invDate = new Date(timestamp);
        const invMonth = invDate.getMonth();
        const invYear = invDate.getFullYear();

        const monthsDiff = (currentYear * 12 + currentMonth) - (invYear * 12 + invMonth);
        if (monthsDiff >= 0 && monthsDiff <= 6) return true;
        if (invYear < currentYear && targetMonths.includes(invMonth)) return true;
        return false;
    });

    const aggregatedData: Record<string, number> = {};
    relevantInvoices.forEach(inv => {
        if (String(inv.statut) !== '1' && String(inv.statut) !== '2') return;
        const dateVal = inv.date || (inv as any).datec || 0;
        const timestamp = typeof dateVal === 'string' ? new Date(dateVal).getTime() : (dateVal < 10000000000 ? dateVal * 1000 : dateVal);
        const invDate = new Date(timestamp);
        const monthYear = `${String(invDate.getMonth() + 1).padStart(2, '0')}/${invDate.getFullYear()}`;
        if (!aggregatedData[monthYear]) aggregatedData[monthYear] = 0;
        aggregatedData[monthYear] += Number(inv.total_ttc) || 0;
    });

    const timeSeries = Object.entries(aggregatedData)
        .map(([periodo, faturamento]) => ({ periodo, faturamento_realizado: Number(faturamento.toFixed(2)) }))
        .sort((a, b) => {
            const [mA, yA] = a.periodo.split('/');
            const [mB, yB] = b.periodo.split('/');
            if (yA !== yB) return Number(yA) - Number(yB);
            return Number(mA) - Number(mB);
        });

    const result = await aiService.generateSalesForecast(timeSeries, { referenceDate, targetMonths }, 'banking');

    const snapshot = financialAnalysisStore.saveAnalysis({
        data: safeJsonParse(result),
        status: 'success',
        lastRunAt: new Date().toISOString(),
    });

    log.info(`Sales forecast analysis persisted (status=${snapshot.status})`);
    return { result, snapshot };
}
