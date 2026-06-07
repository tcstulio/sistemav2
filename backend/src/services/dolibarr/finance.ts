import axios from 'axios';
import { DolibarrServiceBase } from './core';
import { createLogger } from '../../utils/logger';

const log = createLogger('DolibarrFinance');

export interface BankBalance {
    accountId: string;
    ref: string;
    label: string;
    balance: number;
    transactionCount: number;
}

export interface ReceivableItem {
    id: string;
    ref: string;
    totalTtc: number;
    dueDate: string | null;
    isOverdue: boolean;
    socid: string;
    socName: string;
}

export interface PayableItem {
    id: string;
    ref: string;
    totalTtc: number;
    dueDate: string | null;
    isOverdue: boolean;
    type: 'supplier_invoice' | 'expense_report';
    socid?: string;
    socName?: string;
}

export interface CashFlowPeriod {
    period: string;
    receivable: number;
    payable: number;
    net: number;
    cumulativeNet: number;
}

export interface FinancialSummary {
    date: string;
    bankBalances: BankBalance[];
    totalBankBalance: number;
    totalReceivable: number;
    totalReceivableOverdue: number;
    totalPayable: number;
    totalPayableOverdue: number;
    openProposals: number;
    openProposalsValue: number;
    netPosition: number;
}

export class DolibarrFinanceService extends DolibarrServiceBase {

    async getBankBalances(): Promise<BankBalance[]> {
        try {
            const accounts = await this.listBankAccountsWithRef();
            const results: BankBalance[] = [];

            for (const acct of accounts) {
                try {
                    const lines = await this.getBankLinesAll(acct.id);
                    const balance = lines.reduce((sum, l) => sum + parseFloat(l.amount || '0'), 0);
                    results.push({
                        accountId: String(acct.id),
                        ref: acct.ref || '',
                        label: acct.label || acct.ref || '',
                        balance: Math.round(balance * 100) / 100,
                        transactionCount: lines.length,
                    });
                } catch {
                    results.push({
                        accountId: String(acct.id),
                        ref: acct.ref || '',
                        label: acct.label || acct.ref || '',
                        balance: 0,
                        transactionCount: 0,
                    });
                }
            }

            return results;
        } catch (error) {
            log.error('getBankBalances Error', error);
            return [];
        }
    }

    async getBankStatement(accountId: string, dateFrom?: string, dateTo?: string): Promise<any[]> {
        try {
            const lines = await this.getBankLinesAll(accountId);
            let filtered = lines;

            if (dateFrom) {
                const fromTs = Math.floor(new Date(dateFrom).getTime() / 1000);
                filtered = filtered.filter(l => parseInt(l.datev || l.dateo || '0') >= fromTs);
            }
            if (dateTo) {
                const toTs = Math.floor(new Date(dateTo).getTime() / 1000);
                filtered = filtered.filter(l => parseInt(l.datev || l.dateo || '0') <= toTs);
            }

            return filtered.map(l => ({
                id: l.id,
                date: l.datev || l.dateo,
                amount: parseFloat(l.amount || '0'),
                description: l.label || '',
                type: l.fk_type || '',
                rif: l.num_chq || '',
                url: l.url,
            }));
        } catch (error) {
            log.error('getBankStatement Error', error);
            return [];
        }
    }

    async getAccountsReceivable(dateFrom?: string, dateTo?: string): Promise<ReceivableItem[]> {
        try {
            const headers = this.getHeaders();
            const url = `${this.baseUrl}invoices`;
            const response = await axios.get(url, {
                headers,
                params: {
                    sqlfilters: "(t.paye:=:0) and (t.fk_statut:>:0)",
                    limit: 500,
                    sortfield: 't.date_lim_reglement',
                    sortorder: 'ASC',
                },
                httpsAgent: this.httpsAgent,
                validateStatus: (s) => s === 200,
            });

            let invoices = Array.isArray(response.data) ? response.data : [];

            if (dateFrom) {
                const fromTs = Math.floor(new Date(dateFrom).getTime() / 1000);
                invoices = invoices.filter(i => parseInt(i.date_lim_reglement || '0') >= fromTs);
            }
            if (dateTo) {
                const toTs = Math.floor(new Date(dateTo).getTime() / 1000);
                invoices = invoices.filter(i => parseInt(i.date_lim_reglement || '0') <= toTs);
            }

            const now = Math.floor(Date.now() / 1000);

            return invoices.map(i => ({
                id: String(i.id),
                ref: i.ref || '',
                totalTtc: parseFloat(i.total_ttc || '0'),
                dueDate: i.date_lim_reglement || null,
                isOverdue: i.date_lim_reglement ? parseInt(i.date_lim_reglement) < now : false,
                socid: String(i.socid || ''),
                socName: i.socname || i.name || '',
            }));
        } catch (error) {
            log.error('getAccountsReceivable Error', error);
            return [];
        }
    }

