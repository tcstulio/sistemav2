import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AgendaEntryDetail from '../../components/AgendaEntryDetail';
import { DolibarrConfig } from '../../types';

const mockToast = vi.hoisted(() => ({
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: mockToast }));

const { mockConfirm, confirmState } = vi.hoisted(() => {
    const confirmState = { result: true };
    return { mockConfirm: vi.fn(() => Promise.resolve(confirmState.result)), confirmState };
});
vi.mock('../../hooks/useConfirm', () => ({
    useConfirm: () => mockConfirm,
}));

const mockNotifyError = vi.hoisted(() => vi.fn());
vi.mock('../../utils/notifyError', () => ({
    notifyError: (...args: any[]) => mockNotifyError(...args),
}));

const { updateEvent, deleteEvent } = vi.hoisted(() => ({
    updateEvent: vi.fn().mockResolvedValue({}),
    deleteEvent: vi.fn().mockResolvedValue({}),
}));
vi.mock('../../services/dolibarrService', () => ({
    DolibarrService: { updateEvent, deleteEvent },
}));

const mockGet = vi.hoisted(() => vi.fn());
vi.mock('../../services/dbService', () => ({
    dbService: { get: (...args: any[]) => mockGet(...args) },
}));

const mockMapAgendaEvent = vi.hoisted(() => vi.fn());
vi.mock('../../hooks/dolibarr/mappers', () => ({
    mapAgendaEvent: (...args: any[]) => mockMapAgendaEvent(...args),
    mapTask: vi.fn(),
    mapProject: vi.fn(),
    mapIntervention: vi.fn(),
}));

vi.mock('../../hooks/useDolibarrLink', () => ({
    useDolibarrLink: () => ({ getLink: vi.fn(() => '#'), openLink: vi.fn() }),
}));

vi.mock('../../utils/sanitizeHtml', () => ({
    SafeHtml: ({ html }: { html: string }) => <div data-testid="safe-html" dangerouslySetInnerHTML={{ __html: html }} />,
}));

const mockConfig: DolibarrConfig = {
    apiUrl: 'https://api.example.com',
    apiKey: 'test-key',
    themeColor: 'indigo',
    darkMode: false,
    apiLimit: 0,
    currentUser: {} as any,
};

const mockEvent = {
    id: '1',
    ref: 'EV001',
    label: 'Reunião de Equipe',
    date_start: 1700000000000,
    date_end: 1700003600000,
    type_code: 'AC_RDV',
    percentage: 50,
    description: 'Discussão sobre o roadmap',
};

describe('AgendaEntryDetail', () => {
    const mockOnNavigate = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
        mockGet.mockResolvedValue({ id: '1', label: 'raw' });
        mockMapAgendaEvent.mockReturnValue(mockEvent);
        confirmState.result = true;
    });

    const renderComponent = (props?: Partial<React.ComponentProps<typeof AgendaEntryDetail>>) =>
        render(
            <AgendaEntryDetail
                config={mockConfig}
                initialItemId="evt-1"
                onNavigate={mockOnNavigate}
                {...props}
            />
        );

    it('renders loading state initially', () => {
        mockGet.mockReturnValue(new Promise(() => {}));
        renderComponent();
        expect(screen.getByText('Carregando detalhes...')).toBeInTheDocument();
    });

    it('renders event details after loading', async () => {
        renderComponent();
        await waitFor(() => {
            expect(screen.getByText('Reunião de Equipe')).toBeInTheDocument();
        });
    });

    it('shows error state when item not found in cache', async () => {
        mockMapAgendaEvent.mockReturnValue(null);
        renderComponent();
        await waitFor(() => {
            expect(screen.getByText('Item não encontrado no cache local. Aguarde a sincronização.')).toBeInTheDocument();
        });
    });

    describe('Edit mode', () => {
        it('enters edit mode and shows toast.error when saving without a title', async () => {
            renderComponent();
            await waitFor(() => expect(screen.getByText('Reunião de Equipe')).toBeInTheDocument());

            fireEvent.click(screen.getByTitle('Editar Evento'));
            const input = screen.getByDisplayValue('Reunião de Equipe') as HTMLInputElement;
            fireEvent.change(input, { target: { value: '' } });

            fireEvent.click(screen.getByText('Salvar Alterações'));

            await waitFor(() => {
                expect(mockToast.error).toHaveBeenCalledWith('O título é obrigatório.');
            });
            expect(updateEvent).not.toHaveBeenCalled();
        });

        it('saves successfully via DolibarrService.updateEvent', async () => {
            renderComponent();
            await waitFor(() => expect(screen.getByText('Reunião de Equipe')).toBeInTheDocument());

            fireEvent.click(screen.getByTitle('Editar Evento'));
            fireEvent.click(screen.getByText('Salvar Alterações'));

            await waitFor(() => {
                expect(updateEvent).toHaveBeenCalledWith(
                    mockConfig,
                    '1',
                    expect.objectContaining({ label: 'Reunião de Equipe' })
                );
            });
        });

        it('calls notifyError when save fails', async () => {
            updateEvent.mockRejectedValueOnce(new Error('Network error'));
            renderComponent();
            await waitFor(() => expect(screen.getByText('Reunião de Equipe')).toBeInTheDocument());

            fireEvent.click(screen.getByTitle('Editar Evento'));
            fireEvent.click(screen.getByText('Salvar Alterações'));

            await waitFor(() => {
                expect(mockNotifyError).toHaveBeenCalledWith('Salvar evento', expect.any(Error));
            });
        });
    });

    describe('Delete', () => {
        it('shows confirm dialog and deletes when confirmed', async () => {
            renderComponent();
            await waitFor(() => expect(screen.getByText('Reunião de Equipe')).toBeInTheDocument());

            fireEvent.click(screen.getByTitle('Excluir Evento'));

            await waitFor(() => {
                expect(mockConfirm).toHaveBeenCalledWith('Tem certeza que deseja excluir este evento permanentemente?');
            });

            await waitFor(() => {
                expect(deleteEvent).toHaveBeenCalledWith(mockConfig, '1');
            });
            expect(mockOnNavigate).toHaveBeenCalledWith('agenda', '');
        });

        it('does not delete when confirm is cancelled', async () => {
            confirmState.result = false;
            renderComponent();
            await waitFor(() => expect(screen.getByText('Reunião de Equipe')).toBeInTheDocument());

            fireEvent.click(screen.getByTitle('Excluir Evento'));

            await waitFor(() => {
                expect(mockConfirm).toHaveBeenCalled();
            });
            expect(deleteEvent).not.toHaveBeenCalled();
        });

        it('calls notifyError when delete fails', async () => {
            deleteEvent.mockRejectedValueOnce(new Error('Server error'));
            renderComponent();
            await waitFor(() => expect(screen.getByText('Reunião de Equipe')).toBeInTheDocument());

            fireEvent.click(screen.getByTitle('Excluir Evento'));

            await waitFor(() => {
                expect(mockNotifyError).toHaveBeenCalledWith('Excluir evento', expect.any(Error));
            });
        });
    });

    it('does not use native alert or confirm', () => {
        const alertSpy = vi.spyOn(window, 'alert');
        const confirmSpy = vi.spyOn(window, 'confirm');
        renderComponent();

        expect(alertSpy).not.toHaveBeenCalled();
        expect(confirmSpy).not.toHaveBeenCalled();
        alertSpy.mockRestore();
        confirmSpy.mockRestore();
    });
});
