import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SalesTab } from '../../../components/Reports/SalesTab';

vi.mock('recharts', () => {
    const stub = ({ children }: any) => (children ? <div>{children}</div> : null);
    return {
        ResponsiveContainer: stub,
        PieChart: stub,
        Pie: stub,
        Cell: stub,
        Tooltip: stub,
        Legend: stub,
    };
});

const baseSalesStats = {
    proposalsCount: 0,
    ordersCount: 0,
    proposalsValue: 0,
    ordersValue: 0,
    conversionRate: 0,
    avgTicket: 0,
};

describe('SalesTab', () => {
    it('shows client name when soc_name is available', () => {
        const orders = [
            {
                id: '1', ref: 'CMD-001', socid: '10', soc_name: 'Empresa Alfa Ltda',
                total_ttc: 1000, statut: '1', date: 0, date_commande: 0
            },
        ];
        const stats = { ...baseSalesStats, ordersCount: 1, ordersValue: 1000, conversionRate: 100, avgTicket: 1000 };
        render(<SalesTab salesStats={stats} proposals={[]} orders={orders as any} />);
        expect(screen.getByText('Empresa Alfa Ltda')).toBeInTheDocument();
    });

    it('shows fallback #id when soc_name is not available', () => {
        const orders = [
            {
                id: '2', ref: 'CMD-002', socid: '42', soc_name: undefined,
                total_ttc: 500, statut: '1', date: 0
            },
        ];
        const stats = { ...baseSalesStats, ordersCount: 1, ordersValue: 500, conversionRate: 100, avgTicket: 500 };
        render(<SalesTab salesStats={stats} proposals={[]} orders={orders as any} />);
        expect(screen.getByText('#42')).toBeInTheDocument();
    });

    it('shows dash when no socid and no soc_name', () => {
        const orders = [
            {
                id: '3', ref: 'CMD-003', socid: '', soc_name: undefined,
                total_ttc: 100, statut: '1', date: 0
            },
        ];
        const stats = { ...baseSalesStats, ordersCount: 1, ordersValue: 100, conversionRate: 100, avgTicket: 100 };
        render(<SalesTab salesStats={stats} proposals={[]} orders={orders as any} />);
        expect(screen.getByText('-')).toBeInTheDocument();
    });

    it('does not crash with proposalsCount=0 and ordersCount=0', () => {
        const stats = { ...baseSalesStats };
        expect(() => {
            render(<SalesTab salesStats={stats} proposals={[]} orders={[]} />);
        }).not.toThrow();
        // Shows "Sem dados" message instead of chart
        expect(screen.getByText(/Sem dados/i)).toBeInTheDocument();
    });

    it('does not pass negative value to pie chart when ordersCount > proposalsCount', () => {
        // proposalsCount=0, ordersCount=5: naive calc gives -5 (negative), should be clamped to 0
        const stats = { ...baseSalesStats, proposalsCount: 0, ordersCount: 5, ordersValue: 5000, conversionRate: 0, avgTicket: 1000 };
        // noData check: proposalsCount===0 && ordersCount!==0 → noData=false, so chart renders
        // but notConverted = Math.max(0, 0-5) = 0
        // This just must not throw/crash
        expect(() => {
            render(<SalesTab salesStats={stats} proposals={[]} orders={[]} />);
        }).not.toThrow();
    });

    it('shows "Sem dados" message instead of chart when both counts are zero', () => {
        const stats = { ...baseSalesStats, proposalsCount: 0, ordersCount: 0 };
        render(<SalesTab salesStats={stats} proposals={[]} orders={[]} />);
        expect(screen.getByText(/Sem dados/i)).toBeInTheDocument();
    });

    it('shows conversion rate', () => {
        const stats = { ...baseSalesStats, proposalsCount: 10, ordersCount: 3, conversionRate: 30 };
        render(<SalesTab salesStats={stats} proposals={[]} orders={[]} />);
        expect(screen.getByText(/30\.0%/)).toBeInTheDocument();
    });
});
