export interface BankLine {
    date_operation?: number;
    amount: number;
}

export interface CashFlowBucket {
    month: string;
    income: number;
    expense: number;
}

export function buildCashFlowBuckets(
    bankLines: BankLine[],
    months: number,
    referenceDate: Date = new Date()
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

    return Array.from(monthsMap.values())
        .sort((a, b) => a.date.getTime() - b.date.getTime())
        .map(({ month, income, expense }) => ({ month, income, expense }));
}
