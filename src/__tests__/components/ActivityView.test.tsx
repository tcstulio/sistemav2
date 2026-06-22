import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ActivityView from '../../components/ActivityView';
import { SystemLog } from '../../types';

// --- Shared mutable state for per-test log injection ---
// vi.mock factories run once at hoist time; we use a mutable object to control data per test.
const state = {
    logs: [] as SystemLog[],
};

vi.mock('../../context/DolibarrContext', () => ({
    useDolibarr: () => ({ config: { apiUrl: 'http://test' } }),
}));

vi.mock('../../hooks/dolibarr', () => ({
    useSystemLogs: () => ({ data: state.logs, isLoading: false, refetch: vi.fn() }),
    useUsers: () => ({ data: [] }),
    useCustomers: () => ({
        data: [{ id: '10', name: 'Acme Corp' }],
    }),
    useProjects: () => ({
        data: [{ id: '20', title: 'Projeto Alpha', ref: 'PROJ-001', socid: '10', statut: '1', progress: 0 }],
    }),
}));

vi.mock('../../components/ActivityReportModal', () => ({
    default: () => null,
}));

vi.mock('../../utils/dateUtils', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../utils/dateUtils')>();
    return { ...actual, formatRelativeTime: () => 'agora' };
});

// --- Helpers ---

const makeLog = (over: Partial<SystemLog> = {}): SystemLog => ({
    id: '1',
    label: 'ref-001',
    type_code: 'AC_BILL_CREATE',
    date_action: Date.now(),
    ...over,
});

const renderWith = (logs: SystemLog[], onNavigate = vi.fn()) => {
    state.logs = logs;
    return { onNavigate, ...render(<ActivityView onNavigate={onNavigate} />) };
};

// --- Tests ---

describe('ActivityView (#584)', () => {
    beforeEach(() => {
        state.logs = [];
        vi.clearAllMocks();
    });

    // --- Critério 1: chip de cliente ---

    it('exibe chip de Cliente quando log tem socid e navega para customers ao clicar', () => {
        const onNavigate = vi.fn();
        renderWith([makeLog({ socid: '10', elementtype: undefined })], onNavigate);

        const chip = screen.getByRole('button', { name: /Cliente: Acme Corp/i });
        expect(chip).toBeTruthy();

        fireEvent.click(chip);
        expect(onNavigate).toHaveBeenCalledWith('customers', '10');
    });

    it('exibe id quando socid nao resolve para nome conhecido', () => {
        renderWith([makeLog({ socid: '99', elementtype: undefined })]);

        expect(screen.getByRole('button', { name: /Cliente: #99/i })).toBeTruthy();
    });

    // --- Critério 2: chip de projeto ---

    it('exibe chip de Projeto quando log tem project_id e navega para projects ao clicar', () => {
        const onNavigate = vi.fn();
        renderWith([makeLog({ project_id: '20', elementtype: undefined })], onNavigate);

        const chip = screen.getByRole('button', { name: /Projeto: Projeto Alpha/i });
        expect(chip).toBeTruthy();

        fireEvent.click(chip);
        expect(onNavigate).toHaveBeenCalledWith('projects', '20');
    });

    it('nao exibe chips de contexto quando socid e project_id estao ausentes', () => {
        renderWith([makeLog({ elementtype: 'facture', fk_element: '5', socid: undefined, project_id: undefined })]);

        expect(screen.queryByRole('button', { name: /Cliente:/i })).toBeNull();
        expect(screen.queryByRole('button', { name: /Projeto:/i })).toBeNull();
    });

    // --- Critério 3: item nao clicavel para tipos nao mapeados sem destino ---

    it('item com elementtype nao mapeado e sem socid nao dispara onNavigate ao ser clicado', () => {
        const onNavigate = vi.fn();
        renderWith([makeLog({ elementtype: 'mrp_mo', fk_element: undefined, socid: undefined })], onNavigate);

        // Find the feed row div (data-testid not present, so find by aria/class approach)
        // The row does NOT have onClick when not clickable — clicking the container should be a no-op
        // We can locate the row by finding the label text within a span and clicking the parent row
        const labelSpan = screen.getByText(/ref-001/i);
        // Walk up to find the clickable div (the row div)
        let row: Element | null = labelSpan;
        while (row && row.tagName !== 'DIV') row = row.parentElement;
        while (row?.parentElement && row.parentElement.tagName === 'DIV' && !row.getAttribute('class')?.includes('p-4')) {
            row = row.parentElement;
        }
        if (row) fireEvent.click(row);
        expect(onNavigate).not.toHaveBeenCalled();
    });

    // --- Critério 4: fallback de id corrigido ---

    it('item com elementtype mapeado e fk_element real navega corretamente', () => {
        const onNavigate = vi.fn();
        renderWith([makeLog({ elementtype: 'facture', fk_element: '42', socid: undefined })], onNavigate);

        // Find the row and click it
        const labelSpan = screen.getByText(/ref-001/i);
        let row: Element | null = labelSpan;
        // Walk up to the p-4 div row
        while (row && !(row.tagName === 'DIV' && row.className?.includes('p-4'))) {
            row = row.parentElement;
        }
        if (row) fireEvent.click(row);
        expect(onNavigate).toHaveBeenCalledWith('invoices', '42');
    });

    it('item com elementtype mapeado mas sem fk_element nao navega para log.id', () => {
        const onNavigate = vi.fn();
        // log.id = '1', fk_element ausente, sem socid -> nao deve navegar para ('invoices', '1')
        renderWith([makeLog({ id: '1', elementtype: 'facture', fk_element: undefined, socid: undefined })], onNavigate);

        const labelSpan = screen.getByText(/ref-001/i);
        let row: Element | null = labelSpan;
        while (row && !(row.tagName === 'DIV' && row.className?.includes('p-4'))) {
            row = row.parentElement;
        }
        if (row) fireEvent.click(row);
        expect(onNavigate).not.toHaveBeenCalledWith('invoices', '1');
    });

    it('item com elementtype nao mapeado e socid presente navega para customers', () => {
        const onNavigate = vi.fn();
        renderWith([makeLog({ elementtype: 'mrp_mo', fk_element: undefined, socid: '10' })], onNavigate);

        const labelSpan = screen.getByText(/ref-001/i);
        let row: Element | null = labelSpan;
        while (row && !(row.tagName === 'DIV' && row.className?.includes('p-4'))) {
            row = row.parentElement;
        }
        if (row) fireEvent.click(row);
        expect(onNavigate).toHaveBeenCalledWith('customers', '10');
    });
});
