import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import TaxPaymentDetail from '../../components/Finance/TaxPaymentDetail';
import { VATPayment, SocialContributionPayment } from '../../types';
import { formatCurrency } from '../../utils/formatUtils';

const mockConfig = {
    apiUrl: 'http://test',
    apiKey: 'key',
    themeColor: 'indigo',
    darkMode: false,
    apiLimit: 0,
};

vi.mock('../../context/DolibarrContext', () => ({
    useDolibarr: () => ({ config: mockConfig }),
}));

vi.mock('sonner', () => ({
    toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

// Dados mutáveis para cada suite
const { mockData } = vi.hoisted(() => ({
    mockData: {
        vat: [] as VATPayment[],
        social: [] as SocialContributionPayment[],
    },
}));

vi.mock('../../hooks/dolibarr', () => ({
    useVATPayments: () => ({ data: mockData.vat }),
    useSocialContributionPayments: () => ({ data: mockData.social }),
    useBankAccounts: () => ({ data: [] }),
}));

/** Renderiza TaxPaymentDetail com o parâmetro :id fornecido */
const renderDetail = (id: string) =>
    render(
        <MemoryRouter initialEntries={[`/tax_payments/${id}`]}>
            <Routes>
                <Route path="/tax_payments/:id" element={<TaxPaymentDetail />} />
            </Routes>
        </MemoryRouter>
    );

describe('TaxPaymentDetail — Valor em R$ (#583)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockData.vat = [
            { id: 'v1', ref: 'TVA001', fk_tva: '10', date_payment: 1700000000, amount: 1500, fk_bank: 'b1' },
        ];
        mockData.social = [];
    });

    it('exibe o valor do pagamento em BRL via formatCurrency', () => {
        const { container } = renderDetail('v1');
        expect(container.textContent).toContain(formatCurrency(1500));
        expect(container.textContent).toContain('R$');
        expect(container.textContent).not.toMatch(/(?<!R)\$\d/);
    });
});

describe('TaxPaymentDetail — Origem com rótulo (#583)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockData.vat = [];
    });

    it('exibe rótulo legível quando label_origem está presente (encargo social)', () => {
        mockData.social = [
            {
                id: 's1', ref: 'CS001', fk_charge: '20',
                date_payment: 1700000000, amount: 800, fk_bank: 'b1',
                label_origem: 'FGTS - Dezembro/2024',
            } as SocialContributionPayment,
        ];

        renderDetail('s1');

        // O rótulo legível deve aparecer
        expect(screen.getByTestId('origem-rotulo').textContent).toBe('FGTS - Dezembro/2024');
        // Não deve exibir o ID bruto via fallback
        expect(screen.queryByTestId('origem-id-fallback')).not.toBeInTheDocument();
    });

    it('exibe rótulo com período quando periodo_inicio está presente (IVA)', () => {
        mockData.vat = [
            {
                id: 'v2', ref: 'TVA002', fk_tva: '5',
                date_payment: 1700000000, amount: 600, fk_bank: 'b1',
                // Janeiro 2024 em segundos (timestamp Dolibarr)
                periodo_inicio: 1704067200, // 2024-01-01
            } as VATPayment,
        ];

        renderDetail('v2');

        // O rótulo deve conter "IVA" e a data formatada
        const rotulo = screen.getByTestId('origem-rotulo');
        expect(rotulo.textContent).toContain('IVA');
        // Não deve usar o fallback de ID bruto
        expect(screen.queryByTestId('origem-id-fallback')).not.toBeInTheDocument();
    });

    it('exibe fallback com tipo + ID quando não há rótulo nem período', () => {
        mockData.social = [
            {
                id: 's2', ref: 'CS002', fk_charge: '99',
                date_payment: 1700000000, amount: 300, fk_bank: 'b1',
                // Sem label_origem, sem periodo_inicio
            } as SocialContributionPayment,
        ];

        renderDetail('s2');

        // Deve cair no fallback
        const fallback = screen.getByTestId('origem-id-fallback');
        expect(fallback.textContent).toContain('99'); // ID bruto
        expect(fallback.textContent).toContain('Encargo Social'); // tipo legível
        // Sem o teste de rótulo
        expect(screen.queryByTestId('origem-rotulo')).not.toBeInTheDocument();
    });

    it('exibe Comprovante quando num_payment está presente', () => {
        mockData.vat = [
            {
                id: 'v3', ref: 'TVA003', fk_tva: '7',
                date_payment: 1700000000, amount: 900, fk_bank: 'b1',
                num_payment: 'DOC-2024-0042',
            } as VATPayment,
        ];

        renderDetail('v3');

        expect(screen.getByText('Comprovante / Nº Documento')).toBeInTheDocument();
        expect(screen.getByText('DOC-2024-0042')).toBeInTheDocument();
    });

    it('não exibe bloco Comprovante quando num_payment está ausente', () => {
        mockData.vat = [
            {
                id: 'v4', ref: 'TVA004', fk_tva: '8',
                date_payment: 1700000000, amount: 500, fk_bank: 'b1',
                // sem num_payment
            } as VATPayment,
        ];

        renderDetail('v4');

        expect(screen.queryByText('Comprovante / Nº Documento')).not.toBeInTheDocument();
    });
});
