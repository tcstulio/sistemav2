import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { VenueList } from '../../components/VenueList';
import type { VenuePartnership } from '../../types/venue';

// Raw API response used by fetchList mock
const rawVenueRows = [
    {
        id: '10',
        ref: 'VENUE-010',
        type_code: 'salao',
        type_label: 'Salão',
        status: '1',
        fk_soc: '42',
        date_partnership_start: Date.now(),
        note_private: null,
        date_creation: Date.now(),
        tms: new Date().toISOString(),
        array_options: {
            options_nome_espaco: 'Salão Imperial',
            options_descreva: 'Espaço clássico',
            options_lotacao_em_pe: '200',
            options_lotacao_mesa_jantar: '100',
            options_lotacao_mesa_pequena: '150',
            options_quantidade_pessoas: '120',
            options_estrutura_geral: '4',
            options_classificacao: '5',
            options_localizacao: '4',
            options_tamanho: '3',
            options_preco: '4',
            options_negociacao_dia_da_semana: '1000',
            options_negociacao_final_de_semana: '2000',
            options_negociacao_corporativo: '1500',
            options_negociacao_cultural: '800',
            options_servicos_inclusos: 'Som Profissional,Iluminação',
        },
    },
    {
        id: '20',
        ref: 'VENUE-020',
        type_code: 'terraco',
        type_label: 'Terraço',
        status: '1',
        fk_soc: null,
        date_partnership_start: Date.now(),
        note_private: null,
        date_creation: Date.now(),
        tms: new Date().toISOString(),
        array_options: {
            options_nome_espaco: 'Terraço Moderno',
        },
    },
];

// --- Mocks ---

vi.mock('../../context/DolibarrContext', () => {
    // Stable config reference — important so that useEffect([config]) doesn't re-run on every render
    const cfg = { apiUrl: 'https://test.dolibarr.com/api', apiKey: 'test-key' };
    return {
        useDolibarr: vi.fn(() => ({ config: cfg })),
    };
});

vi.mock('../../services/api/core', () => ({
    fetchList: vi.fn(async () => rawVenueRows),
}));

vi.mock('../../services/api/venues', () => ({
    createVenue: vi.fn(async () => ({ id: '99' })),
    updateVenue: vi.fn(async () => ({ id: '10' })),
    deleteVenue: vi.fn(async () => null),
}));

vi.mock('../../services/api/commercial', () => ({
    getThirdParty: vi.fn(async (_config: any, id: string) => ({
        id,
        name: 'Empresa Parceira SA',
    })),
}));

// Import mocked modules AFTER vi.mock declarations
import * as coreApi from '../../services/api/core';
import * as venuesApi from '../../services/api/venues';

beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(coreApi.fetchList).mockResolvedValue(rawVenueRows);
    vi.mocked(venuesApi.createVenue).mockResolvedValue({ id: '99' });
    vi.mocked(venuesApi.updateVenue).mockResolvedValue({ id: '10' });
    vi.mocked(venuesApi.deleteVenue).mockResolvedValue(null);
});

// --- Existing tests (read-only behaviour) ---

