import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ManufacturingOrderDetail } from '../../components/Manufacturing/details/ManufacturingOrderDetail';
import { ManufacturingOrder, DolibarrConfig, Product, StockMovement, Project } from '../../types';

const config: DolibarrConfig = {
    apiUrl: 'https://api.example.com',
    apiKey: 'key',
    themeColor: 'indigo',
    darkMode: false,
    apiLimit: 0,
};

const products: Product[] = [
    { id: '1', ref: 'P1', label: 'Produto Final', type: '0', price: 100, price_ttc: 100, stock_reel: 0 },
];

const projects: Project[] = [
    { id: 'proj1', ref: 'PROJ-001', title: 'Projeto Alpha', socid: '10', statut: '1', progress: 0 },
];

const stockMovements: StockMovement[] = [];

const draftOrder: ManufacturingOrder = {
    id: 'mo1',
    ref: 'MO-001',
    label: 'Ordem de Teste',
    status: '0',
    product_to_produce_id: '1',
    qty: 10,
};

const validatedOrder: ManufacturingOrder = {
    ...draftOrder,
    status: '1',
};

describe('ManufacturingOrderDetail — #585 Delete & Status', () => {
    const mockOnClose = vi.fn();
    const mockOnEdit = vi.fn();
    const mockOnOpenConsume = vi.fn();
    const mockOnOpenProduce = vi.fn();
    const mockOnDelete = vi.fn();
    const mockOnValidate = vi.fn();
    const mockOnCancel = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('shows Excluir button when onDelete is provided', () => {
        render(
            <ManufacturingOrderDetail
                order={draftOrder}
                products={products}
                projects={projects}
                stockMovements={stockMovements}
                config={config}
                onClose={mockOnClose}
                onOpenConsume={mockOnOpenConsume}
                onOpenProduce={mockOnOpenProduce}
                onDelete={mockOnDelete}
            />
        );
        expect(screen.getByTestId('mo-delete-btn')).toBeInTheDocument();
    });

    it('shows confirmation banner after clicking Excluir', () => {
        render(
            <ManufacturingOrderDetail
                order={draftOrder}
                products={products}
                projects={projects}
                stockMovements={stockMovements}
                config={config}
                onClose={mockOnClose}
                onOpenConsume={mockOnOpenConsume}
                onOpenProduce={mockOnOpenProduce}
                onDelete={mockOnDelete}
            />
        );
        fireEvent.click(screen.getByTestId('mo-delete-btn'));
        expect(screen.getByTestId('mo-delete-confirm-btn')).toBeInTheDocument();
        // MO-001 appears in both header and confirm banner
        const mentions = screen.getAllByText(/MO-001/);
        expect(mentions.length).toBeGreaterThanOrEqual(1);
    });

    it('calls onDelete after confirming deletion', () => {
        render(
            <ManufacturingOrderDetail
                order={draftOrder}
                products={products}
                projects={projects}
                stockMovements={stockMovements}
                config={config}
                onClose={mockOnClose}
                onOpenConsume={mockOnOpenConsume}
                onOpenProduce={mockOnOpenProduce}
                onDelete={mockOnDelete}
            />
        );
        fireEvent.click(screen.getByTestId('mo-delete-btn'));
        fireEvent.click(screen.getByTestId('mo-delete-confirm-btn'));
        expect(mockOnDelete).toHaveBeenCalledTimes(1);
    });

    it('does not call onDelete when confirmation is cancelled', () => {
        render(
            <ManufacturingOrderDetail
                order={draftOrder}
                products={products}
                projects={projects}
                stockMovements={stockMovements}
                config={config}
                onClose={mockOnClose}
                onOpenConsume={mockOnOpenConsume}
                onOpenProduce={mockOnOpenProduce}
                onDelete={mockOnDelete}
            />
        );
        fireEvent.click(screen.getByTestId('mo-delete-btn'));
        fireEvent.click(screen.getByText('Cancelar'));
        expect(mockOnDelete).not.toHaveBeenCalled();
    });

    it('shows Validar button for draft orders', () => {
        render(
            <ManufacturingOrderDetail
                order={draftOrder}
                products={products}
                projects={projects}
                stockMovements={stockMovements}
                config={config}
                onClose={mockOnClose}
                onOpenConsume={mockOnOpenConsume}
                onOpenProduce={mockOnOpenProduce}
                onValidate={mockOnValidate}
            />
        );
        expect(screen.getByTestId('mo-validate-btn')).toBeInTheDocument();
    });

    it('calls onValidate when Validar button is clicked', () => {
        render(
            <ManufacturingOrderDetail
                order={draftOrder}
                products={products}
                projects={projects}
                stockMovements={stockMovements}
                config={config}
                onClose={mockOnClose}
                onOpenConsume={mockOnOpenConsume}
                onOpenProduce={mockOnOpenProduce}
                onValidate={mockOnValidate}
            />
        );
        fireEvent.click(screen.getByTestId('mo-validate-btn'));
        expect(mockOnValidate).toHaveBeenCalledTimes(1);
    });

    it('does not show Validar button for validated orders', () => {
        render(
            <ManufacturingOrderDetail
                order={validatedOrder}
                products={products}
                projects={projects}
                stockMovements={stockMovements}
                config={config}
                onClose={mockOnClose}
                onOpenConsume={mockOnOpenConsume}
                onOpenProduce={mockOnOpenProduce}
                onValidate={mockOnValidate}
            />
        );
        expect(screen.queryByTestId('mo-validate-btn')).not.toBeInTheDocument();
    });

    it('shows Cancelar Ordem button for draft orders when onCancel provided', () => {
        render(
            <ManufacturingOrderDetail
                order={draftOrder}
                products={products}
                projects={projects}
                stockMovements={stockMovements}
                config={config}
                onClose={mockOnClose}
                onOpenConsume={mockOnOpenConsume}
                onOpenProduce={mockOnOpenProduce}
                onCancel={mockOnCancel}
            />
        );
        expect(screen.getByTestId('mo-cancel-btn')).toBeInTheDocument();
    });
});

