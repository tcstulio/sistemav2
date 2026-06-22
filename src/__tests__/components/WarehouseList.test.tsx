/**
 * Tests for WarehouseList (#631)
 * Covers: warehouse detail panel showing description/status/address/phone/extrafields,
 * and empty fields not rendering lines.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// --- Mocks hoisted ---
const mockSvc = vi.hoisted(() => ({
    getProductWithStock: vi.fn().mockResolvedValue({ stock_warehouse: {} }),
}));

vi.mock('../../services/dolibarrService', () => ({ DolibarrService: mockSvc }));
vi.mock('../../utils/logger', () => ({
    logger: { child: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

vi.mock('../../context/DolibarrContext', () => ({
    useDolibarr: vi.fn(() => ({
        config: { apiUrl: 'http://test', apiKey: 'key', themeColor: 'indigo' },
    })),
}));

const mockWarehouses = [
    {
        id: '1',
        label: 'Armazém Completo',
        lieu: 'São Paulo',
        statut: '1' as const,
        description: 'Armazém principal da empresa',
        address: 'Rua das Flores, 42',
        zip: '01310-100',
        town: 'São Paulo',
        phone: '(11) 9876-5432',
        fax: '(11) 3333-4444',
        array_options: { options_setor: 'Alimentício', options_capacidade: '10000' },
    },
    {
        id: '2',
        label: 'Armazém Vazio',
        lieu: '',
        statut: '0' as const,
        description: '',
        address: '',
        zip: '',
        town: '',
        phone: '',
        fax: '',
        array_options: {},
    },
];

const mockProducts = [
    { id: 'p1', ref: 'REF-001', label: 'Produto Alpha', type: '0' as const, stock_reel: 10 },
];

vi.mock('../../hooks/dolibarr', () => ({
    useWarehouses: vi.fn(() => ({ data: mockWarehouses, isLoading: false })),
    useProducts: vi.fn(() => ({ data: mockProducts, isLoading: false })),
}));

import WarehouseList from '../../components/WarehouseList';

describe('WarehouseList (#631) — painel de detalhe', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('mostra lista de armazéns', () => {
        render(<WarehouseList />);
        expect(screen.getByText('Armazém Completo')).toBeInTheDocument();
        expect(screen.getByText('Armazém Vazio')).toBeInTheDocument();
    });

    it('painel de detalhe exibe descrição, status, endereço e telefone quando preenchidos', async () => {
        render(<WarehouseList />);

        // Selecionar o armazém completo
        fireEvent.click(screen.getByText('Armazém Completo'));

        // Aguardar o painel carregar
        await waitFor(() => {
            expect(screen.getByTestId('warehouse-description')).toBeInTheDocument();
        });

        expect(screen.getByTestId('warehouse-description')).toHaveTextContent('Armazém principal da empresa');
        expect(screen.getByTestId('warehouse-status')).toHaveTextContent('Ativo');
        expect(screen.getByTestId('warehouse-address')).toHaveTextContent('Rua das Flores, 42');
        expect(screen.getByTestId('warehouse-phone')).toHaveTextContent('(11) 9876-5432');
        expect(screen.getByTestId('warehouse-fax')).toHaveTextContent('(11) 3333-4444');
    });

    it('painel exibe extrafields preenchidos', async () => {
        render(<WarehouseList />);
        fireEvent.click(screen.getByText('Armazém Completo'));

        await waitFor(() => {
            expect(screen.getByTestId('extrafield-options_setor')).toBeInTheDocument();
        });

        expect(screen.getByTestId('extrafield-options_setor')).toHaveTextContent('Alimentício');
        expect(screen.getByTestId('extrafield-options_capacidade')).toHaveTextContent('10000');
    });

    it('painel não renderiza linhas vazias para campos ausentes (armazém vazio)', async () => {
        render(<WarehouseList />);
        fireEvent.click(screen.getByText('Armazém Vazio'));

        await waitFor(() => {
            // status is always shown, so the info block is present
            expect(screen.getByTestId('warehouse-status')).toBeInTheDocument();
        });

        // Campos vazios não devem gerar elementos
        expect(screen.queryByTestId('warehouse-description')).not.toBeInTheDocument();
        expect(screen.queryByTestId('warehouse-address')).not.toBeInTheDocument();
        expect(screen.queryByTestId('warehouse-phone')).not.toBeInTheDocument();
        expect(screen.queryByTestId('warehouse-fax')).not.toBeInTheDocument();
    });
});