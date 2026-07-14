import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../services/dunningService', () => ({
    getDunningDigest: vi.fn(),
}));

import { getDunningDigest, DunningResponse } from '../../services/dunningService';
import { Dunning } from '../../pages/Dunning';

const mockGetDigest = vi.mocked(getDunningDigest);

const baseResponse: DunningResponse = {
    digest: { totalItems: 2, totalReady: 1, totalIncomplete: 1 },
    items: [
        {
            id: 'c1',
            socname: 'Acme Corp',
            totalAberto: 1234.56,
            diasAtrasoMax: 12,
            faturas: [
                { ref: 'FA-001', vencimento: 1735689600, valor: 1234.56 },
            ],
            rascunho: 'Olá Acme, identificamos fatura em aberto.',
            status: 'ready',
        },
        {
            id: 'c2',
            socname: 'Globex',
            totalAberto: 0,
            diasAtrasoMax: 0,
            faturas: [],
            rascunho: '',
            status: 'incomplete',
        },
    ],
};

beforeEach(() => {
    vi.clearAllMocks();
});

describe('Dunning page (#1404)', () => {
    it('renderiza o título e o subtítulo da página', async () => {
        mockGetDigest.mockResolvedValue({ digest: { totalItems: 0, totalReady: 0, totalIncomplete: 0 }, items: [] });
        render(<Dunning />);
        expect(screen.getByText('Cobranças (digest)')).toBeInTheDocument();
        expect(screen.getByText(/Fila priorizada/i)).toBeInTheDocument();
    });

    it('mostra tiles de digest a partir da resposta da API', async () => {
        mockGetDigest.mockResolvedValue(baseResponse);
        render(<Dunning />);

        await waitFor(() => {
            expect(screen.getByText('Itens na fila')).toBeInTheDocument();
        });
        expect(screen.getByText('2')).toBeInTheDocument();
        expect(screen.getByText('Prontos p/ copiar')).toBeInTheDocument();
        expect(screen.getAllByText('Dado indisponível').length).toBeGreaterThanOrEqual(2);
    });

    it('lista os itens retornados pela API na ordem do backend', async () => {
        mockGetDigest.mockResolvedValue(baseResponse);
        render(<Dunning />);

        await waitFor(() => {
            expect(screen.getByText('Acme Corp')).toBeInTheDocument();
        });
        expect(screen.getByText('Globex')).toBeInTheDocument();
    });

    it('exibe badge amarela "Dado indisponível" para itens com status incomplete', async () => {
        mockGetDigest.mockResolvedValue(baseResponse);
        render(<Dunning />);

        await waitFor(() => {
            expect(screen.getAllByText('Dado indisponível').length).toBeGreaterThan(0);
        });
        // A badge do tile + a badge do card incompleto
        const badges = screen.getAllByText('Dado indisponível');
        expect(badges.length).toBeGreaterThanOrEqual(2);
    });

    it('exibe empty state quando não há itens', async () => {
        mockGetDigest.mockResolvedValue({
            digest: { totalItems: 0, totalReady: 0, totalIncomplete: 0 },
            items: [],
        });
        render(<Dunning />);

        await waitFor(() => {
            expect(screen.getByText(/Nenhum recebível em aberto/i)).toBeInTheDocument();
        });
    });

    it('expande o card ao clicar e mostra o rascunho', async () => {
        const user = userEvent.setup();
        mockGetDigest.mockResolvedValue(baseResponse);
        render(<Dunning />);

        await waitFor(() => {
            expect(screen.getByText('Acme Corp')).toBeInTheDocument();
        });

        await user.click(screen.getByText('Acme Corp'));

        await waitFor(() => {
            expect(screen.getByText(/Olá Acme, identificamos fatura em aberto/)).toBeInTheDocument();
        });
    });

    it('cópia via navigator.clipboard.writeText ao clicar em "Copiar"', async () => {
        const user = userEvent.setup();
        const writeText = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(navigator, 'clipboard', {
            value: { writeText },
            configurable: true,
            writable: true,
        });
        mockGetDigest.mockResolvedValue(baseResponse);
        render(<Dunning />);

        await waitFor(() => {
            expect(screen.getByText('Acme Corp')).toBeInTheDocument();
        });

        await user.click(screen.getByText('Acme Corp'));

        const copyBtn = await screen.findByRole('button', { name: /Copiar/i });
        await user.click(copyBtn);

        await waitFor(() => {
            expect(writeText).toHaveBeenCalledWith('Olá Acme, identificamos fatura em aberto.');
        });
    });

    it('edição local funciona mas NÃO dispara request HTTP', async () => {
        const user = userEvent.setup();
        const fetchSpy = vi.spyOn(globalThis, 'fetch');
        mockGetDigest.mockResolvedValue(baseResponse);
        render(<Dunning />);

        await waitFor(() => {
            expect(screen.getByText('Acme Corp')).toBeInTheDocument();
        });

        await user.click(screen.getByText('Acme Corp'));

        const editBtn = await screen.findByRole('button', { name: /Editar/i });
        await user.click(editBtn);

        const textarea = await screen.findByLabelText(/Rascunho de mensagem para Acme Corp/);
        expect(textarea).not.toHaveAttribute('readonly');

        await user.clear(textarea);
        await user.type(textarea, 'Texto customizado');

        expect((textarea as HTMLTextAreaElement).value).toBe('Texto customizado');

        // Nenhum fetch disparado além do inicial de carregamento do digest
        const nonGetCalls = fetchSpy.mock.calls.filter(([url]) => !String(url).includes('/api/dunning'));
        expect(nonGetCalls.length).toBe(0);

        fetchSpy.mockRestore();
    });

    it('textarea é bloqueada para itens com status incomplete', async () => {
        const user = userEvent.setup();
        mockGetDigest.mockResolvedValue(baseResponse);
        render(<Dunning />);

        await waitFor(() => {
            expect(screen.getByText('Globex')).toBeInTheDocument();
        });

        await user.click(screen.getByText('Globex'));

        const textarea = await screen.findByLabelText(/Rascunho de mensagem para Globex/);
        expect(textarea).toBeDisabled();
        expect(textarea).toHaveAttribute('placeholder', '—');
    });

    it('botão "Editar" fica desabilitado para itens com status incomplete', async () => {
        const user = userEvent.setup();
        mockGetDigest.mockResolvedValue(baseResponse);
        render(<Dunning />);

        await waitFor(() => {
            expect(screen.getByText('Globex')).toBeInTheDocument();
        });

        await user.click(screen.getByText('Globex'));

        const editBtn = await screen.findByRole('button', { name: /Editar/i });
        expect(editBtn).toBeDisabled();
    });

    it('chama getDunningDigest no mount', async () => {
        mockGetDigest.mockResolvedValue({
            digest: { totalItems: 0, totalReady: 0, totalIncomplete: 0 },
            items: [],
        });
        render(<Dunning />);

        await waitFor(() => {
            expect(mockGetDigest).toHaveBeenCalledTimes(1);
        });
    });

    it('mostra estado de loading inicialmente', () => {
        mockGetDigest.mockReturnValue(new Promise(() => { /* never resolves */ }));
        render(<Dunning />);
        expect(screen.getByText(/Carregando digest/i)).toBeInTheDocument();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });
});
