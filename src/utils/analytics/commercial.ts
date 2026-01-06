import { Proposal, Order, Invoice } from "../../types/sales";

export const getSalesPerformance = (
    month: number,
    year: number,
    proposals: Proposal[],
    orders: Order[]
) => {
    const startDate = new Date(year, month - 1, 1).getTime() / 1000;
    const endDate = new Date(year, month, 0, 23, 59, 59).getTime() / 1000;

    // Filter proposals created in this month
    const monthlyProposals = proposals.filter(p => {
        let date = p.datec || p.date_creation || 0;
        if (typeof date === 'string') date = new Date(date).getTime() / 1000;
        return date >= startDate && date <= endDate;
    });

    // Filter orders created in this month (or validated)
    const monthlyOrders = orders.filter(o => {
        let date = o.date_commande || o.datec || 0;
        if (typeof date === 'string') date = new Date(date).getTime() / 1000;
        return date >= startDate && date <= endDate;
    });

    const totalProposalValue = monthlyProposals.reduce((sum, p) => sum + parseFloat(p.total_ttc), 0);
    const totalOrderValue = monthlyOrders.reduce((sum, o) => sum + parseFloat(o.total_ttc), 0);

    // Conversion Rate (Count based)
    // Note: This is a simple approximation. Ideally, we track proposals *converted* to orders in this month, regardless of when proposal was created.
    // But for simple monthly stats, Created vs Won in same month is a common proxy, or we can look at Signed Proposals.

    const signedProposals = monthlyProposals.filter(p => p.statut === '2' || p.statut === '4'); // 2=Signed, 4=Billed (Dolibarr statuses vary)

    const conversionRate = monthlyProposals.length > 0
        ? (signedProposals.length / monthlyProposals.length) * 100
        : 0;

    return {
        proposalsCount: monthlyProposals.length,
        proposalsValue: totalProposalValue,
        ordersCount: monthlyOrders.length,
        ordersValue: totalOrderValue,
        conversionRate: conversionRate,
        avgTicket: monthlyOrders.length > 0 ? totalOrderValue / monthlyOrders.length : 0
    };
};

export const getRevenueForecast = (
    orders: Order[],
    invoices: Invoice[]
) => {
    // Logic: Find orders that are validated but not yet fully billed.
    // This requires cross-referencing orders and invoices, which might be complex without direct links.
    // Enhanced approximation: Sum of validated orders (statut=1) minus sum of draft/unpaid invoices linked to them (if we had links).
    // For now, let's just sum up "Validated but not Delivered/Billed" orders if status allows distinction.

    // Dolibarr Order Statuses: 0=Draft, 1=Validated, 2=Delivered, 3=Billed/Closed
    const pipelineOrders = orders.filter(o => o.statut === '1' || o.statut === '2');

    return pipelineOrders.reduce((sum, o) => sum + parseFloat(o.total_ttc), 0);
}
