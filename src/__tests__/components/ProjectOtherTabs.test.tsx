import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
    ProjectShipmentsTab,
    ProjectPurchasesTab,
    ProjectManufacturingTab,
    ProjectContractsTab,
    ProjectInterventionsTab
} from '../../components/Projects/tabs/ProjectOtherTabs';
import { Shipment } from '../../types/products';
import { ManufacturingOrder } from '../../types/manufacturing';
import { SupplierOrder, Contract } from '../../types/sales';
import { Intervention } from '../../types/projects';

describe('ProjectShipmentsTab', () => {
    const mockOnNavigate = vi.fn();
    beforeEach(() => { vi.clearAllMocks(); });

    const createMockShipment = (id: string, overrides: Partial<Shipment> = {}): Shipment => ({
        id,
        ref: `SHIP-${id}`,
        socid: '1',
        date_creation: new Date('2024-01-15').getTime() / 1000,
        tracking_number: '',
        status: '0',
        ...overrides
    });

    it('renders empty state when no shipments', () => {
        render(<ProjectShipmentsTab shipments={[]} onNavigate={mockOnNavigate} />);
        expect(screen.getByText('Nenhum envio encontrado.')).toBeInTheDocument();
    });

    it('renders shipment ref', () => {
        const shipments = [createMockShipment('1', { ref: 'EXP-001' })];
        render(<ProjectShipmentsTab shipments={shipments} onNavigate={mockOnNavigate} />);
        expect(screen.getByText('EXP-001')).toBeInTheDocument();
    });

    it('renders tracking number when present', () => {
        const shipments = [createMockShipment('1', { tracking_number: 'TRK123456' })];
        render(<ProjectShipmentsTab shipments={shipments} onNavigate={mockOnNavigate} />);
        expect(screen.getByText(/TRK123456/)).toBeInTheDocument();
    });

    it('renders sent status', () => {
        const shipments = [createMockShipment('1', { status: '1' })];
        render(<ProjectShipmentsTab shipments={shipments} onNavigate={mockOnNavigate} />);
        expect(screen.getByText('Enviado')).toBeInTheDocument();
    });

    it('renders open status', () => {
        const shipments = [createMockShipment('1', { status: '0' })];
        render(<ProjectShipmentsTab shipments={shipments} onNavigate={mockOnNavigate} />);
        expect(screen.getByText('Aberto')).toBeInTheDocument();
    });

    it('calls onNavigate when clicking', () => {
        const shipments = [createMockShipment('1')];
        render(<ProjectShipmentsTab shipments={shipments} onNavigate={mockOnNavigate} />);
        fireEvent.click(screen.getByText('SHIP-1'));
        expect(mockOnNavigate).toHaveBeenCalledWith('shipments', '1');
    });
});

describe('ProjectPurchasesTab', () => {
    beforeEach(() => { vi.clearAllMocks(); });

    const createMockSupplierOrder = (id: string, overrides: Partial<SupplierOrder> = {}): SupplierOrder => ({
        id,
        ref: `PO-${id}`,
        socid: '1',
        date_creation: new Date('2024-01-15').getTime() / 1000,
        total_ttc: 1000,
        statut: 'Pending',
        ...overrides
    });

    it('renders empty state when no orders', () => {
        render(<ProjectPurchasesTab supplierOrders={[]} />);
        expect(screen.getByText('Nenhum pedido de compra encontrado.')).toBeInTheDocument();
    });

    it('renders order ref and total', () => {
        const orders = [createMockSupplierOrder('1', { total_ttc: 5000 })];
        render(<ProjectPurchasesTab supplierOrders={orders} />);
        expect(screen.getByText('PO-1')).toBeInTheDocument();
        // Locale/ICU-independente: símbolo e separador (R$ 5.000,00 vs $5,000.00) e o
        // espaço entre símbolo e valor variam por versão de ICU; basta o valor agrupado.
        expect(screen.getByText(/5[.,]000/)).toBeInTheDocument();
    });

    it('renders multiple orders', () => {
        const orders = [
            createMockSupplierOrder('1', { ref: 'PO-001' }),
            createMockSupplierOrder('2', { ref: 'PO-002' })
        ];
        render(<ProjectPurchasesTab supplierOrders={orders} />);
        expect(screen.getByText('PO-001')).toBeInTheDocument();
        expect(screen.getByText('PO-002')).toBeInTheDocument();
    });
});

