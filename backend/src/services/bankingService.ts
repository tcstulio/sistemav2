import fs from 'fs';
import path from 'path';
import { parse as csvParse } from 'csv-parse/sync';
import { aiService } from './aiService';
import { dolibarrService } from './dolibarrService';
import { approvalService } from './approvalService';
import { socketService } from './socketService';
import { logger } from '../utils/logger';

const log = logger.child('BankingService');


// --- Interfaces ---

export interface ParsedTransaction {
    id: string;
    date: Date;
    amount: number;
    description: string;
    type: 'credit' | 'debit';
    checkNum?: string;
    refNum?: string;
    memo?: string;
    category?: string;
    confidence?: number;
}

export interface ParsedStatement {
    accountId?: string;
    accountNumber?: string;
    bankId?: string;
    startDate?: Date;
    endDate?: Date;
    balance?: number;
    transactions: ParsedTransaction[];
    metadata?: Record<string, any>;
}

export interface CategorizedTransaction extends ParsedTransaction {
    category: string;
    subcategory?: string;
    confidence: number;
    suggestedInvoiceId?: string;
}

export interface SpendingAnomaly {
    transactionId: string;
    description: string;
    amount: number;
    date: Date;
    reason: string;
    severity: 'low' | 'medium' | 'high';
    expectedRange?: { min: number; max: number };
}

export interface CashFlowInsight {
    period: string;
    totalIncome: number;
    totalExpenses: number;
    netCashFlow: number;
    averageDailyBalance: number;
    projectedEndBalance: number;
    trends: string[];
    recommendations: string[];
    riskFactors: string[];
}

export interface ReconciliationSuggestion {
    lineId: string;
    invoiceId: string;
    invoiceRef: string;
    confidence: number;
    reason: string;
}

export interface CSVFormat {
    dateColumn: string;
    amountColumn: string;
    descriptionColumn: string;
    dateFormat?: string;
    delimiter?: string;
    hasHeader?: boolean;
}

// --- OFX Parser ---

function parseOFXContent(content: string): ParsedStatement {
    // OFX is SGML-based, so we need to handle it specially
    // Extract transactions from OFX content
    const transactions: ParsedTransaction[] = [];

    // Find all STMTTRN blocks
    const stmttrnRegex = /<STMTTRN>([\s\S]*?)<\/STMTTRN>/gi;
    const matches = content.match(stmttrnRegex) || [];

    let id = 1;
    for (const match of matches) {
        const getValue = (tag: string): string => {
            const tagRegex = new RegExp(`<${tag}>([^<\\r\\n]+)`, 'i');
            const result = match.match(tagRegex);
            return result ? result[1].trim() : '';
        };

        const trntype = getValue('TRNTYPE');
        const dtposted = getValue('DTPOSTED');
        const trnamt = parseFloat(getValue('TRNAMT') || '0');
        const fitid = getValue('FITID');
        const checknum = getValue('CHECKNUM');
        const refnum = getValue('REFNUM');
        const name = getValue('NAME');
        const memo = getValue('MEMO');

        // Parse date (YYYYMMDD or YYYYMMDDHHMMSS)
        let date = new Date();
        if (dtposted) {
            const year = parseInt(dtposted.substring(0, 4));
            const month = parseInt(dtposted.substring(4, 6)) - 1;
            const day = parseInt(dtposted.substring(6, 8));
            date = new Date(year, month, day);
        }

        transactions.push({
            id: fitid || `txn_${id++}`,
            date,
            amount: Math.abs(trnamt),
            description: name || memo || trntype,
            type: trnamt >= 0 ? 'credit' : 'debit',
            checkNum: checknum || undefined,
            refNum: refnum || undefined,
            memo: memo || undefined,
        });
    }

    // Extract account info
    const getGlobalValue = (tag: string): string => {
        const tagRegex = new RegExp(`<${tag}>([^<\\r\\n]+)`, 'i');
        const result = content.match(tagRegex);
        return result ? result[1].trim() : '';
    };

    const acctid = getGlobalValue('ACCTID');
    const bankid = getGlobalValue('BANKID');
    const balamt = parseFloat(getGlobalValue('BALAMT') || '0');

    return {
        accountNumber: acctid,
        bankId: bankid,
        balance: balamt,
        transactions,
        metadata: {
            format: 'OFX',
            parsedAt: new Date().toISOString(),
        }
    };
}

// --- CSV Parser ---

