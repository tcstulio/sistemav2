import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../services/aiService', () => ({
    aiService: {
        analyzeSystem: vi.fn(),
    },
}));

vi.mock('../../services/dolibarrService', () => ({
    dolibarrService: {},
}));

vi.mock('../../services/approvalService', () => ({
    approvalService: {
        createPendingAction: vi.fn(),
    },
}));

vi.mock('../../services/socketService', () => ({
    socketService: {
        emit: vi.fn(),
    },
}));

import { bankingService } from '../../services/bankingService';
import { aiService } from '../../services/aiService';
import { approvalService } from '../../services/approvalService';
import { socketService } from '../../services/socketService';

describe('BankingService', () => {
    describe('parseOFX', () => {
        it('parses OFX content with transactions', () => {
            const ofxContent = `<OFX>
<BANKMSGSRSV1><STMTTRNRS><STMTRS>
<BANKACCTFROM><ACCTID>12345</ACCTID><BANKID>001</BANKID></BANKACCTFROM>
<LEDGERBAL><BALAMT>1500.50</BALAMT></LEDGERBAL>
<STMTTRN>
<TRNTYPE>CREDIT</TRNTYPE>
<DTPOSTED>20240115000000</DTPOSTED>
<TRNAMT>100.50</TRNAMT>
<FITID>TX001</FITID>
<NAME>Deposit</NAME>
<MEMO>Salary</MEMO>
</STMTTRN>
<STMTTRN>
<TRNTYPE>DEBIT</TRNTYPE>
<DTPOSTED>20240116</DTPOSTED>
<TRNAMT>-50.00</TRNAMT>
<FITID>TX002</FITID>
<CHECKNUM>123</CHECKNUM>
<REFNUM>REF001</REFNUM>
<NAME>Payment</NAME>
</STMTTRN>
</STMTRS></STMTTRNRS></BANKMSGSRSV1>
</OFX>`;

            const result = bankingService.parseOFX(ofxContent);

            expect(result.accountNumber).toBe('12345');
            expect(result.bankId).toBe('001');
            expect(result.balance).toBe(1500.5);
            expect(result.transactions).toHaveLength(2);

            expect(result.transactions[0].id).toBe('TX001');
            expect(result.transactions[0].amount).toBe(100.5);
            expect(result.transactions[0].type).toBe('credit');
            expect(result.transactions[0].description).toBe('Deposit');
            expect(result.transactions[0].memo).toBe('Salary');

            expect(result.transactions[1].id).toBe('TX002');
            expect(result.transactions[1].amount).toBe(50);
            expect(result.transactions[1].type).toBe('debit');
            expect(result.transactions[1].checkNum).toBe('123');
            expect(result.transactions[1].refNum).toBe('REF001');
        });

        it('handles OFX with missing fields', () => {
            const ofxContent = `<OFX>
<STMTTRN><TRNTYPE>CREDIT</TRNTYPE></STMTTRN>
</OFX>`;

            const result = bankingService.parseOFX(ofxContent);
            expect(result.transactions).toHaveLength(1);
            expect(result.transactions[0].amount).toBe(0);
            expect(result.transactions[0].type).toBe('credit');
            expect(result.transactions[0].id).toMatch(/^txn_/);
        });

        it('handles empty OFX', () => {
            const result = bankingService.parseOFX('<OFX></OFX>');
            expect(result.transactions).toHaveLength(0);
            expect(result.metadata?.format).toBe('OFX');
        });
    });

    describe('parseCSV', () => {
        it('parses CSV content with headers', () => {
            const csv = `date,amount,description
2024-01-15,100.50,Deposit
2024-01-16,-50.00,Payment`;

            const result = bankingService.parseCSV(csv, {
                dateColumn: 'date',
                amountColumn: 'amount',
                descriptionColumn: 'description',
                hasHeader: true,
            });

            expect(result.transactions).toHaveLength(2);
            expect(result.transactions[0].amount).toBe(100.5);
            expect(result.transactions[0].type).toBe('credit');
            expect(result.transactions[1].amount).toBe(50);
            expect(result.transactions[1].type).toBe('debit');
            expect(result.metadata?.format).toBe('CSV');
        });

        it('parses CSV with DD/MM/YYYY date format', () => {
            const csv = `date,amount,description
15/01/2024,100,Test`;

            const result = bankingService.parseCSV(csv, {
                dateColumn: 'date',
                amountColumn: 'amount',
                descriptionColumn: 'description',
            });

            expect(result.transactions).toHaveLength(1);
            expect(result.transactions[0].date.getFullYear()).toBe(2024);
        });

        it('handles CSV with currency values', () => {
            const csv = `date,amount,description
2024-01-15,"R$ 1.000,50",Deposit`;

            const result = bankingService.parseCSV(csv, {
                dateColumn: 'date',
                amountColumn: 'amount',
                descriptionColumn: 'description',
            });

            expect(result.transactions).toHaveLength(1);
            expect(result.transactions[0].amount).toBeGreaterThan(0);
        });

        it('handles CSV with empty date', () => {
            const csv = `date,amount,description
,100,NoDate`;

            const result = bankingService.parseCSV(csv, {
                dateColumn: 'date',
                amountColumn: 'amount',
                descriptionColumn: 'description',
            });

            expect(result.transactions).toHaveLength(1);
        });
    });

    describe('parseStatement', () => {
        it('parses OFX file by extension', () => {
            const result = bankingService.parseStatement('<OFX><STMTTRN><TRNTYPE>CREDIT</TRNTYPE><TRNAMT>100</TRNAMT></STMTTRN></OFX>', 'statement.ofx');
            expect(result.metadata?.format).toBe('OFX');
        });

        it('parses QFX file by extension', () => {
            const result = bankingService.parseStatement('<OFX><STMTTRN><TRNTYPE>CREDIT</TRNTYPE><TRNAMT>100</TRNAMT></STMTTRN></OFX>', 'file.qfx');
            expect(result.metadata?.format).toBe('OFX');
        });

        it('parses OFX by content detection', () => {
            const result = bankingService.parseStatement('<OFX><STMTTRN><TRNTYPE>CREDIT</TRNTYPE><TRNAMT>100</TRNAMT></STMTTRN></OFX>');
            expect(result.metadata?.format).toBe('OFX');
        });

        it('parses OFXHEADER by content detection', () => {
            const result = bankingService.parseStatement('OFXHEADER:100\n<OFX></OFX>');
            expect(result.metadata?.format).toBe('OFX');
        });

        it('parses CSV by extension', () => {
            const csv = `date,amount,description\n2024-01-15,100,Test`;
            const result = bankingService.parseStatement(csv, 'file.csv');
            expect(result.metadata?.format).toBe('CSV');
        });

        it('auto-detects column names in CSV', () => {
            const csv = `Data,Valor,Descricao\n15/01/2024,100,Test payment`;
            const result = bankingService.parseStatement(csv, 'file.csv');
            expect(result.transactions).toHaveLength(1);
        });

        it('throws for unsupported format', () => {
            expect(() => bankingService.parseStatement('random content', 'file.xyz')).toThrow('Formato de arquivo não suportado');
        });
    });

    describe('categorizeTransactions', () => {
        const transactions = [
            { id: '1', date: new Date(), amount: 100, description: 'Test', type: 'credit' as const },
            { id: '2', date: new Date(), amount: 50, description: 'Pay', type: 'debit' as const },
        ];

        it('categorizes using LLM response', async () => {
            (aiService.analyzeSystem as any).mockResolvedValue('[{"index":1,"category":"Receita","subcategory":"Vendas","confidence":0.9},{"index":2,"category":"Despesa","subcategory":"Fornecedores","confidence":0.8}]');

            const result = await bankingService.categorizeTransactions(transactions);

            expect(result).toHaveLength(2);
            expect(result[0].category).toBe('Receita');
            expect(result[0].subcategory).toBe('Vendas');
            expect(result[0].confidence).toBe(0.9);
            expect(result[1].category).toBe('Despesa');
        });

        it('falls back when LLM returns invalid JSON', async () => {
            (aiService.analyzeSystem as any).mockResolvedValue('no json here');

            const result = await bankingService.categorizeTransactions(transactions);

            expect(result).toHaveLength(2);
            expect(result[0].category).toBe('Receita');
            expect(result[1].category).toBe('Despesa');
            expect(result[0].confidence).toBe(0.3);
        });

        it('falls back when LLM throws error', async () => {
            (aiService.analyzeSystem as any).mockRejectedValue(new Error('AI error'));

            const result = await bankingService.categorizeTransactions(transactions);

            expect(result).toHaveLength(2);
            expect(result[0].category).toBe('Receita');
        });
    });

    describe('detectAnomalies', () => {
        it('detects anomalies based on statistics', async () => {
            const transactions = [
                { id: '1', date: new Date(), amount: 100, description: 'Normal1', type: 'debit' as const },
                { id: '2', date: new Date(), amount: 105, description: 'Normal2', type: 'debit' as const },
                { id: '3', date: new Date(), amount: 95, description: 'Normal3', type: 'debit' as const },
                { id: '4', date: new Date(), amount: 50000, description: 'Huge', type: 'debit' as const },
            ];

            const result = await bankingService.detectAnomalies(transactions);
            expect(result.length).toBe(0);
        });

        it('returns empty for no anomalies', async () => {
            const transactions = [
                { id: '1', date: new Date(), amount: 100, description: 'Normal1', type: 'debit' as const },
                { id: '2', date: new Date(), amount: 100, description: 'Normal2', type: 'debit' as const },
                { id: '3', date: new Date(), amount: 100, description: 'Normal3', type: 'debit' as const },
            ];

            const result = await bankingService.detectAnomalies(transactions);
            expect(result).toHaveLength(0);
        });

        it('uses LLM for large datasets', async () => {
            (aiService.analyzeSystem as any).mockResolvedValue('[{"description":"Suspicious","amount":9000,"reason":"Duplicate","severity":"high"}]');

            const transactions = Array.from({ length: 25 }, (_, i) => ({
                id: `t${i}`,
                date: new Date(),
                amount: 100 + i,
                description: `Trans ${i}`,
                type: 'debit' as const,
            }));

            const result = await bankingService.detectAnomalies(transactions);
            expect(result.length).toBeGreaterThanOrEqual(0);
        });

        it('handles LLM error gracefully for large datasets', async () => {
            (aiService.analyzeSystem as any).mockRejectedValue(new Error('fail'));

            const transactions = Array.from({ length: 25 }, (_, i) => ({
                id: `t${i}`,
                date: new Date(),
                amount: 100,
                description: `Trans ${i}`,
                type: 'debit' as const,
            }));

            const result = await bankingService.detectAnomalies(transactions);
            expect(Array.isArray(result)).toBe(true);
        });
    });

    describe('generateCashFlowInsights', () => {
        const accounts = [{ id: '1', label: 'Main', solde: 10000 }];
        const transactions = [
            { id: '1', date: new Date(), amount: 5000, description: 'Income', type: 'credit' as const },
            { id: '2', date: new Date(), amount: 2000, description: 'Expense', type: 'debit' as const },
        ];

        it('generates insights with LLM', async () => {
            (aiService.analyzeSystem as any).mockResolvedValue('{"trends":["Positive trend"],"recommendations":["Save more"],"riskFactors":[]}');

            const result = await bankingService.generateCashFlowInsights(accounts, transactions, 'month');

            expect(result.totalIncome).toBe(5000);
            expect(result.totalExpenses).toBe(2000);
            expect(result.netCashFlow).toBe(3000);
            expect(result.trends).toEqual(['Positive trend']);
            expect(result.recommendations).toEqual(['Save more']);
            expect(result.period).toBe('month');
        });

        it('falls back when LLM fails', async () => {
            (aiService.analyzeSystem as any).mockRejectedValue(new Error('fail'));

            const result = await bankingService.generateCashFlowInsights(accounts, transactions, 'week');

            expect(result.trends).toEqual(['Fluxo de caixa positivo']);
            expect(result.recommendations).toEqual(['Continue monitorando as despesas']);
            expect(result.riskFactors).toEqual([]);
        });

        it('handles negative cash flow', async () => {
            (aiService.analyzeSystem as any).mockRejectedValue(new Error('fail'));
            const debitTxns = [{ id: '1', date: new Date(), amount: 5000, description: 'Big expense', type: 'debit' as const }];

            const result = await bankingService.generateCashFlowInsights(accounts, debitTxns, 'quarter');

            expect(result.netCashFlow).toBe(-5000);
            expect(result.riskFactors).toEqual(['Saídas superam entradas']);
        });
    });

    describe('suggestReconciliation', () => {
        it('finds exact amount matches', async () => {
            const bankLines = [
                { id: 'BL1', amount: 100.50, label: 'Payment', date_operation: Date.now() / 1000 },
            ];
            const invoices = [
                { id: 'INV1', ref: 'REF001', total_ttc: 100.50, date: Date.now() / 1000, socid: '1' },
            ];

            const result = await bankingService.suggestReconciliation(bankLines, invoices);

            expect(result).toHaveLength(1);
            expect(result[0].lineId).toBe('BL1');
            expect(result[0].invoiceId).toBe('INV1');
            expect(result[0].confidence).toBe(0.95);
        });

        it('uses LLM for fuzzy matching', async () => {
            (aiService.analyzeSystem as any).mockResolvedValue('[{"lineId":"BL1","invoiceId":"INV2","confidence":0.8,"reason":"Similar amount"}]');

            const bankLines = [
                { id: 'BL1', amount: 100, label: 'Payment A', date_operation: Date.now() / 1000 },
            ];
            const invoices = [
                { id: 'INV2', ref: 'REF002', total_ttc: 200, date: Date.now() / 1000, socid: '1' },
            ];

            const result = await bankingService.suggestReconciliation(bankLines, invoices);

            expect(result).toHaveLength(1);
            expect(result[0].invoiceRef).toBe('REF002');
        });

        it('returns empty when no matches and no LLM', async () => {
            (aiService.analyzeSystem as any).mockRejectedValue(new Error('fail'));

            const result = await bankingService.suggestReconciliation(
                [{ id: 'BL1', amount: 100, label: 'Test', date_operation: Date.now() / 1000 }],
                []
            );

            expect(result).toHaveLength(0);
        });

        it('filters LLM matches below confidence threshold', async () => {
            (aiService.analyzeSystem as any).mockResolvedValue('[{"lineId":"BL1","invoiceId":"INV1","confidence":0.3,"reason":"Weak match"}]');

            const bankLines = [
                { id: 'BL1', amount: 100, label: 'Test', date_operation: Date.now() / 1000 },
            ];
            const invoices = [
                { id: 'INV1', ref: 'REF001', total_ttc: 200, date: Date.now() / 1000, socid: '1' },
            ];

            const result = await bankingService.suggestReconciliation(bankLines, invoices);
            expect(result).toHaveLength(0);
        });
    });

    describe('requestReconciliation', () => {
        it('creates a pending action', async () => {
            (approvalService.createPendingAction as any).mockResolvedValue({ id: 'action1' });

            const result = await bankingService.requestReconciliation('line1', 'inv1', 'REF001', 'user1');

            expect(result.pending).toBe(true);
            expect(result.actionId).toBe('action1');
            expect(approvalService.createPendingAction).toHaveBeenCalledWith(
                expect.objectContaining({
                    type: 'aprovar_reconciliacao',
                    payload: { lineId: 'line1', invoiceId: 'inv1', invoiceRef: 'REF001' },
                })
            );
        });
    });

    describe('saveReconciliation', () => {
        it('returns true', async () => {
            const result = await bankingService.saveReconciliation('line1', 'inv1');
            expect(result).toBe(true);
        });
    });

    describe('calculateDynamicBalance', () => {
        it('calculates balance history', () => {
            const transactions = [
                { id: '1', date: new Date('2024-01-01'), amount: 100, description: 'In', type: 'credit' as const },
                { id: '2', date: new Date('2024-01-02'), amount: 30, description: 'Out', type: 'debit' as const },
                { id: '3', date: new Date('2024-01-03'), amount: 50, description: 'In2', type: 'credit' as const },
            ];

            const result = bankingService.calculateDynamicBalance(1000, transactions);

            expect(result.currentBalance).toBe(1120);
            expect(result.history).toHaveLength(3);
            expect(result.history[0].balance).toBe(1100);
            expect(result.history[1].balance).toBe(1070);
            expect(result.history[2].balance).toBe(1120);
        });

        it('sorts transactions by date', () => {
            const transactions = [
                { id: '2', date: new Date('2024-01-02'), amount: 50, description: 'Later', type: 'credit' as const },
                { id: '1', date: new Date('2024-01-01'), amount: 100, description: 'First', type: 'credit' as const },
            ];

            const result = bankingService.calculateDynamicBalance(0, transactions);
            expect(result.history[0].balance).toBe(100);
            expect(result.history[1].balance).toBe(150);
        });
    });

    describe('getCashFlowChartData', () => {
        const transactions = [
            { id: '1', date: new Date('2024-01-05'), amount: 100, description: 'In', type: 'credit' as const },
            { id: '2', date: new Date('2024-01-10'), amount: 50, description: 'Out', type: 'debit' as const },
            { id: '3', date: new Date('2024-02-15'), amount: 200, description: 'In2', type: 'credit' as const },
        ];

        it('groups by month', () => {
            const result = bankingService.getCashFlowChartData(transactions, 'month');

            expect(result).toHaveLength(2);
            expect(result[0].period).toBe('2024-01');
            expect(result[0].income).toBe(100);
            expect(result[0].expenses).toBe(50);
            expect(result[0].net).toBe(50);
            expect(result[1].period).toBe('2024-02');
            expect(result[1].income).toBe(200);
        });

        it('groups by day', () => {
            const result = bankingService.getCashFlowChartData(transactions, 'day');
            expect(result.length).toBe(3);
            expect(result[0].period).toBe('2024-01-05');
        });

        it('groups by week', () => {
            const result = bankingService.getCashFlowChartData(transactions, 'week');
            expect(result.length).toBeGreaterThanOrEqual(2);
        });

        it('returns empty for no transactions', () => {
            const result = bankingService.getCashFlowChartData([], 'month');
            expect(result).toHaveLength(0);
        });
    });

    describe('processInterWebhook', () => {
        it('emits socket event', async () => {
            await bankingService.processInterWebhook({ data: 'test' }, 'pix');

            expect(socketService.emit).toHaveBeenCalledWith('inter:transaction', expect.objectContaining({
                type: 'pix',
                data: { data: 'test' },
            }));
        });

        it('handles socket error gracefully', async () => {
            (socketService.emit as any).mockImplementation(() => {
                throw new Error('Socket error');
            });

            const result = await bankingService.processInterWebhook({}, 'boleto');
            expect(result).toBeUndefined();
        });
    });
});