describe('ProjectManufacturingTab', () => {
    beforeEach(() => { vi.clearAllMocks(); });

    const createMockMO = (id: string, overrides: Partial<ManufacturingOrder> = {}): ManufacturingOrder => ({
        id,
        ref: `MO-${id}`,
        label: `Ordem ${id}`,
        status: '1',
        product_to_produce_id: '100',
        qty: 10,
        ...overrides
    });

    it('renders empty state when no orders', () => {
        render(<ProjectManufacturingTab manufacturingOrders={[]} />);
        expect(screen.getByText('Nenhuma ordem de produção vinculada.')).toBeInTheDocument();
    });

    it('renders manufacturing order ref and label', () => {
        const orders = [createMockMO('1', { label: 'Produção Beta' })];
        render(<ProjectManufacturingTab manufacturingOrders={orders} />);
        expect(screen.getByText('MO-1')).toBeInTheDocument();
        expect(screen.getByText('Produção Beta')).toBeInTheDocument();
    });

    it('renders quantity', () => {
        const orders = [createMockMO('1', { qty: 50 })];
        render(<ProjectManufacturingTab manufacturingOrders={orders} />);
        expect(screen.getByText(/Qtd: 50/)).toBeInTheDocument();
    });
});

describe('ProjectContractsTab', () => {
    const mockOnNavigate = vi.fn();
    beforeEach(() => { vi.clearAllMocks(); });

    const createMockContract = (id: string, overrides: Partial<Contract> = {}): Contract => ({
        id,
        ref: `CTR-${id}`,
        socid: '1',
        date_contrat: new Date('2024-01-15').getTime() / 1000,
        statut: '1',
        ...overrides
    });

    it('renders empty state when no contracts', () => {
        render(<ProjectContractsTab contracts={[]} onNavigate={mockOnNavigate} />);
        expect(screen.getByText('Nenhum contrato vinculado.')).toBeInTheDocument();
    });

    it('renders contract ref', () => {
        const contracts = [createMockContract('1', { ref: 'CONTRACT-001' })];
        render(<ProjectContractsTab contracts={contracts} onNavigate={mockOnNavigate} />);
        expect(screen.getByText('CONTRACT-001')).toBeInTheDocument();
    });

    it('calls onNavigate when clicking', () => {
        const contracts = [createMockContract('1')];
        render(<ProjectContractsTab contracts={contracts} onNavigate={mockOnNavigate} />);
        fireEvent.click(screen.getByText('CTR-1'));
        expect(mockOnNavigate).toHaveBeenCalledWith('contracts', '1');
    });
});

describe('ProjectInterventionsTab', () => {
    const mockOnNavigate = vi.fn();
    beforeEach(() => { vi.clearAllMocks(); });

    const createMockIntervention = (id: string, overrides: Partial<Intervention> = {}): Intervention => ({
        id,
        ref: `INT-${id}`,
        socid: '1',
        description: `Intervenção ${id}`,
        date: new Date('2024-01-15').getTime() / 1000,
        date_creation: new Date('2024-01-15').getTime() / 1000,
        statut: '1',
        ...overrides
    });

    it('renders empty state when no interventions', () => {
        render(<ProjectInterventionsTab interventions={[]} onNavigate={mockOnNavigate} />);
        expect(screen.getByText('Nenhuma intervenção encontrada.')).toBeInTheDocument();
    });

    it('renders intervention ref and description', () => {
        const interventions = [createMockIntervention('1', { description: 'Manutenção preventiva' })];
        render(<ProjectInterventionsTab interventions={interventions} onNavigate={mockOnNavigate} />);
        expect(screen.getByText('INT-1')).toBeInTheDocument();
        expect(screen.getByText('Manutenção preventiva')).toBeInTheDocument();
    });

    it('calls onNavigate when clicking', () => {
        const interventions = [createMockIntervention('1')];
        render(<ProjectInterventionsTab interventions={interventions} onNavigate={mockOnNavigate} />);
        fireEvent.click(screen.getByText('INT-1'));
        expect(mockOnNavigate).toHaveBeenCalledWith('interventions', '1');
    });
});