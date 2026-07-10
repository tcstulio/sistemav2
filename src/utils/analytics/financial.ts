import { Payment, SupplierPayment, SocialContributionPayment, VATPayment } from "../../types/finance";

export const getMonthlyCashFlow = (
    month: number,
    year: number,
    payments: Payment[],
    supplierPayments: SupplierPayment[],
    salaries: any[], // Assuming SalaryPayment type or similar exists
    taxes: SocialContributionPayment[],
    vat: VATPayment[]
) => {
    const startDate = new Date(year, month - 1, 1).getTime();
    const endDate = new Date(year, month, 0, 23, 59, 59).getTime();

    const filterByDate = (item: any) => {
        let dateVal = item.date_payment || item.datep || item.date;
        if (typeof dateVal === 'string') {
            dateVal = new Date(dateVal).getTime();
        }
        // Numeric timestamps may arrive in seconds (legacy) or ms (mappers) — normalize to ms
        if (typeof dateVal === 'number' && dateVal < 100000000000) {
            dateVal = dateVal * 1000;
        }
        return dateVal >= startDate && dateVal <= endDate;
    };

    const safeAmount = (p: any) =>
        typeof p.amount === 'number' ? p.amount : (parseFloat(String(p.amount)) || 0);

    const inflows = payments
        .filter(filterByDate)
        .reduce((sum, p) => sum + safeAmount(p), 0);

    const outflowSuppliers = supplierPayments
        .filter(filterByDate)
        .reduce((sum, p) => sum + safeAmount(p), 0);

    const outflowSalaries = salaries
        .filter(filterByDate)
        .reduce((sum, p) => sum + safeAmount(p), 0);

    const outflowTaxes = taxes
        .filter(filterByDate)
        .reduce((sum, p) => sum + safeAmount(p), 0);

    const outflowVat = vat
        .filter(filterByDate)
        .reduce((sum, p) => sum + safeAmount(p), 0);

    const totalOutflow = outflowSuppliers + outflowSalaries + outflowTaxes + outflowVat;

    return {
        inflow: inflows,
        outflow: totalOutflow,
        net: inflows - totalOutflow,
        breakdown: {
            suppliers: outflowSuppliers,
            salaries: outflowSalaries,
            taxes: outflowTaxes + outflowVat
        }
    };
};