describe('ManufacturingOrderDetail — #591 Project/Dates', () => {
    const mockOnClose = vi.fn();
    const mockOnOpenConsume = vi.fn();
    const mockOnOpenProduce = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('shows project name when project_id matches a project', () => {
        const orderWithProject: ManufacturingOrder = {
            ...draftOrder,
            project_id: 'proj1',
        };
        render(
            <ManufacturingOrderDetail
                order={orderWithProject}
                products={products}
                projects={projects}
                stockMovements={stockMovements}
                config={config}
                onClose={mockOnClose}
                onOpenConsume={mockOnOpenConsume}
                onOpenProduce={mockOnOpenProduce}
            />
        );
        expect(screen.getByTestId('mo-project-name')).toBeInTheDocument();
        expect(screen.getByTestId('mo-project-name').textContent).toBe('Projeto Alpha');
    });

    it('shows placeholder when no project_id', () => {
        render(
            <ManufacturingOrderDetail
                order={draftOrder}
                products={products}
                projects={projects}
                stockMovements={stockMovements}
                config={config}
                onClose={mockOnClose}
                onOpenConsume={mockOnOpenConsume}
                onOpenProduce={mockOnOpenProduce}
            />
        );
        expect(screen.queryByTestId('mo-project-name')).not.toBeInTheDocument();
    });

    it('shows date_start when provided', () => {
        const orderWithDates: ManufacturingOrder = {
            ...draftOrder,
            date_start: 1700000000,
            date_end: 1700500000,
        };
        render(
            <ManufacturingOrderDetail
                order={orderWithDates}
                products={products}
                projects={projects}
                stockMovements={stockMovements}
                config={config}
                onClose={mockOnClose}
                onOpenConsume={mockOnOpenConsume}
                onOpenProduce={mockOnOpenProduce}
            />
        );
        expect(screen.getByTestId('mo-date-start')).toBeInTheDocument();
        expect(screen.getByTestId('mo-date-end')).toBeInTheDocument();
    });

    it('shows placeholder when no dates provided', () => {
        render(
            <ManufacturingOrderDetail
                order={draftOrder}
                products={products}
                projects={projects}
                stockMovements={stockMovements}
                config={config}
                onClose={mockOnClose}
                onOpenConsume={mockOnOpenConsume}
                onOpenProduce={mockOnOpenProduce}
            />
        );
        expect(screen.queryByTestId('mo-date-start')).not.toBeInTheDocument();
        expect(screen.queryByTestId('mo-date-end')).not.toBeInTheDocument();
    });
});
