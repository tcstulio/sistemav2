import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import TaxPaymentList from '../../components/Finance/TaxPaymentList';
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

const mockVAT: VATPayment[] = [
    { id: 'v1', ref: 'TVA001', fk_tva: '10', date_payment: 1700000000, amount: 1200, fk_bank: 'b1' },
];

const mockSocial: SocialContributionPayment[] = [
    { id: 's1', ref: 'CS001', fk_charge: '20', date_payment: 1700100000, amount: 800, fk_bank: 'b1' },
];

vi.mock('../../hooks/dolibarr', () => ({
    useVATPayments: () => ({ data: mockVAT }),
    useSocialContributionPayments: () => ({ data: mockSocial }),
}));

vi.mock('sonner', () => ({
    toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

const renderList = () =>
    render(
        <MemoryRouter>
            <TaxPaymentList />
        </MemoryRouter>
    );

describe('TaxPaymentList — Moeda BRL (#583)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('exibe o Total Pago formatado em R$ (BRL) sem prefixo $ literal', () => {
        const { container } = renderList();

        // 1200 + 800 = 2000
        const expected = formatCurrency(2000);
        expect(container.textContent).toContain(expected);
        expect(container.textContent).toContain('R$');
        // Não deve haver $ americano isolado (fora de R$)
        expect(container.textContent).not.toMatch(/(?<!R)\$\d/);
    });

    it('exibe o valor de cada card formatado em R$ com sinal de saída (-R$)', () => {
        const { container } = renderList();

        expect(container.textContent).toContain(`-${formatCurrency(1200)}`);
        expect(container.textContent).toContain(`-${formatCurrency(800)}`);
        // Nenhum valor com prefixo USD ($1234)
        expect(container.textContent).not.toMatch(/(?<!R)\$\d/);
    });

    it('exibe os rótulos de tipo corretos (Imposto IVA e Encargo Social)', () => {
        const { container } = renderList();

        expect(container.textContent).toContain('Imposto (IVA)');
        expect(container.textContent).toContain('Encargo Social');
    });
});
