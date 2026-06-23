export interface BankLine {
    date_operation?: number;
    amount: number;
}

export interface CashFlowBucket {
    month: string;
    income: number;
    expense: number;
    balance: number;
}

export function buildCashFlowBuckets(
    bankLines: BankLine[],
    months: number,
    referenceDate: Date = new Date(),
    totalCash: number = 0
): CashFlowBucket[] {
    const monthsMap = new Map<string, { month: string; income: number; expense: number; date: Date }>();

    for (let i = months - 1; i >= 0; i--) {
        const d = new Date(referenceDate.getFullYear(), referenceDate.getMonth() - i, 1);
        const key = `${d.getFullYear()}-${d.getMonth()}`;
        const label = d.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' });

        monthsMap.set(key, {
            month: label,
            income: 0,
            expense: 0,
            date: d,
        });
    }

    bankLines.forEach((line) => {
        const dateVal = line.date_operation;
        if (!dateVal) return;

        const timestamp = dateVal < 100000000000 ? dateVal * 1000 : dateVal;
        const d = new Date(timestamp);
        const key = `${d.getFullYear()}-${d.getMonth()}`;

        if (monthsMap.has(key)) {
            const bucket = monthsMap.get(key)!;
            if (line.amount > 0) {
                bucket.income += line.amount;
            } else {
                bucket.expense += Math.abs(line.amount);
            }
        }
    });

    const sorted = Array.from(monthsMap.values())
        .sort((a, b) => a.date.getTime() - b.date.getTime());

    // Derive historical end-of-month balance by walking backwards from totalCash.
    // totalCash = current snapshot balance (sum of account solde fields).
    // For each month from newest to oldest: balanceEnd[m-1] = balanceEnd[m] - net[m]
    // NOTE: this is an approximation based on available bankLines window.
    const balances: number[] = new Array(sorted.length).fill(0);
    balances[sorted.length - 1] = totalCash;
    for (let i = sorted.length - 2; i >= 0; i--) {
        const next = sorted[i + 1];
        balances[i] = balances[i + 1] - (next.income - next.expense);
    }

    return sorted.map(({ month, income, expense }, i) => ({
        month,
        income,
        expense,
        balance: balances[i],
    }));
}