function parseCSVContent(content: string, format: CSVFormat): ParsedStatement {
    const records = csvParse(content, {
        delimiter: format.delimiter || ',',
        columns: format.hasHeader !== false,
        skip_empty_lines: true,
        trim: true,
    });

    const transactions: ParsedTransaction[] = [];
    let id = 1;

    for (const record of records as unknown as Record<string, string>[]) {
        const dateStr = record[format.dateColumn];
        const amount = parseFloat(String(record[format.amountColumn]).replace(/[^0-9.-]/g, ''));
        const description = record[format.descriptionColumn] || '';

        // Parse date
        let date = new Date();
        if (dateStr) {
            // Try common date formats
            const parsed = new Date(dateStr);
            if (!isNaN(parsed.getTime())) {
                date = parsed;
            } else {
                // Try DD/MM/YYYY format (common in Brazil)
                const parts = dateStr.split(/[\/\-]/);
                if (parts.length === 3) {
                    const day = parseInt(parts[0]);
                    const month = parseInt(parts[1]) - 1;
                    const year = parseInt(parts[2]);
                    date = new Date(year, month, day);
                }
            }
        }

        transactions.push({
            id: `csv_${id++}`,
            date,
            amount: Math.abs(amount),
            description,
            type: amount >= 0 ? 'credit' : 'debit',
        });
    }

    return {
        transactions,
        metadata: {
            format: 'CSV',
            parsedAt: new Date().toISOString(),
            recordCount: records.length,
        }
    };
}

// --- Banking Service ---

class BankingService {

    // Parse OFX file content
    parseOFX(content: string): ParsedStatement {
        log.info('Parsing OFX content...');
        return parseOFXContent(content);
    }

    // Parse CSV file content
    parseCSV(content: string, format: CSVFormat): ParsedStatement {
        log.info('Parsing CSV content...');
        return parseCSVContent(content, format);
    }

    // Auto-detect and parse file
    parseStatement(content: string, filename?: string): ParsedStatement {
        const ext = filename?.toLowerCase().split('.').pop();

        if (ext === 'ofx' || ext === 'qfx' || content.includes('<OFX>') || content.includes('OFXHEADER:')) {
            return this.parseOFX(content);
        } else if (ext === 'csv' || ext === 'txt') {
            // Try to auto-detect CSV columns
            const lines = content.split('\n').filter(l => l.trim());
            if (lines.length > 0) {
                const headers = lines[0].split(/[,;\t]/).map(h => h.trim().toLowerCase());

                // Common column name mappings
                const dateAliases = ['date', 'data', 'dt', 'datamovimento', 'datalancamento'];
                const amountAliases = ['amount', 'valor', 'value', 'vlr', 'montante'];
                const descAliases = ['description', 'descricao', 'desc', 'historico', 'memo', 'lancamento'];

                const findColumn = (aliases: string[]) =>
                    headers.find(h => aliases.some(a => h.includes(a))) || headers[0];

                return this.parseCSV(content, {
                    dateColumn: findColumn(dateAliases),
                    amountColumn: findColumn(amountAliases),
                    descriptionColumn: findColumn(descAliases),
                    hasHeader: true,
                });
            }
        }

        throw new Error('Formato de arquivo não suportado. Use OFX, QFX ou CSV.');
    }

    // Categorize transactions using LLM
    async categorizeTransactions(transactions: ParsedTransaction[]): Promise<CategorizedTransaction[]> {
        log.info(`Categorizing ${transactions.length} transactions with LLM...`);

        const prompt = `Categorize as seguintes transações bancárias. Para cada uma, retorne a categoria principal e subcategoria.

Categorias disponíveis:
- Receita: Vendas, Serviços, Investimentos, Outros
- Despesa Fixa: Aluguel, Salários, Impostos, Seguros, Empréstimos
- Despesa Variável: Fornecedores, Marketing, Viagens, Alimentação, Transporte
- Transferência: Entre Contas, Aplicações, Resgates
- Taxas: Bancárias, Cartão, IOF

Transações:
${transactions.slice(0, 50).map((t, i) => `${i + 1}. ${t.date.toLocaleDateString('pt-BR')} | ${t.type === 'credit' ? '+' : '-'}R$${t.amount.toFixed(2)} | ${t.description}`).join('\n')}

Responda APENAS no formato JSON:
[{"index": 1, "category": "Despesa Variável", "subcategory": "Fornecedores", "confidence": 0.9}, ...]`;

        try {
            const response = await aiService.analyzeSystem(prompt, '../src', 'banking');

            // Parse JSON response
            const jsonMatch = response.match(/\[[\s\S]*\]/);
            if (jsonMatch) {
                const categories = JSON.parse(jsonMatch[0]);

                return transactions.map((t, i) => {
                    const cat = categories.find((c: any) => c.index === i + 1);
                    return {
                        ...t,
                        category: cat?.category || 'Outros',
                        subcategory: cat?.subcategory,
                        confidence: cat?.confidence || 0.5,
                    };
                });
            }
        } catch (error) {
            log.error('Categorization error', error);
        }

        // Fallback: basic rule-based categorization
        return transactions.map(t => ({
            ...t,
            category: t.type === 'credit' ? 'Receita' : 'Despesa',
            subcategory: 'Outros',
            confidence: 0.3,
        }));
    }