    async getAccountsPayable(dateFrom?: string, dateTo?: string): Promise<PayableItem[]> {
        const items: PayableItem[] = [];
        const now = Math.floor(Date.now() / 1000);

        try {
            const headers = this.getHeaders();

            const [supInvResp, expResp] = await Promise.allSettled([
                axios.get(`${this.baseUrl}supplierinvoices`, {
                    headers,
                    params: { limit: 500 },
                    httpsAgent: this.httpsAgent,
                    validateStatus: (s) => s === 200,
                }),
                axios.get(`${this.baseUrl}expensereports`, {
                    headers,
                    params: { limit: 500 },
                    httpsAgent: this.httpsAgent,
                    validateStatus: (s) => s === 200,
                }),
            ]);

            if (supInvResp.status === 'fulfilled' && Array.isArray(supInvResp.value.data)) {
                let supInvoices = supInvResp.value.data.filter((i: any) => String(i.paye) !== '1');

                if (dateFrom) {
                    const fromTs = Math.floor(new Date(dateFrom).getTime() / 1000);
                    supInvoices = supInvoices.filter((i: any) => {
                        const d = parseInt(i.date_lim_reglement || i.date || '0');
                        return d >= fromTs;
                    });
                }
                if (dateTo) {
                    const toTs = Math.floor(new Date(dateTo).getTime() / 1000);
                    supInvoices = supInvoices.filter((i: any) => {
                        const d = parseInt(i.date_lim_reglement || i.date || '0');
                        return d <= toTs;
                    });
                }

                for (const i of supInvoices) {
                    const dueTs = parseInt(i.date_lim_reglement || i.date || '0');
                    items.push({
                        id: String(i.id),
                        ref: i.ref || '',
                        totalTtc: parseFloat(i.total_ttc || '0'),
                        dueDate: i.date_lim_reglement || i.date || null,
                        isOverdue: dueTs > 0 && dueTs < now,
                        type: 'supplier_invoice',
                        socid: String(i.socid || ''),
                        socName: i.socname || i.name || '',
                    });
                }
            }

            if (expResp.status === 'fulfilled' && Array.isArray(expResp.value.data)) {
                let expenses = expResp.value.data.filter((e: any) => String(e.fk_statut) !== '6' && String(e.fk_statut) !== '5');

                if (dateFrom) {
                    const fromTs = Math.floor(new Date(dateFrom).getTime() / 1000);
                    expenses = expenses.filter((e: any) => parseInt(e.date || '0') >= fromTs);
                }
                if (dateTo) {
                    const toTs = Math.floor(new Date(dateTo).getTime() / 1000);
                    expenses = expenses.filter((e: any) => parseInt(e.date || '0') <= toTs);
                }

                for (const e of expenses) {
                    const dueTs = parseInt(e.date || '0');
                    items.push({
                        id: String(e.id),
                        ref: e.ref || `ND-${e.id}`,
                        totalTtc: parseFloat(e.total_ttc || '0'),
                        dueDate: e.date || null,
                        isOverdue: dueTs > 0 && dueTs < now,
                        type: 'expense_report',
                    });
                }
            }
        } catch (error) {
            log.error('getAccountsPayable Error', error);
        }

        return items;
    }

    async getOpenProposals(): Promise<any[]> {
        try {
            const headers = this.getHeaders();
            const url = `${this.baseUrl}proposals`;
            const response = await axios.get(url, {
                headers,
                params: {
                    sqlfilters: "(t.fk_statut:=:1)",
                    limit: 100,
                    sortfield: 't.date_valid',
                    sortorder: 'DESC',
                },
                httpsAgent: this.httpsAgent,
                validateStatus: (s) => s === 200,
            });
            return Array.isArray(response.data) ? response.data : [];
        } catch (error) {
            log.error('getOpenProposals Error', error);
            return [];
        }
    }

