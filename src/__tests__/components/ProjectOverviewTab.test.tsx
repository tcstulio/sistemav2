import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ProjectOverviewTab } from '../../components/Projects/tabs/ProjectOverviewTab';
import { Project } from '../../types/projects';
import { formatCurrency } from '../../utils/formatUtils';

vi.mock('../../components/common/LinkedObjects', () => ({
    LinkedObjects: () => <div data-testid="linked-objects">LinkedObjects</div>
}));

vi.mock('../../utils/dateUtils', () => ({
    formatDateOnly: vi.fn((date: number | null) => date ? '01/01/2024' : null),
    formatDateLocal: vi.fn(),
}));

describe('ProjectOverviewTab', () => {
    const mockOnNavigate = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
    });

    const createMockProject = (overrides: Partial<Project> = {}): Project => ({
        id: '1',
        ref: 'PRJ-001',
        title: 'Projeto Teste',
        statut: '1',
        date_creation: Date.now(),
        date_start: Date.now(),
        date_end: undefined,
        socid: '1',
        progress: 50,
        ...overrides
    });

    it('renders Details section', () => {
        const project = createMockProject();
        render(
            <ProjectOverviewTab
                project={project}
                customerName="Empresa Teste"
                totalInvoiced={1000}
                totalSupplierBills={200}
                totalExpenses={100}
                onNavigate={mockOnNavigate}
            />
        );
        expect(screen.getByText('Detalhes')).toBeInTheDocument();
    });

    it('renders customer name', () => {
        const project = createMockProject();
        render(
            <ProjectOverviewTab
                project={project}
                customerName="Empresa ABC"
                totalInvoiced={500}
                totalSupplierBills={100}
                totalExpenses={50}
                onNavigate={mockOnNavigate}
            />
        );
        expect(screen.getByText('Empresa ABC')).toBeInTheDocument();
    });

    it('renders progress percentage', () => {
        const project = createMockProject({ progress: 75 });
        render(
            <ProjectOverviewTab
                project={project}
                customerName="Empresa Teste"
                totalInvoiced={1000}
                totalSupplierBills={200}
                totalExpenses={100}
                onNavigate={mockOnNavigate}
            />
        );
        expect(screen.getByText('75%')).toBeInTheDocument();
    });

    it('renders financial summary section', () => {
        const project = createMockProject();
        render(
            <ProjectOverviewTab
                project={project}
                customerName="Empresa Teste"
                totalInvoiced={1000}
                totalSupplierBills={200}
                totalExpenses={100}
                onNavigate={mockOnNavigate}
            />
        );
        expect(screen.getByText('Resumo Financeiro')).toBeInTheDocument();
        expect(screen.getByText('Faturado')).toBeInTheDocument();
    });

    it('renders Custos (costs) label', () => {
        const project = createMockProject();
        render(
            <ProjectOverviewTab
                project={project}
                customerName="Empresa Teste"
                totalInvoiced={1000}
                totalSupplierBills={200}
                totalExpenses={100}
                onNavigate={mockOnNavigate}
            />
        );
        expect(screen.getByText('Custos')).toBeInTheDocument();
    });

    it('renders Margem (margin) label', () => {
        const project = createMockProject();
        render(
            <ProjectOverviewTab
                project={project}
                customerName="Empresa Teste"
                totalInvoiced={1000}
                totalSupplierBills={200}
                totalExpenses={100}
                onNavigate={mockOnNavigate}
            />
        );
        expect(screen.getByText('Margem')).toBeInTheDocument();
    });

    it('renders createdByName when provided', () => {
        const project = createMockProject();
        render(
            <ProjectOverviewTab
                project={project}
                customerName="Empresa Teste"
                totalInvoiced={1000}
                totalSupplierBills={200}
                totalExpenses={100}
                createdByName="Admin User"
                onNavigate={mockOnNavigate}
            />
        );
        expect(screen.getByText('Admin User')).toBeInTheDocument();
    });

    it('does not render createdByName section when not provided', () => {
        const project = createMockProject();
        render(
            <ProjectOverviewTab
                project={project}
                customerName="Empresa Teste"
                totalInvoiced={1000}
                totalSupplierBills={200}
                totalExpenses={100}
                onNavigate={mockOnNavigate}
            />
        );
        expect(screen.queryByText('Criado por')).not.toBeInTheDocument();
    });

    it('calls onNavigate when clicking customer name', () => {
        const project = createMockProject({ socid: '5' });
        render(
            <ProjectOverviewTab
                project={project}
                customerName="Empresa Teste"
                totalInvoiced={1000}
                totalSupplierBills={200}
                totalExpenses={100}
                onNavigate={mockOnNavigate}
            />
        );
        fireEvent.click(screen.getByText('Empresa Teste'));
        expect(mockOnNavigate).toHaveBeenCalledWith('customers', '5');
    });

    it('renders LinkedObjects component', () => {
        const project = createMockProject();
        render(
            <ProjectOverviewTab
                project={project}
                customerName="Empresa Teste"
                totalInvoiced={1000}
                totalSupplierBills={200}
                totalExpenses={100}
                onNavigate={mockOnNavigate}
            />
        );
        expect(screen.getByTestId('linked-objects')).toBeInTheDocument();
    });

    describe('Currency formatting (BRL/pt-BR) — issue #623', () => {
        it('formats Faturado, Custos and Margem as BRL (R$) without raw $', () => {
            const project = createMockProject();
            const totalInvoiced = 1234.56;
            const totalSupplierBills = 300.5;
            const totalExpenses = 150;
            const { container } = render(
                <ProjectOverviewTab
                    project={project}
                    customerName="Empresa Teste"
                    totalInvoiced={totalInvoiced}
                    totalSupplierBills={totalSupplierBills}
                    totalExpenses={totalExpenses}
                    onNavigate={mockOnNavigate}
                />
            );

            const invoicedFormatted = formatCurrency(totalInvoiced);
            const costsFormatted = formatCurrency(totalSupplierBills + totalExpenses);
            const marginFormatted = formatCurrency(totalInvoiced - totalSupplierBills - totalExpenses);

            const allEls = Array.from(container.querySelectorAll('*'));
            expect(allEls.some(el => el.textContent === invoicedFormatted)).toBe(true);
            expect(allEls.some(el => el.textContent === costsFormatted)).toBe(true);
            expect(allEls.some(el => el.textContent === marginFormatted)).toBe(true);

            expect(container.textContent).toContain('R$');
            expect(container.textContent).not.toContain('$1,234.56');
        });

        it('renders pt-BR thousand/decimal separators', () => {
            const project = createMockProject();
            const { container } = render(
                <ProjectOverviewTab
                    project={project}
                    customerName="Empresa Teste"
                    totalInvoiced={1234.56}
                    totalSupplierBills={0}
                    totalExpenses={0}
                    onNavigate={mockOnNavigate}
                />
            );

            const formatted = formatCurrency(1234.56);
            expect(formatted).toContain('1.234,56');
            expect(container.textContent).toContain('1.234,56');
        });

        it('keeps negative margin in red', () => {
            const project = createMockProject();
            const { container } = render(
                <ProjectOverviewTab
                    project={project}
                    customerName="Empresa Teste"
                    totalInvoiced={100}
                    totalSupplierBills={500}
                    totalExpenses={200}
                    onNavigate={mockOnNavigate}
                />
            );

            const marginFormatted = formatCurrency(100 - 500 - 200);
            const marginEl = Array.from(container.querySelectorAll('span')).find(
                el => el.textContent === marginFormatted
            );
            expect(marginEl).toBeDefined();
            expect(marginEl?.className).toContain('text-red-500');
        });
    });

    describe('#624 — descrição e orçamento na Visão Geral', () => {
        it('renders description when project has description', () => {
            const project = createMockProject({ description: 'Descrição do projeto teste' });
            render(
                <ProjectOverviewTab
                    project={project}
                    customerName="Empresa Teste"
                    totalInvoiced={0}
                    totalSupplierBills={0}
                    totalExpenses={0}
                    onNavigate={mockOnNavigate}
                />
            );
            expect(screen.getByText('Descrição')).toBeInTheDocument();
            expect(screen.getByText('Descrição do projeto teste')).toBeInTheDocument();
        });

        it('does not render description section when project has no description', () => {
            const project = createMockProject({ description: undefined });
            render(
                <ProjectOverviewTab
                    project={project}
                    customerName="Empresa Teste"
                    totalInvoiced={0}
                    totalSupplierBills={0}
                    totalExpenses={0}
                    onNavigate={mockOnNavigate}
                />
            );
            expect(screen.queryByText('Descrição')).not.toBeInTheDocument();
        });

        it('renders budget when project has budget_amount > 0', () => {
            const project = createMockProject({ budget_amount: 50000 });
            render(
                <ProjectOverviewTab
                    project={project}
                    customerName="Empresa Teste"
                    totalInvoiced={0}
                    totalSupplierBills={0}
                    totalExpenses={0}
                    onNavigate={mockOnNavigate}
                />
            );
            expect(screen.getByText('Orçamento')).toBeInTheDocument();
        });

        it('does not render budget section when project has no budget_amount', () => {
            const project = createMockProject({ budget_amount: undefined });
            render(
                <ProjectOverviewTab
                    project={project}
                    customerName="Empresa Teste"
                    totalInvoiced={0}
                    totalSupplierBills={0}
                    totalExpenses={0}
                    onNavigate={mockOnNavigate}
                />
            );
            expect(screen.queryByText('Orçamento')).not.toBeInTheDocument();
        });
    });
});