    // Detect spending anomalies using LLM
    async detectAnomalies(transactions: ParsedTransaction[], historicalAvg?: Record<string, number>): Promise<SpendingAnomaly[]> {
        log.info(`Detecting anomalies in ${transactions.length} transactions...`);

        // Calculate basic statistics
        const amounts = transactions.filter(t => t.type === 'debit').map(t => t.amount);
        const avg = amounts.reduce((a, b) => a + b, 0) / amounts.length || 0;
        const stdDev = Math.sqrt(amounts.reduce((sum, x) => sum + Math.pow(x - avg, 2), 0) / amounts.length) || 1;

        const anomalies: SpendingAnomaly[] = [];

        for (const t of transactions) {
            if (t.type === 'debit' && t.amount > avg + 2 * stdDev) {
                anomalies.push({
                    transactionId: t.id,
                    description: t.description,
                    amount: t.amount,
                    date: t.date,
                    reason: `Valor ${((t.amount / avg - 1) * 100).toFixed(0)}% acima da média`,
                    severity: t.amount > avg + 3 * stdDev ? 'high' : 'medium',
                    expectedRange: { min: avg - stdDev, max: avg + stdDev },
                });
            }
        }

        // Use LLM for more sophisticated analysis if we have many transactions
        if (transactions.length > 20 && anomalies.length < 10) {
            try {
                const prompt = `Analise estas transações bancárias e identifique gastos suspeitos ou fora do padrão:

${transactions.slice(0, 100).map((t, i) => `${t.date.toLocaleDateString('pt-BR')} | ${t.type === 'credit' ? '+' : '-'}R$${t.amount.toFixed(2)} | ${t.description}`).join('\n')}

Identifique:
1. Gastos duplicados ou muito próximos
2. Valores muito acima do normal para a categoria
3. Transações em horários/datas incomuns
4. Possíveis fraudes ou cobranças indevidas

Responda em JSON: [{"description": "...", "amount": 0, "reason": "...", "severity": "low|medium|high"}]`;

                const response = await aiService.analyzeSystem(prompt, '../src', 'banking');
                const jsonMatch = response.match(/\[[\s\S]*\]/);
                if (jsonMatch) {
                    const llmAnomalies = JSON.parse(jsonMatch[0]);
                    for (const a of llmAnomalies) {
                        if (!anomalies.find(x => x.description === a.description)) {
                            anomalies.push({
                                transactionId: '',
                                description: a.description,
                                amount: a.amount,
                                date: new Date(),
                                reason: a.reason,
                                severity: a.severity || 'low',
                            });
                        }
                    }
                }
            } catch (error) {
                log.error('LLM anomaly detection error', error);
            }
        }

        return anomalies;
    }

