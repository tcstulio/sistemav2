import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ProjectOverviewTab } from '../../components/Projects/tabs/ProjectOverviewTab';
import { Project } from '../../types/projects';

vi.mock('../../components/common/LinkedObjects', () => ({
    LinkedObjects: () => <div data-testid="linked-objects">LinkedObjects</div>
}));

vi.mock('../../utils/dateUtils', () => ({
    formatDateOnly: vi.fn((date: number | null) => date ? '01/01/2024' : null)
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
        description: null,
        statu: '1',
        date_c: Date.now(),
        date_start: Date.now(),
        date_end: null,
        socid: '1',
        public: '0',
        contact_id: null,
        assigned_users: [],
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
});