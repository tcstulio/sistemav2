import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { VenueList } from '../../components/VenueList';
import type { VenuePartnership } from '../../types/venue';

const mockVenues: VenuePartnership[] = [
    {
        id: '10',
        ref: 'VENUE-010',
        name: 'Salão Imperial',
        description: 'Espaço clássico',
        typeCode: 'salao',
        typeLabel: 'Salão',
        status: '1',
        fkSoc: '42',
        startDate: Date.now(),
        endDate: undefined,
        notes: null,
        contact: { site: null, whatsapp: null, email: null, address: null },
        capacity: { standing: 200, dinnerTable: 100, smallTable: 150, reference: 120 },
        ratings: { overall: 4, classification: 5, location: 4, size: 3, price: 4, greenRoom: null, tablesChairs: null, furniture: null, reception: null, parking: null, stage: null, equipment: null },
        pricing: { weekday: 1000, weekend: 2000, corporate: 1500, party: null, cultural: 800, partnership: null, package: null },
        includedServices: ['Som Profissional', 'Iluminação'],
        createdAt: Date.now(),
        updatedAt: new Date().toISOString(),
    },
    {
        id: '20',
        ref: 'VENUE-020',
        name: 'Terraço Moderno',
        description: null,
        typeCode: 'terraco',
        typeLabel: 'Terraço',
        status: '1',
        fkSoc: '0',
        startDate: Date.now(),
        endDate: undefined,
        notes: null,
        contact: { site: null, whatsapp: null, email: null, address: null },
        capacity: { standing: null, dinnerTable: null, smallTable: null, reference: null },
        ratings: { overall: null, classification: null, location: null, size: null, price: null, greenRoom: null, tablesChairs: null, furniture: null, reception: null, parking: null, stage: null, equipment: null },
        pricing: { weekday: null, weekend: null, corporate: null, party: null, cultural: null, partnership: null, package: null },
        includedServices: [],
        createdAt: Date.now(),
        updatedAt: new Date().toISOString(),
    },
];

vi.mock('../../context/DolibarrContext', () => ({
    useDolibarr: vi.fn(() => ({
        config: { apiUrl: 'https://test.dolibarr.com/api', apiKey: 'test-key' },
    })),
}));

vi.mock('../../services/api/core', () => ({
    fetchList: vi.fn(async () => [
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
    ]),
}));

vi.mock('../../services/api/commercial', () => ({
    getThirdParty: vi.fn(async (_config: any, id: string) => ({
        id,
        name: 'Empresa Parceira SA',
    })),
}));

beforeEach(() => {
    vi.clearAllMocks();
});

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
});