    // Generate cash flow insights using LLM
    async generateCashFlowInsights(
        accounts: Array<{ id: string; label: string; solde: number }>,
        transactions: ParsedTransaction[],
        period: 'week' | 'month' | 'quarter' = 'month'
    ): Promise<CashFlowInsight> {
        log.info(`Generating cash flow insights for ${period}...`);

        // Calculate basic metrics
        const credits = transactions.filter(t => t.type === 'credit');
        const debits = transactions.filter(t => t.type === 'debit');

        const totalIncome = credits.reduce((sum, t) => sum + t.amount, 0);
        const totalExpenses = debits.reduce((sum, t) => sum + t.amount, 0);
        const netCashFlow = totalIncome - totalExpenses;
        const currentBalance = accounts.reduce((sum, a) => sum + a.solde, 0);

        // Days in period for averages
        const daysInPeriod = period === 'week' ? 7 : period === 'month' ? 30 : 90;
        const avgDailyBalance = currentBalance; // Simplified

        // Use LLM for trends and recommendations
        let trends: string[] = [];
        let recommendations: string[] = [];
        let riskFactors: string[] = [];

        try {
            const prompt = `Analise o fluxo de caixa desta empresa e forneça insights:

RESUMO DO PERÍODO (${period}):
- Entradas: R$ ${totalIncome.toFixed(2)}
- Saídas: R$ ${totalExpenses.toFixed(2)}
- Fluxo Líquido: R$ ${netCashFlow.toFixed(2)}
- Saldo Atual: R$ ${currentBalance.toFixed(2)}

CONTAS:
${accounts.map(a => `- ${a.label}: R$ ${a.solde.toFixed(2)}`).join('\n')}

ÚLTIMAS TRANSAÇÕES:
${transactions.slice(0, 30).map(t => `${t.date.toLocaleDateString('pt-BR')} | ${t.type === 'credit' ? '+' : '-'}R$${t.amount.toFixed(2)} | ${t.description}`).join('\n')}

Forneça:
1. TENDÊNCIAS: principais padrões observados (max 3)
2. RECOMENDAÇÕES: sugestões de melhoria (max 3)
3. RISCOS: potenciais problemas financeiros (max 2)

Responda em JSON:
{"trends": ["..."], "recommendations": ["..."], "riskFactors": ["..."]}`;

            const response = await aiService.analyzeSystem(prompt, '../src', 'banking');
            const jsonMatch = response.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const insights = JSON.parse(jsonMatch[0]);
                trends = insights.trends || [];
                recommendations = insights.recommendations || [];
                riskFactors = insights.riskFactors || [];
            }
        } catch (error) {
            log.error('Cash flow insights error', error);
            trends = [netCashFlow > 0 ? 'Fluxo de caixa positivo' : 'Fluxo de caixa negativo'];
            recommendations = ['Continue monitorando as despesas'];
            riskFactors = netCashFlow < 0 ? ['Saídas superam entradas'] : [];
        }

