import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Hoist mocks so they are available before imports
const mockDolibarrService = vi.hoisted(() => ({
    createContact: vi.fn().mockResolvedValue({ id: '99' }),
    updateContact: vi.fn().mockResolvedValue({ id: '1' }),
    deleteContact: vi.fn().mockResolvedValue({ success: true }),
}));

const mockUseContacts = vi.hoisted(() =>
    vi.fn(() => ({
        data: [
            { id: '1', socid: '42', firstname: 'Ana', lastname: 'Lima', email: 'ana@test.com', phone_mobile: '11 99999-0001', poste: 'Gerente', statut: '1' as const },
            { id: '2', socid: '42', firstname: 'Bruno', lastname: 'Souza', email: '', phone_mobile: '', poste: '', statut: '1' as const },
            { id: '3', socid: '99', firstname: 'Carla', lastname: 'Dias', email: '', phone_mobile: '', poste: '', statut: '1' as const },
        ],
        refetch: vi.fn(),
    }))
);

vi.mock('../../services/dolibarrService', () => ({ DolibarrService: mockDolibarrService }));
vi.mock('../../hooks/dolibarr', () => ({ useContacts: mockUseContacts }));
vi.mock('sonner', () => ({
    toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
vi.mock('../../utils/logger', () => ({
    logger: { child: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

import { ThirdPartyContacts } from '../../components/common/ThirdPartyContacts';

const config = { apiUrl: 'https://test.dolibarr.com/api', apiKey: 'test-key' } as any;

describe('ThirdPartyContacts', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockUseContacts.mockReturnValue({
            data: [
                { id: '1', socid: '42', firstname: 'Ana', lastname: 'Lima', email: 'ana@test.com', phone_mobile: '11 99999-0001', poste: 'Gerente', statut: '1' as const },
                { id: '2', socid: '42', firstname: 'Bruno', lastname: 'Souza', email: '', phone_mobile: '', poste: '', statut: '1' as const },
                { id: '3', socid: '99', firstname: 'Carla', lastname: 'Dias', email: '', phone_mobile: '', poste: '', statut: '1' as const },
            ],
            refetch: vi.fn(),
        });
        mockDolibarrService.createContact.mockResolvedValue({ id: '99' });
        mockDolibarrService.updateContact.mockResolvedValue({ id: '1' });
        mockDolibarrService.deleteContact.mockResolvedValue({ success: true });
    });

    it('renderiza somente os contatos do socid informado', () => {
        render(<ThirdPartyContacts socid="42" config={config} />);
        expect(screen.getByText('Ana Lima')).toBeInTheDocument();
        expect(screen.getByText('Bruno Souza')).toBeInTheDocument();
        // Carla pertence ao socid 99, não deve aparecer
        expect(screen.queryByText('Carla Dias')).not.toBeInTheDocument();
    });

    it('mostra EmptyState quando não há contatos para o socid', () => {
        mockUseContacts.mockReturnValue({ data: [], refetch: vi.fn() });
        render(<ThirdPartyContacts socid="42" config={config} />);
        expect(screen.getByText(/nenhum responsável cadastrado/i)).toBeInTheDocument();
    });

    it('abre o modal de criação e chama createContact com socid correto', async () => {
        const user = userEvent.setup();
        render(<ThirdPartyContacts socid="42" config={config} />);

        // Click "Adicionar" button (first one in header)
        const addButtons = screen.getAllByRole('button', { name: /adicionar/i });
        await user.click(addButtons[0]);

        expect(screen.getByText('Novo Responsável')).toBeInTheDocument();

        // Fill in form — use exact labels to avoid ambiguity between "Nome" and "Sobrenome"
        await user.type(screen.getByLabelText(/^nome$/i), 'João');
        await user.type(screen.getByLabelText(/^sobrenome$/i), 'Silva');

        // Submit
        await user.click(screen.getByRole('button', { name: /criar/i }));

        await waitFor(() => {
            expect(mockDolibarrService.createContact).toHaveBeenCalledWith(
                config,
                expect.objectContaining({ firstname: 'João', lastname: 'Silva', socid: '42', fk_soc: '42' })
            );
        });
    });

    it('abre o modal de edição e chama updateContact', async () => {
        const user = userEvent.setup();
        render(<ThirdPartyContacts socid="42" config={config} />);

        // Click the edit (pencil) button for Ana Lima
        const editButtons = screen.getAllByTitle(/editar responsável/i);
        await user.click(editButtons[0]);

        expect(screen.getByText(/editar: ana lima/i)).toBeInTheDocument();

        // Change poste
        const cargoInput = screen.getByLabelText(/^cargo$/i);
        await user.clear(cargoInput);
        await user.type(cargoInput, 'Diretor');

        // Save
        await user.click(screen.getByRole('button', { name: /salvar/i }));

        await waitFor(() => {
            expect(mockDolibarrService.updateContact).toHaveBeenCalledWith(
                config,
                '1',
                expect.objectContaining({ poste: 'Diretor' })
            );
        });
    });

    it('chama deleteContact ao remover (via ConfirmDeleteButton)', async () => {
        const user = userEvent.setup();
        render(<ThirdPartyContacts socid="42" config={config} />);

        // ConfirmDeleteButton renders aria-label="Excluir"
        const deleteButtons = screen.getAllByRole('button', { name: /excluir/i });
        // First delete button corresponds to Ana Lima
        await user.click(deleteButtons[0]);

        // ConfirmDeleteButton opens modal; the confirm button inside modal also says "Excluir"
        // After first click, the modal opens with a second "Excluir" button
        await waitFor(() => {
            const confirmButtons = screen.getAllByRole('button', { name: /excluir/i });
            expect(confirmButtons.length).toBeGreaterThan(1);
        });

        const confirmButtons = screen.getAllByRole('button', { name: /excluir/i });
        // The last "Excluir" button is the confirm button in the modal
        await user.click(confirmButtons[confirmButtons.length - 1]);

        await waitFor(() => {
            expect(mockDolibarrService.deleteContact).toHaveBeenCalledWith(config, '1');
        });
    });
});
