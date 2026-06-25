import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import AgendaView from '../AgendaView';

vi.mock('sonner', () => ({
    toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

vi.mock('../../context/DolibarrContext', () => ({
    useDolibarr: () => ({
        config: { currentUser: { id: '1', admin: 1 } },
        refreshData: vi.fn(),
    }),
}));

vi.mock('../../hooks/dolibarr', () => ({
    useEvents: () => ({ data: [], isLoading: false }),
    useTasks: () => ({ data: [], isLoading: false }),
    useInterventions: () => ({ data: [], isLoading: false }),
    useProjects: () => ({ data: [], isLoading: false }),
    useCustomers: () => ({ data: [], isLoading: false }),
}));

vi.mock('../../hooks/usePrefill', () => ({ usePrefill: () => null }));

vi.mock('../AgendaEntryDetail', () => ({ default: () => null }));

vi.mock('../../services/dolibarrService', () => ({ DolibarrService: vi.fn() }));

describe('AgendaView — chaves estáveis no calendário (#844)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // força o modo calendário (viewport largo) independentemente do jsdom
        window.innerWidth = 1024;
    });

    it('renderiza o cabeçalho do mês atual no modo calendário', () => {
        const now = new Date();
        const expectedLabel = now.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });

        render(<AgendaView />);

        expect(
            screen.getByRole('heading', { level: 3, name: new RegExp(expectedLabel, 'i') })
        ).toBeTruthy();
    });

    it('não emite aviso de chaves duplicadas (células vazias usam fallback)', () => {
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

        render(<AgendaView />);

        const dupKeyWarning = spy.mock.calls.find(
            (c) => typeof c[0] === 'string' && c[0].includes('children with the same key')
        );
        expect(dupKeyWarning).toBeUndefined();

        spy.mockRestore();
    });

    it('navega entre meses mantendo a renderização correta do grid (#844)', () => {
        const now = new Date();
        const monthLabel = (d: Date) =>
            d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });

        render(<AgendaView />);

        // Rótulo inicial = mês corrente
        const heading = () => screen.getByRole('heading', { level: 3 });
        expect(heading().textContent).toBe(monthLabel(now));

        // Botão de próximo mês (ícone ChevronRight do lucide-react)
        const nextBtn = document.querySelector('.lucide-chevron-right')?.closest('button') as HTMLButtonElement;
        expect(nextBtn).toBeTruthy();
        fireEvent.click(nextBtn);

        const nextMonthDate = new Date(now.getFullYear(), now.getMonth() + 1, 1);
        expect(heading().textContent).toBe(monthLabel(nextMonthDate));

        // O grid do calendário continua renderizando os cabeçalhos dos dias da semana
        expect(screen.getByText('Dom')).toBeInTheDocument();
        expect(screen.getByText('Sáb')).toBeInTheDocument();

        // Botão de mês anterior
        const prevBtn = document.querySelector('.lucide-chevron-left')?.closest('button') as HTMLButtonElement;
        fireEvent.click(prevBtn);
        expect(heading().textContent).toBe(monthLabel(now));
    });
});