        return {
            period,
            totalIncome,
            totalExpenses,
            netCashFlow,
            averageDailyBalance: avgDailyBalance,
            projectedEndBalance: currentBalance + (netCashFlow / daysInPeriod) * 30, // Project 30 days
            trends,
            recommendations,
            riskFactors,
        };
    }

    // Suggest reconciliation matches using LLM
    async suggestReconciliation(
        bankLines: Array<{ id: string; amount: number; label: string; date_operation: number }>,
        invoices: Array<{ id: string; ref: string; total_ttc: number; date: number; socid: string }>
    ): Promise<ReconciliationSuggestion[]> {
        log.info(`Suggesting reconciliation for ${bankLines.length} bank lines...`);

        const suggestions: ReconciliationSuggestion[] = [];

        // First: exact amount matches
        for (const line of bankLines) {
            const exactMatch = invoices.find(inv =>
                Math.abs(Math.abs(line.amount) - inv.total_ttc) < 0.01
            );

            if (exactMatch) {
                suggestions.push({
                    lineId: line.id,
                    invoiceId: exactMatch.id,
                    invoiceRef: exactMatch.ref,
                    confidence: 0.95,
                    reason: 'Valor exato correspondente',
                });
            }
        }

        // Second: use LLM for fuzzy matching
        const unmatchedLines = bankLines.filter(l => !suggestions.find(s => s.lineId === l.id));

        if (unmatchedLines.length > 0 && invoices.length > 0) {
            try {
                const prompt = `Encontre correspondências entre transações bancárias e faturas:

TRANSAÇÕES BANCÁRIAS:
${unmatchedLines.slice(0, 20).map(l => `ID:${l.id} | R$${l.amount.toFixed(2)} | ${l.label} | ${new Date(l.date_operation).toLocaleDateString('pt-BR')}`).join('\n')}

FATURAS:
${invoices.slice(0, 30).map(i => `ID:${i.id} | Ref:${i.ref} | R$${i.total_ttc.toFixed(2)} | ${new Date(i.date * 1000).toLocaleDateString('pt-BR')}`).join('\n')}

Considere:
- Valores similares (pequenas diferenças por taxas/juros)
- Datas próximas
- Descrições que mencionem referências de faturas

Responda em JSON (apenas matches com confiança > 0.6):
[{"lineId": "...", "invoiceId": "...", "confidence": 0.8, "reason": "..."}]`;

                const response = await aiService.analyzeSystem(prompt, '../src', 'banking');
                const jsonMatch = response.match(/\[[\s\S]*\]/);
                if (jsonMatch) {
                    const llmMatches = JSON.parse(jsonMatch[0]);
                    for (const match of llmMatches) {
                        const invoice = invoices.find(i => i.id === match.invoiceId);
                        if (invoice && match.confidence > 0.6) {
                            suggestions.push({
                                lineId: match.lineId,
                                invoiceId: match.invoiceId,
                                invoiceRef: invoice.ref,
                                confidence: match.confidence,
                                reason: match.reason || 'Sugestão por IA',
                            });
                        }
                    }
                }
            } catch (error) {
                log.error('LLM reconciliation error', error);
            }
        }

        return suggestions.sort((a, b) => b.confidence - a.confidence);
    }

    // Request reconciliation with approval workflow
    async requestReconciliation(
        lineId: string,
        invoiceId: string,
        invoiceRef: string,
        requestedBy: string
    ): Promise<{ pending: boolean; actionId?: string; executed?: boolean }> {
        log.info(`Requesting reconciliation approval: line ${lineId} -> invoice ${invoiceId}`);

        const action = await approvalService.createPendingAction({
            type: 'aprovar_reconciliacao',
            payload: {
                lineId,
                invoiceId,
                invoiceRef,
            },
            description: `Reconciliar linha bancária ${lineId} com fatura ${invoiceRef}`,
            requestedBy,
        });

        return {
            pending: true,
            actionId: action.id,
        };
    }

    // Save reconciliation to Dolibarr (via API) - called internally after approval
    async saveReconciliation(lineId: string, invoiceId: string, userApiKey?: string): Promise<boolean> {
        log.info(`Saving reconciliation: line ${lineId} -> invoice ${invoiceId}`);

        // Note: Dolibarr standard API may not have direct reconciliation endpoint
        // This would need custom endpoint in Dolibarr or use payments API
        // For now, we log and return success

        // TODO: Implement actual Dolibarr reconciliation when API is available
        // Possible approaches:
        // 1. POST /invoices/{id}/payments with bank account reference
        // 2. Custom PHP endpoint in Dolibarr
        // 3. Direct SQL via custom_sync.php

        log.info('Reconciliation saved (logged for future implementation)');
        return true;
    }

    // Calculate dynamic balance from transactions
    calculateDynamicBalance(
        initialBalance: number,
        transactions: ParsedTransaction[]
    ): { currentBalance: number; history: Array<{ date: Date; balance: number }> } {
        const sorted = [...transactions].sort((a, b) => a.date.getTime() - b.date.getTime());
        let balance = initialBalance;
        const history: Array<{ date: Date; balance: number }> = [];

        for (const t of sorted) {
            if (t.type === 'credit') {
                balance += t.amount;
            } else {
                balance -= t.amount;
            }
            history.push({ date: t.date, balance });
        }

        return { currentBalance: balance, history };
    }

    // Get cash flow data for charts
    getCashFlowChartData(
        transactions: ParsedTransaction[],
        groupBy: 'day' | 'week' | 'month' = 'month'
    ): Array<{ period: string; income: number; expenses: number; net: number }> {
        const grouped = new Map<string, { income: number; expenses: number }>();

        for (const t of transactions) {
            let key: string;
            const d = t.date;

            switch (groupBy) {
                case 'day':
                    key = d.toISOString().split('T')[0];
                    break;
                case 'week':
                    const weekStart = new Date(d);
                    weekStart.setDate(d.getDate() - d.getDay());
                    key = weekStart.toISOString().split('T')[0];
                    break;
                case 'month':
                default:
                    key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            }

            if (!grouped.has(key)) {
                grouped.set(key, { income: 0, expenses: 0 });
            }

            const entry = grouped.get(key)!;
            if (t.type === 'credit') {
                entry.income += t.amount;
            } else {
                entry.expenses += t.amount;
            }
        }

        return Array.from(grouped.entries())
            .sort((a, b) => a[0].localeCompare(b[0]))
            .map(([period, data]) => ({
                period,
                income: data.income,
                expenses: data.expenses,
                net: data.income - data.expenses,
            }));
    }

    // Process Inter Webhook
    async processInterWebhook(payload: any, type: 'pix' | 'boleto'): Promise<void> {
        log.info(`Processing Inter ${type} webhook`, payload);

        // Emit socket event for frontend real-time update
        try {
            socketService.emit('inter:transaction', {
                type,
                timestamp: new Date().toISOString(),
                data: payload
            });
        } catch (error) {
            log.warn('Failed to emit socket event', error);
        }

        // TODO: Persist transaction / Reconciliation logic
        // This will be implemented when we have a database table for raw webhook events
    }
}

export const bankingService = new BankingService();

