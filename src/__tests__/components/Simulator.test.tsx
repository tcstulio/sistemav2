import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Simulator from '../../pages/Simulator/index';
import { STORAGE_KEY_DRAFT } from '../../pages/Simulator/constants';

vi.mock('../../context/DolibarrContext', () => ({
    useDolibarr: () => ({
        currentUser: { id: '1', login: 'tester', firstname: 'Tester', lastname: 'User', admin: true },
    }),
}));

vi.mock('../../utils/notifyError', () => ({
    notifyError: vi.fn(),
}));

// Mock recharts components that require a real DOM with measured dimensions
vi.mock('recharts', () => ({
    ResponsiveContainer: ({ children }: any) => <div style={{ width: 400, height: 400 }}>{children}</div>,
    AreaChart: ({ children }: any) => <div data-testid="area-chart">{children}</div>,
    Area: () => null,
    CartesianGrid: () => null,
    XAxis: () => null,
    YAxis: () => null,
    Tooltip: () => null,
    ReferenceLine: () => null,
}));

vi.mock('sonner', () => ({
    toast: { success: vi.fn(), error: vi.fn() },
}));

const mockConfirm = vi.hoisted(() => vi.fn().mockResolvedValue(true));
vi.mock('../../hooks/useConfirm', () => ({
    useConfirm: () => mockConfirm,
    ConfirmProvider: ({ children }: any) => children,
}));

// Mock simulatorApi so SavedSimulationsModal receives an array (not a raw fetch object)
vi.mock('../../services/simulatorApi', () => ({
    simulatorApi: {
        list: vi.fn(async () => []),
        create: vi.fn(async (s: any) => s),
        update: vi.fn(async (_id: string, updates: any) => ({ id: _id, ...updates })),
        delete: vi.fn(async () => undefined),
    },
}));

describe('Simulator layout regression (#605)', () => {
    beforeEach(() => {
        localStorage.clear();
        vi.clearAllMocks();
    });

    it('root container does NOT use min-h-screen', () => {
        const { container } = render(<Simulator />);
        const root = container.firstChild as HTMLElement;
        expect(root).not.toHaveClass('min-h-screen');
    });

    it('root container uses h-full and overflow-y-auto for scroll-within layout', () => {
        const { container } = render(<Simulator />);
        const root = container.firstChild as HTMLElement;
        expect(root).toHaveClass('h-full');
        expect(root).toHaveClass('overflow-y-auto');
    });

    it('toolbar (sticky header) has dark: classes applied', () => {
        const { container } = render(<Simulator />);
        // Find the sticky toolbar div
        const toolbar = container.querySelector('.sticky.top-0');
        expect(toolbar).not.toBeNull();
        const cls = toolbar!.className;
        expect(cls).toMatch(/dark:/);
    });

    it('navigation bar (sticky bottom) has dark: classes applied', () => {
        const { container } = render(<Simulator />);
        const navBar = container.querySelector('.sticky.bottom-0');
        expect(navBar).not.toBeNull();
        const cls = navBar!.className;
        expect(cls).toMatch(/dark:/);
    });

    it('renders step 1 by default with Drivers de Receita heading', () => {
        render(<Simulator />);
        expect(screen.getByText('Drivers de Receita')).toBeInTheDocument();
    });

    it('clicking Próximo advances to step 2 (Modelo de Negócio)', async () => {
        const user = userEvent.setup();
        render(<Simulator />);

        await user.click(screen.getByText('Próximo'));

        expect(await screen.findByText('Modelo de Negócio')).toBeInTheDocument();
    });

    it('clicking Próximo twice advances to step 3 (Break-Even)', async () => {
        const user = userEvent.setup();
        render(<Simulator />);

        await user.click(screen.getByText('Próximo'));
        await user.click(screen.getByText('Próximo'));

        expect(await screen.findByText('Análise de Break-Even')).toBeInTheDocument();
    });

    it('clicking Próximo three times reaches step 4 (Resultado)', async () => {
        const user = userEvent.setup();
        render(<Simulator />);

        await user.click(screen.getByText('Próximo'));
        await user.click(screen.getByText('Próximo'));
        await user.click(screen.getByText('Próximo'));

        expect(await screen.findByText('Resultado da Casa')).toBeInTheDocument();
    });

    it('Biblioteca button opens SavedSimulationsModal', async () => {
        const user = userEvent.setup();
        render(<Simulator />);

        await user.click(screen.getByTitle('Ir para passo 1') ? screen.getByText('Biblioteca') : screen.getByText('Biblioteca'));

        expect(await screen.findByText('Biblioteca de Cenários')).toBeInTheDocument();
    });

    it('Voltar button is disabled on step 1', () => {
        render(<Simulator />);
        const voltarBtn = screen.getByText('Voltar').closest('button');
        expect(voltarBtn).toBeDisabled();
    });
});

describe('Simulator "Novo Cálculo" reset (#831)', () => {
    const reloadSpy = vi.fn();
    let originalLocation: Location;

    beforeEach(() => {
        localStorage.clear();
        vi.clearAllMocks();
        mockConfirm.mockReset();
        mockConfirm.mockResolvedValue(true);
        originalLocation = window.location;
        Object.defineProperty(window, 'location', {
            configurable: true,
            value: {
                ...originalLocation,
                href: originalLocation.href,
                origin: originalLocation.origin,
                pathname: originalLocation.pathname,
                search: originalLocation.search,
                hash: originalLocation.hash,
                host: originalLocation.host,
                hostname: originalLocation.hostname,
                port: originalLocation.port,
                protocol: originalLocation.protocol,
                assign: vi.fn(),
                replace: vi.fn(),
                reload: reloadSpy,
            },
        });
    });

    afterEach(() => {
        Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
    });

    const goToStep4 = async () => {
        const user = userEvent.setup();
        render(<Simulator />);
        await user.click(screen.getByTitle('Ir para passo 4'));
        expect(await screen.findByText('Resultado da Casa')).toBeInTheDocument();
        return user;
    };

    it('asks for confirmation and does NOT reload the page', async () => {
        mockConfirm.mockResolvedValue(false);
        const user = await goToStep4();

        await user.click(screen.getByRole('button', { name: /Novo Cálculo/i }));

        expect(mockConfirm).toHaveBeenCalledTimes(1);
        expect(mockConfirm).toHaveBeenCalledWith(
            expect.objectContaining({ message: expect.stringMatching(/Descartar os dados do simulador/i) })
        );
        expect(reloadSpy).not.toHaveBeenCalled();
    });

    it('resets the form to step 1 and clears the draft when confirmed', async () => {
        const user = await goToStep4();

        await user.click(screen.getByRole('button', { name: /Novo Cálculo/i }));

        expect(await screen.findByText('Drivers de Receita')).toBeInTheDocument();
        expect(localStorage.removeItem).toHaveBeenCalledWith(STORAGE_KEY_DRAFT);
        expect(reloadSpy).not.toHaveBeenCalled();
    });

    it('keeps the data when confirmation is cancelled', async () => {
        mockConfirm.mockResolvedValue(false);
        const user = await goToStep4();

        await user.click(screen.getByRole('button', { name: /Novo Cálculo/i }));

        expect(await screen.findByText('Resultado da Casa')).toBeInTheDocument();
        expect(mockConfirm).toHaveBeenCalledTimes(1);
        expect(reloadSpy).not.toHaveBeenCalled();
    });
});
