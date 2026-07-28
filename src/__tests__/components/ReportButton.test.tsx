import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// Mock do githubService — captura o payload enviado ao backend.
const createIssueMock = vi.fn();
vi.mock('../../services/githubService', () => ({
    GithubService: { createIssue: (...args: any[]) => createIssueMock(...args) },
}));

// Mock de reportContext: controlamos o snapshot capturado e expomos spy.
const captureFullContextMock = vi.fn();
vi.mock('../../utils/reportContext', () => ({
    captureFullContext: (...args: any[]) => captureFullContextMock(...args),
}));

import { ReportButton } from '../../components/ReportButton';

describe('ReportButton', () => {
    beforeEach(() => {
        createIssueMock.mockReset();
        captureFullContextMock.mockReset();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('renderiza o FAB com label acessível', () => {
        render(<ReportButton />);
        expect(screen.getByRole('button', { name: /reportar problema/i })).toBeInTheDocument();
    });

    it('ao clicar, mostra loading e depois abre o modal chamando captureFullContext', async () => {
        let resolveCapture!: (value: Record<string, unknown>) => void;
        captureFullContextMock.mockReturnValue(new Promise((resolve) => {
            resolveCapture = resolve;
        }));

        render(<ReportButton />);
        const fab = screen.getByRole('button', { name: /reportar problema/i });
        fireEvent.click(fab);

        expect(captureFullContextMock).toHaveBeenCalledTimes(1);
        expect(fab).toBeDisabled();
        expect(fab.querySelector('.animate-spin')).toBeInTheDocument();

        resolveCapture({
            url: 'http://localhost/orders',
            breadcrumb: 'Pedidos',
            viewport: '1024x768',
            userAgent: 'ua',
            consoleErrors: ['e1'],
            consoleLogs: ['l1'],
            failedRequests: [],
            htmlSnapshot: '<html></html>',
            screenshot: 'data:image/png;base64,abc',
        });

        expect(await screen.findByText(/O que aconteceu\?/i)).toBeInTheDocument();
        expect(fab).not.toBeDisabled();
    });

    it('envia o payload completo (incluindo htmlSnapshot, screenshot, consoleLogs, consoleErrors) ao submeter', async () => {
        const ctx = {
            url: 'http://localhost/customers/1',
            breadcrumb: 'Cliente',
            viewport: '1024x768',
            userAgent: 'ua',
            consoleErrors: ['e1', 'e2'],
            consoleLogs: ['l1'],
            failedRequests: ['GET /api/x 500'],
            htmlSnapshot: '<html><body>x</body></html>',
            screenshot: 'data:image/png;base64,ZZZ',
        };
        captureFullContextMock.mockResolvedValue(ctx);
        createIssueMock.mockResolvedValue({ ok: true, url: 'https://gh/issues/99', number: 99 });

        render(<ReportButton />);
        fireEvent.click(screen.getByRole('button', { name: /reportar problema/i }));
        expect(await screen.findByPlaceholderText(/Resumo curto/i)).toBeInTheDocument();

        fireEvent.change(screen.getByPlaceholderText(/Resumo curto/i), { target: { value: 'Bug X' } });
        fireEvent.change(screen.getByPlaceholderText(/O que você fez/i), { target: { value: 'descrição' } });
        fireEvent.click(screen.getByRole('button', { name: /enviar/i }));

        await waitFor(() => expect(createIssueMock).toHaveBeenCalledTimes(1));
        const payload = createIssueMock.mock.calls[0][0];
        expect(payload.title).toBe('Bug X');
        expect(payload.description).toBe('descrição');
        // Critério de aceite #1560: payload inclui os 4 novos campos.
        expect(payload.context.htmlSnapshot).toBe(ctx.htmlSnapshot);
        expect(payload.context.screenshot).toBe(ctx.screenshot);
        expect(payload.context.consoleLogs).toEqual(ctx.consoleLogs);
        expect(payload.context.consoleErrors).toEqual(ctx.consoleErrors);
    });

    it('mesmo se captureFullContext falhar, abre o modal (não trava o usuário)', async () => {
        captureFullContextMock.mockRejectedValue(new Error('boom'));

        render(<ReportButton />);
        fireEvent.click(screen.getByRole('button', { name: /reportar problema/i }));
        // modal abre mesmo sem contexto
        expect(await screen.findByText(/O que aconteceu\?/i)).toBeInTheDocument();
        // FAB volta ao estado normal (não fica travado em loading)
        expect(screen.getByRole('button', { name: /reportar problema/i })).not.toBeDisabled();
    });

    it('exibe a seção de transparência com contagem de logs/erros/screenshot quando há contexto', async () => {
        captureFullContextMock.mockResolvedValue({
            url: 'http://localhost/',
            breadcrumb: 'Home',
            viewport: '1024x768',
            userAgent: 'ua',
            consoleErrors: ['e1', 'e2', 'e3'],
            consoleLogs: ['l1'],
            failedRequests: ['f1'],
            htmlSnapshot: 'x'.repeat(2048),
            screenshot: 'data:image/png;base64,abc',
        });

        const { container } = render(<ReportButton />);
        fireEvent.click(screen.getByRole('button', { name: /reportar problema/i }));
        // aguarda o modal abrir
        await screen.findByText(/Contexto que será anexado/i);
        // Conteúdo da seção de transparência (procura no textContent do modal).
        const text = container.textContent || '';
        expect(text).toContain('Erros de console:');
        expect(text).toContain('Logs:');
        expect(text).toContain('API falhas:');
        expect(text).toMatch(/3/); // 3 erros
        expect(text).toContain('Snapshot HTML:');
        expect(text).toContain('Screenshot: sim');
    });

    it('envia logs e erros mesmo quando timeout omite HTML e screenshot', async () => {
        captureFullContextMock.mockResolvedValue({
            url: 'http://localhost/orders',
            breadcrumb: 'Pedidos',
            viewport: '1024x768',
            userAgent: 'ua',
            consoleErrors: ['erro preservado'],
            consoleLogs: ['log preservado'],
            failedRequests: ['GET /api/orders 504'],
            htmlSnapshot: '',
            screenshot: '',
            captureMeta: { screenshotOmitted: true, reason: 'timeout' },
        });
        createIssueMock.mockResolvedValue({ ok: true, url: 'https://gh/issues/100', number: 100 });

        render(<ReportButton />);
        fireEvent.click(screen.getByRole('button', { name: /reportar problema/i }));
        await screen.findByPlaceholderText(/Resumo curto/i);
        fireEvent.change(screen.getByPlaceholderText(/Resumo curto/i), { target: { value: 'Timeout na captura' } });
        fireEvent.click(screen.getByRole('button', { name: /enviar/i }));

        await waitFor(() => expect(createIssueMock).toHaveBeenCalledTimes(1));
        expect(createIssueMock.mock.calls[0][0].context).toMatchObject({
            htmlSnapshot: '',
            screenshot: '',
            consoleErrors: ['erro preservado'],
            consoleLogs: ['log preservado'],
            failedRequests: ['GET /api/orders 504'],
        });
    });

    it('#1560 mostra motivo (rota sensível) quando captureMeta.reason é fornecido', async () => {
        captureFullContextMock.mockResolvedValue({
            url: 'http://localhost/login',
            breadcrumb: 'Login',
            viewport: '1024x768',
            userAgent: 'ua',
            consoleErrors: [],
            consoleLogs: [],
            failedRequests: [],
            htmlSnapshot: '',
            screenshot: '',
            captureMeta: { sensitiveRoute: true, screenshotOmitted: true, reason: 'sensitive-route' },
        });

        const { container } = render(<ReportButton />);
        fireEvent.click(screen.getByRole('button', { name: /reportar problema/i }));
        await screen.findByText(/Contexto que será anexado/i);
        const text = container.textContent || '';
        expect(text).toContain('rota sensível');
    });
});