    async getCashFlowForecast(dateFrom: string, dateTo: string): Promise<CashFlowPeriod[]> {
        const [receivables, payables] = await Promise.all([
            this.getAccountsReceivable(dateFrom, dateTo),
            this.getAccountsPayable(dateFrom, dateTo),
        ]);

        const from = new Date(dateFrom);
        const to = new Date(dateTo);
        const periods: CashFlowPeriod[] = [];
        let cumulative = 0;

        const current = new Date(from);
        while (current <= to) {
            const weekEnd = new Date(current);
            weekEnd.setDate(weekEnd.getDate() + 6);
            const periodLabel = current.toISOString().split('T')[0];

            const weekStartTs = Math.floor(current.getTime() / 1000);
            const weekEndTs = Math.floor(Math.min(weekEnd.getTime(), to.getTime()) / 1000);

            const recWeek = receivables
                .filter(r => {
                    const d = parseInt(r.dueDate || '0');
                    return d >= weekStartTs && d <= weekEndTs;
                })
                .reduce((sum, r) => sum + r.totalTtc, 0);

            const payWeek = payables
                .filter(p => {
                    const d = parseInt(p.dueDate || '0');
                    return d >= weekStartTs && d <= weekEndTs;
                })
                .reduce((sum, p) => sum + p.totalTtc, 0);

            const net = recWeek - payWeek;
            cumulative += net;

            periods.push({
                period: periodLabel,
                receivable: Math.round(recWeek * 100) / 100,
                payable: Math.round(payWeek * 100) / 100,
                net: Math.round(net * 100) / 100,
                cumulativeNet: Math.round(cumulative * 100) / 100,
            });

            current.setDate(current.getDate() + 7);
        }

        return periods;
    }

    async getFinancialSummary(): Promise<FinancialSummary> {
        const [bankBalances, receivables, payables, proposals] = await Promise.all([
            this.getBankBalances(),
            this.getAccountsReceivable(),
            this.getAccountsPayable(),
            this.getOpenProposals(),
        ]);

        const totalBankBalance = bankBalances.reduce((s, b) => s + b.balance, 0);
        const totalReceivable = receivables.reduce((s, r) => s + r.totalTtc, 0);
        const totalReceivableOverdue = receivables.filter(r => r.isOverdue).reduce((s, r) => s + r.totalTtc, 0);
        const totalPayable = payables.reduce((s, p) => s + p.totalTtc, 0);
        const totalPayableOverdue = payables.filter(p => p.isOverdue).reduce((s, p) => s + p.totalTtc, 0);
        const openProposalsValue = proposals.reduce((s, p) => s + parseFloat(p.total_ttc || '0'), 0);

        return {
            date: new Date().toISOString().split('T')[0],
            bankBalances,
            totalBankBalance: Math.round(totalBankBalance * 100) / 100,
            totalReceivable: Math.round(totalReceivable * 100) / 100,
            totalReceivableOverdue: Math.round(totalReceivableOverdue * 100) / 100,
            totalPayable: Math.round(totalPayable * 100) / 100,
            totalPayableOverdue: Math.round(totalPayableOverdue * 100) / 100,
            openProposals: proposals.length,
            openProposalsValue: Math.round(openProposalsValue * 100) / 100,
            netPosition: Math.round((totalBankBalance + totalReceivable - totalPayable) * 100) / 100,
        };
    }

    private async listBankAccountsWithRef(): Promise<any[]> {
        try {
            const headers = this.getHeaders();
            const url = `${this.baseUrl}bankaccounts`;
            const response = await axios.get(url, {
                headers,
                params: { limit: 20 },
                httpsAgent: this.httpsAgent,
                validateStatus: (s) => s === 200,
            });
            return Array.isArray(response.data) ? response.data : [];
        } catch (error) {
            log.error('listBankAccountsWithRef Error', error);
            return [];
        }
    }

    private async getBankLinesAll(accountId: string): Promise<any[]> {
        try {
            const headers = this.getHeaders();
            const url = `${this.baseUrl}bankaccounts/${accountId}/lines`;
            const response = await axios.get(url, {
                headers,
                params: { limit: 10000 },
                httpsAgent: this.httpsAgent,
                validateStatus: (s) => s === 200,
            });
            return Array.isArray(response.data) ? response.data : [];
        } catch (error) {
            log.error(`getBankLinesAll ${accountId} Error`, error);
            return [];
        }
    }
}