describe('VenueList', () => {
    it('renderiza a lista de espaços sem abrir detalhe quando initialItemId não é informado', async () => {
        render(<VenueList />);
        await waitFor(() => {
            expect(screen.getByText('Salão Imperial')).toBeInTheDocument();
            expect(screen.getByText('Terraço Moderno')).toBeInTheDocument();
        });
        expect(screen.queryByText('Visão Geral')).not.toBeInTheDocument();
    });

    it('abre o detalhe do espaço correto quando initialItemId é informado', async () => {
        render(<VenueList initialItemId="10" />);
        await waitFor(() => {
            expect(screen.getAllByText('Salão Imperial').length).toBeGreaterThan(0);
        });
    });

    it('initialItemId inexistente não abre detalhe e não quebra', async () => {
        render(<VenueList initialItemId="9999" />);
        await waitFor(() => {
            expect(screen.getByText('Salão Imperial')).toBeInTheDocument();
        });
        expect(screen.queryByText('Visão Geral')).not.toBeInTheDocument();
    });

    it('exibe bloco de cliente quando fkSoc está preenchido', async () => {
        render(<VenueList initialItemId="10" />);
        await waitFor(() => {
            expect(screen.queryByText('Cliente / Empresa')).not.toBeNull();
        });
        await waitFor(() => {
            expect(screen.getByText('Empresa Parceira SA')).toBeInTheDocument();
        });
    });

    it('não renderiza bloco de cliente quando fkSoc é nulo/vazio', async () => {
        render(<VenueList initialItemId="20" />);
        await waitFor(() => {
            expect(screen.getByText('Terraço Moderno')).toBeInTheDocument();
        });
        expect(screen.queryByText('Cliente / Empresa')).not.toBeInTheDocument();
    });

    it('serviços inclusos não renderizam a string "Serviço #"', async () => {
        render(<VenueList initialItemId="10" />);
        await waitFor(() => {
            expect(screen.getAllByText('Salão Imperial').length).toBeGreaterThan(0);
        });
        expect(screen.queryByText(/Serviço #/)).not.toBeInTheDocument();
    });

    // --- CRUD: botão "Novo espaço" ---

    it('renderiza o botão "Novo espaço" na lista', async () => {
        render(<VenueList />);
        await waitFor(() => expect(screen.getByText('Salão Imperial')).toBeInTheDocument());
        expect(screen.getByTestId('btn-novo-espaco')).toBeInTheDocument();
    });

    it('clique em "Novo espaço" abre o formulário (Modal)', async () => {
        render(<VenueList />);
        await waitFor(() => expect(screen.getByText('Salão Imperial')).toBeInTheDocument());

        fireEvent.click(screen.getByTestId('btn-novo-espaco'));

        await waitFor(() => {
            expect(screen.getByText('Novo Espaço')).toBeInTheDocument();
            expect(screen.getByTestId('venue-input-nome')).toBeInTheDocument();
        });
    });

    // --- CRUD: validação de nome obrigatório ---

    it('exibe erro quando formulário é submetido sem nome', async () => {
        render(<VenueList />);
        await waitFor(() => expect(screen.getByText('Salão Imperial')).toBeInTheDocument());

        fireEvent.click(screen.getByTestId('btn-novo-espaco'));
        await waitFor(() => expect(screen.getByTestId('venue-form-submit')).toBeInTheDocument());

        fireEvent.click(screen.getByTestId('venue-form-submit'));

        await waitFor(() => {
            expect(screen.getByText('Nome do espaço é obrigatório')).toBeInTheDocument();
        });
        expect(venuesApi.createVenue).not.toHaveBeenCalled();
    });

    // --- CRUD: criar espaço ---

    it('preencher e submeter formulário chama createVenue e atualiza a lista', async () => {
        render(<VenueList />);
        await waitFor(() => expect(screen.getByText('Salão Imperial')).toBeInTheDocument());

        fireEvent.click(screen.getByTestId('btn-novo-espaco'));
        await waitFor(() => expect(screen.getByTestId('venue-input-nome')).toBeInTheDocument());

        fireEvent.change(screen.getByTestId('venue-input-nome'), { target: { value: 'Novo Espaço Teste' } });
        fireEvent.click(screen.getByTestId('venue-form-submit'));

        await waitFor(() => {
            expect(venuesApi.createVenue).toHaveBeenCalledTimes(1);
        });
        // The list should reload (fetchList called again after create)
        await waitFor(() => {
            expect(coreApi.fetchList).toHaveBeenCalledTimes(2);
        });
    });

    // --- CRUD: editar espaço ---

    it('abre formulário pré-preenchido ao clicar em Editar', async () => {
        render(<VenueList />);
        await waitFor(() => expect(screen.getByText('Salão Imperial')).toBeInTheDocument());

        // Select venue by clicking the card title
        fireEvent.click(screen.getByText('Salão Imperial'));

        // Wait for the detail Editar button to appear
        await waitFor(() => expect(screen.getByTestId('btn-editar-espaco')).toBeInTheDocument());

        fireEvent.click(screen.getByTestId('btn-editar-espaco'));

        await waitFor(() => {
            expect(screen.getByText('Editar Espaço')).toBeInTheDocument();
            const input = screen.getByTestId('venue-input-nome') as HTMLInputElement;
            expect(input.value).toBe('Salão Imperial');
        });
    });

    it('submeter edição chama updateVenue e recarrega a lista', async () => {
        render(<VenueList />);
        await waitFor(() => expect(screen.getByText('Salão Imperial')).toBeInTheDocument());

        fireEvent.click(screen.getByText('Salão Imperial'));
        await waitFor(() => expect(screen.getByTestId('btn-editar-espaco')).toBeInTheDocument());

        fireEvent.click(screen.getByTestId('btn-editar-espaco'));
        await waitFor(() => expect(screen.getByTestId('venue-form-submit')).toBeInTheDocument());

        fireEvent.click(screen.getByTestId('venue-form-submit'));

        await waitFor(() => {
            expect(venuesApi.updateVenue).toHaveBeenCalledTimes(1);
        });
        await waitFor(() => {
            expect(coreApi.fetchList).toHaveBeenCalledTimes(2);
        });
    });

    // --- CRUD: excluir espaço ---

    it('clique em Excluir abre o modal de confirmação', async () => {
        render(<VenueList />);
        await waitFor(() => expect(screen.getByText('Salão Imperial')).toBeInTheDocument());

        fireEvent.click(screen.getByText('Salão Imperial'));
        await waitFor(() => expect(screen.getByTestId('btn-excluir-espaco')).toBeInTheDocument());

        fireEvent.click(screen.getByTestId('btn-excluir-espaco'));

        await waitFor(() => {
            expect(screen.getByText('Excluir Espaço')).toBeInTheDocument();
        });
    });

    it('confirmar exclusão chama deleteVenue e fecha o detalhe', async () => {
        render(<VenueList />);
        await waitFor(() => expect(screen.getByText('Salão Imperial')).toBeInTheDocument());

        fireEvent.click(screen.getByText('Salão Imperial'));
        await waitFor(() => expect(screen.getByTestId('btn-excluir-espaco')).toBeInTheDocument());

        fireEvent.click(screen.getByTestId('btn-excluir-espaco'));
        await waitFor(() => expect(screen.getByText('Excluir Espaço')).toBeInTheDocument());

        // The confirm button in ConfirmModal has the text "Excluir"
        // There may be multiple, pick the last one (modal footer)
        const confirmBtns = screen.getAllByText('Excluir');
        fireEvent.click(confirmBtns[confirmBtns.length - 1]);

        await waitFor(() => {
            expect(venuesApi.deleteVenue).toHaveBeenCalledTimes(1);
        });
        await waitFor(() => {
            expect(coreApi.fetchList).toHaveBeenCalledTimes(2);
        });
    });

    // --- Estado de erro ---

    it('exibe mensagem de erro quando createVenue falha', async () => {
        vi.mocked(venuesApi.createVenue).mockRejectedValueOnce(new Error('Falha de rede'));

        render(<VenueList />);
        await waitFor(() => expect(screen.getByText('Salão Imperial')).toBeInTheDocument());

        fireEvent.click(screen.getByTestId('btn-novo-espaco'));
        await waitFor(() => expect(screen.getByTestId('venue-input-nome')).toBeInTheDocument());

        fireEvent.change(screen.getByTestId('venue-input-nome'), { target: { value: 'Espaço Com Erro' } });
        fireEvent.click(screen.getByTestId('venue-form-submit'));

        await waitFor(() => {
            expect(screen.getByRole('alert')).toBeInTheDocument();
            expect(screen.getByText('Falha de rede')).toBeInTheDocument();
        });
    });
});
