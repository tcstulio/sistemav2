/**
 * Testes para ManufacturingView — classes Tailwind literais por tema (#1094)
 *
 * Garante que as abas "Ordens de Produção" / "Listas de Materiais (BOM)" usam
 * classes literais (mapa estático) em vez de interpolação
 * (`border-${config.themeColor}-600`), que o Tailwind v4 não detecta em build time.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('../../context/DolibarrContext', () => ({
    useDolibarr: vi.fn(() => ({
        config: { apiUrl: 'http://test', apiKey: 'key', themeColor: 'indigo' },
        refreshData: vi.fn().mockResolvedValue(undefined),
    })),
}));

vi.mock('../../hooks/dolibarr', () => ({
    useManufacturingOrders: vi.fn(() => ({ data: [], isLoading: false, refetch: vi.fn() })),
    useBOMs: vi.fn(() => ({ data: [], isLoading: false, refetch: vi.fn() })),
    useProjects: vi.fn(() => ({ data: [], isLoading: false })),
    useProducts: vi.fn(() => ({ data: [], isLoading: false })),
    useStockMovements: vi.fn(() => ({ data: [], isLoading: false })),
    useWarehouses: vi.fn(() => ({ data: [], isLoading: false })),
}));

vi.mock('../../hooks/usePrefill', () => ({ usePrefill: vi.fn(() => null) }));

vi.mock('../../utils/logger', () => ({
    logger: { child: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));
vi.mock('../../utils/notifyError', () => ({ notifyError: vi.fn() }));

// Stub de filhos pesados (não são foco deste teste)
vi.mock('../../components/Manufacturing/tabs/ManufacturingOrdersTab', () => ({
    ManufacturingOrdersTab: () => <div data-testid="mo-tab" />,
}));
vi.mock('../../components/Manufacturing/tabs/BOMTab', () => ({
    BOMTab: () => <div data-testid="bom-tab" />,
}));
vi.mock('../../components/Manufacturing/modals/CreateMOModal', () => ({ CreateMOModal: () => null }));
vi.mock('../../components/Manufacturing/modals/CreateBOMModal', () => ({ CreateBOMModal: () => null }));
vi.mock('../../components/Manufacturing/modals/ConsumeModal', () => ({ ConsumeModal: () => null }));
vi.mock('../../components/Manufacturing/modals/ProduceModal', () => ({ ProduceModal: () => null }));
vi.mock('../../components/Manufacturing/details/ManufacturingOrderDetail', () => ({
    ManufacturingOrderDetail: () => <div data-testid="mo-detail" />,
}));
vi.mock('../../components/Manufacturing/details/BOMDetail', () => ({
    BOMDetail: () => <div data-testid="bom-detail" />,
}));

import ManufacturingView from '../../components/ManufacturingView';
import { useDolibarr } from '../../context/DolibarrContext';

describe('ManufacturingView — classes Tailwind literais por tema (#1094)', () => {
    const setThemeColor = (themeColor: string) => {
        vi.mocked(useDolibarr).mockReturnValue({
            config: { apiUrl: 'http://test', apiKey: 'key', themeColor },
            refreshData: vi.fn().mockResolvedValue(undefined),
        } as any);
    };

    beforeEach(() => {
        vi.clearAllMocks();
        setThemeColor('indigo');
    });

    const tabButton = (label: string) =>
        screen.getByText(label).closest('button') as HTMLElement;

    it('a aba ativa (Ordens de Produção) usa classes literais da cor de tema (indigo)', () => {
        render(<ManufacturingView />);

        const moTab = tabButton('Ordens de Produção');
        expect(moTab.className).toContain('border-indigo-600');
        expect(moTab.className).toContain('text-indigo-600');
        expect(moTab.className).toContain('dark:border-indigo-400');
        expect(moTab.className).toContain('dark:text-indigo-400');
        expect(moTab.className).not.toContain('${');
        expect(moTab.className).not.toContain('undefined');
    });

    it('a aba inativa (Listas de Materiais) usa classes neutras (sem cor de tema)', () => {
        render(<ManufacturingView />);

        const bomTab = tabButton('Listas de Materiais (BOM)');
        expect(bomTab.className).toContain('border-transparent');
        expect(bomTab.className).not.toContain('border-indigo-600');
        expect(bomTab.className).not.toContain('text-indigo-600');
    });

    it('trocar de aba move as classes ativas para "Listas de Materiais (BOM)"', () => {
        render(<ManufacturingView />);

        const bomTab = tabButton('Listas de Materiais (BOM)');
        expect(bomTab.className).not.toContain('border-indigo-600');

        fireEvent.click(bomTab);

        const bomTabAfter = tabButton('Listas de Materiais (BOM)');
        const moTabAfter = tabButton('Ordens de Produção');
        expect(bomTabAfter.className).toContain('border-indigo-600');
        expect(bomTabAfter.className).toContain('text-indigo-600');
        expect(moTabAfter.className).not.toContain('border-indigo-600');
    });

    it('aplica a cor correta para tema diferente (emerald)', () => {
        setThemeColor('emerald');
        render(<ManufacturingView />);

        const moTab = tabButton('Ordens de Produção');
        expect(moTab.className).toContain('border-emerald-600');
        expect(moTab.className).toContain('text-emerald-600');
        expect(moTab.className).toContain('dark:border-emerald-400');
        expect(moTab.className).not.toContain('border-indigo-600');
    });

    it('cor de tema desconhecida cai no fallback indigo', () => {
        setThemeColor('cor-que-nao-existe');
        render(<ManufacturingView />);

        const moTab = tabButton('Ordens de Produção');
        expect(moTab.className).toContain('border-indigo-600');
        expect(moTab.className).not.toContain('undefined');
    });
});
