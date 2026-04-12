import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAxios } = vi.hoisted(() => {
    const fn = vi.fn() as any;
    fn.get = vi.fn();
    fn.isAxiosError = vi.fn();
    return { mockAxios: fn };
});

vi.mock('axios', () => ({
    default: mockAxios,
}));

vi.mock('https', () => ({
    default: { Agent: vi.fn() },
}));

vi.mock('fs', () => ({
    default: { existsSync: vi.fn(), readFileSync: vi.fn() },
}));

vi.mock('../../../config/env', () => ({
    config: {
        dolibarrUrl: 'https://test.dolibarr.com/api/index.php/',
        dolibarrKey: 'test-api-key-1234567890',
        dolibarrBypassCookie: 'test_cookie=1',
    },
}));

import { DolibarrPartnershipsService, VenuePartnership } from '../../../services/dolibarr/partnerships';

const makeRawPartnership = (overrides: Record<string, any> = {}) => ({
    id: '1',
    ref: 'PART001',
    ref_ext: null,
    status: '1',
    fk_soc: '10',
    fk_member: null,
    fk_type: '1',
    type_code: 'VENUE',
    type_label: 'Venue',
    date_partnership_start: 1700000000,
    date_partnership_end: null,
    note_private: null,
    note_public: null,
    date_creation: 1690000000,
    tms: '2024-01-01',
    array_options: {
        options_nome_espaco: 'Test Space',
        options_site: 'https://test.com',
        options_whatsapp: '5511999999999',
        options_email: 'test@test.com',
        options_endereco: 'Rua Test 123',
        options_lotacao_em_pe: '200',
        options_lotacao_mesa_jantar: '100',
        options_lotacao_mesa_pequena: '50',
        options_quantidade_pessoas: '300',
        options_servicos_inclusos: 'som,iluminacao,catering',
        options_descreva: 'A nice venue',
        options_estrutura_geral: '4',
        options_classificacao: '5',
        options_localizacao: '3',
        options_tamanho: '4',
        options_preco: '2',
        options_camarim: '3',
        options_mesas_e_cadeiras: '4',
        options_mobiliario: '3',
        options_recepcao: '5',
        options_estacionamento: '2',
        options_estrutura_palco_e_shows: '4',
        options_equipamentos_e_infraestrutura_eventos: '3',
        options_negociacao_dia_da_semana: '1000',
        options_negociacao_final_de_semana: '2000',
        options_negociacao_corporativo: '3000',
        options_negociacao_festa: '4000',
        options_negociacao_cultural: '1500',
        options_negociacao_parceria: '1200',
        options_negociacao_pacote_datas: '5000',
    },
    ...overrides,
});

describe('DolibarrPartnershipsService', () => {
    let service: DolibarrPartnershipsService;

    beforeEach(() => {
        vi.clearAllMocks();
        service = new DolibarrPartnershipsService();
    });

    describe('listPartnerships', () => {
        it('returns transformed partnerships', async () => {
            mockAxios.get.mockResolvedValue({
                status: 200,
                data: [makeRawPartnership()],
            });
            const result = await service.listPartnerships();
            expect(result).toHaveLength(1);
            expect(result[0].id).toBe('1');
            expect(result[0].name).toBe('Test Space');
            expect(result[0].description).toBe('A nice venue');
        });

        it('returns empty array when response is not array', async () => {
            mockAxios.get.mockResolvedValue({ status: 200, data: null });
            const result = await service.listPartnerships();
            expect(result).toEqual([]);
        });

        it('applies status filter', async () => {
            mockAxios.get.mockResolvedValue({ status: 200, data: [] });
            await service.listPartnerships({ status: '1' });
            const params = mockAxios.get.mock.calls[0][1].params;
            expect(params.sqlfilters).toContain('t.status');
        });

        it('uses default limit of 100', async () => {
            mockAxios.get.mockResolvedValue({ status: 200, data: [] });
            await service.listPartnerships();
            const params = mockAxios.get.mock.calls[0][1].params;
            expect(params.limit).toBe(100);
        });

        it('uses custom limit', async () => {
            mockAxios.get.mockResolvedValue({ status: 200, data: [] });
            await service.listPartnerships({ limit: 50 });
            const params = mockAxios.get.mock.calls[0][1].params;
            expect(params.limit).toBe(50);
        });

        it('returns empty array on error', async () => {
            mockAxios.get.mockRejectedValue(new Error('fail'));
            const result = await service.listPartnerships();
            expect(result).toEqual([]);
        });
    });

    describe('getPartnership', () => {
        it('returns transformed partnership when found', async () => {
            mockAxios.get.mockResolvedValue({
                status: 200,
                data: makeRawPartnership(),
            });
            const result = await service.getPartnership('1');
            expect(result).not.toBeNull();
            expect(result!.id).toBe('1');
            expect(result!.name).toBe('Test Space');
        });

        it('returns null when not found', async () => {
            mockAxios.get.mockResolvedValue({ status: 404, data: null });
            const result = await service.getPartnership('999');
            expect(result).toBeNull();
        });

        it('returns null on error', async () => {
            mockAxios.get.mockRejectedValue(new Error('fail'));
            const result = await service.getPartnership('1');
            expect(result).toBeNull();
        });
    });

    describe('transformPartnership (via listPartnership)', () => {
        it('uses fallback name when options_nome_espaco is missing', async () => {
            const raw = makeRawPartnership();
            raw.array_options.options_nome_espaco = undefined;
            mockAxios.get.mockResolvedValue({ status: 200, data: [raw] });
            const result = await service.listPartnerships();
            expect(result[0].name).toBe('Partnership 1');
        });

        it('handles null description', async () => {
            const raw = makeRawPartnership();
            raw.array_options.options_descreva = undefined;
            mockAxios.get.mockResolvedValue({ status: 200, data: [raw] });
            const result = await service.listPartnerships();
            expect(result[0].description).toBeNull();
        });

        it('handles null numeric values for capacity', async () => {
            const raw = makeRawPartnership();
            raw.array_options.options_lotacao_em_pe = null;
            raw.array_options.options_lotacao_mesa_jantar = undefined;
            raw.array_options.options_lotacao_mesa_pequena = '';
            raw.array_options.options_quantidade_pessoas = 'notanumber';
            mockAxios.get.mockResolvedValue({ status: 200, data: [raw] });
            const result = await service.listPartnerships();
            expect(result[0].capacity.standing).toBeNull();
            expect(result[0].capacity.dinnerTable).toBeNull();
            expect(result[0].capacity.smallTable).toBeNull();
            expect(result[0].capacity.reference).toBeNull();
        });

        it('handles null numeric values for ratings', async () => {
            const raw = makeRawPartnership();
            raw.array_options.options_estrutura_geral = null;
            raw.array_options.options_classificacao = undefined;
            raw.array_options.options_localizacao = '';
            raw.array_options.options_tamanho = 'abc';
            raw.array_options.options_preco = null;
            raw.array_options.options_camarim = null;
            raw.array_options.options_mesas_e_cadeiras = null;
            raw.array_options.options_mobiliario = null;
            raw.array_options.options_recepcao = null;
            raw.array_options.options_estacionamento = null;
            raw.array_options.options_estrutura_palco_e_shows = null;
            raw.array_options.options_equipamentos_e_infraestrutura_eventos = null;
            mockAxios.get.mockResolvedValue({ status: 200, data: [raw] });
            const result = await service.listPartnerships();
            expect(result[0].ratings.overall).toBeNull();
            expect(result[0].ratings.classification).toBeNull();
            expect(result[0].ratings.location).toBeNull();
            expect(result[0].ratings.size).toBeNull();
        });

        it('handles valid numeric values for pricing', async () => {
            mockAxios.get.mockResolvedValue({
                status: 200,
                data: [makeRawPartnership()],
            });
            const result = await service.listPartnerships();
            expect(result[0].pricing.weekday).toBe(1000);
            expect(result[0].pricing.weekend).toBe(2000);
            expect(result[0].pricing.corporate).toBe(3000);
            expect(result[0].pricing.party).toBe(4000);
            expect(result[0].pricing.cultural).toBe(1500);
            expect(result[0].pricing.partnership).toBe(1200);
            expect(result[0].pricing.package).toBe(5000);
        });

        it('handles null pricing values', async () => {
            const raw = makeRawPartnership();
            raw.array_options.options_negociacao_dia_da_semana = null;
            raw.array_options.options_negociacao_final_de_semana = null;
            raw.array_options.options_negociacao_corporativo = null;
            raw.array_options.options_negociacao_festa = null;
            raw.array_options.options_negociacao_cultural = null;
            raw.array_options.options_negociacao_parceria = null;
            raw.array_options.options_negociacao_pacote_datas = null;
            mockAxios.get.mockResolvedValue({ status: 200, data: [raw] });
            const result = await service.listPartnerships();
            expect(result[0].pricing.weekday).toBeNull();
            expect(result[0].pricing.weekend).toBeNull();
            expect(result[0].pricing.corporate).toBeNull();
            expect(result[0].pricing.party).toBeNull();
            expect(result[0].pricing.cultural).toBeNull();
            expect(result[0].pricing.partnership).toBeNull();
            expect(result[0].pricing.package).toBeNull();
        });

        it('handles null contact fields', async () => {
            const raw = makeRawPartnership();
            raw.array_options.options_site = null;
            raw.array_options.options_whatsapp = null;
            raw.array_options.options_email = null;
            raw.array_options.options_endereco = null;
            mockAxios.get.mockResolvedValue({ status: 200, data: [raw] });
            const result = await service.listPartnerships();
            expect(result[0].contact.site).toBeNull();
            expect(result[0].contact.whatsapp).toBeNull();
            expect(result[0].contact.email).toBeNull();
            expect(result[0].contact.address).toBeNull();
        });

        it('parses includedServices from comma-separated string', async () => {
            mockAxios.get.mockResolvedValue({
                status: 200,
                data: [makeRawPartnership()],
            });
            const result = await service.listPartnerships();
            expect(result[0].includedServices).toEqual(['som', 'iluminacao', 'catering']);
        });

        it('returns empty includedServices when null', async () => {
            const raw = makeRawPartnership();
            raw.array_options.options_servicos_inclusos = null;
            mockAxios.get.mockResolvedValue({ status: 200, data: [raw] });
            const result = await service.listPartnerships();
            expect(result[0].includedServices).toEqual([]);
        });

        it('trims and filters empty items in includedServices', async () => {
            const raw = makeRawPartnership();
            raw.array_options.options_servicos_inclusos = '  som  ,  , catering ';
            mockAxios.get.mockResolvedValue({ status: 200, data: [raw] });
            const result = await service.listPartnerships();
            expect(result[0].includedServices).toEqual(['som', 'catering']);
        });

        it('handles missing array_options gracefully', async () => {
            const raw = makeRawPartnership();
            raw.array_options = {} as any;
            mockAxios.get.mockResolvedValue({ status: 200, data: [raw] });
            const result = await service.listPartnerships();
            expect(result[0].name).toBe('Partnership 1');
            expect(result[0].contact.site).toBeNull();
            expect(result[0].capacity.standing).toBeNull();
            expect(result[0].ratings.overall).toBeNull();
            expect(result[0].pricing.weekday).toBeNull();
            expect(result[0].includedServices).toEqual([]);
        });

        it('handles null note_private', async () => {
            const raw = makeRawPartnership();
            raw.note_private = 'Private notes';
            mockAxios.get.mockResolvedValue({ status: 200, data: [raw] });
            const result = await service.listPartnerships();
            expect(result[0].notes).toBe('Private notes');
        });
    });

    describe('searchPartnerships', () => {
        const makeVenueList = () => {
            mockAxios.get.mockResolvedValue({
                status: 200,
                data: [
                    makeRawPartnership({ id: '1', array_options: { options_nome_espaco: 'Grand Hall', options_descreva: 'Big venue for events' } }),
                    makeRawPartnership({ id: '2', array_options: { options_nome_espaco: 'Small Room', options_descreva: null, type_code: 'STUDIO' } }),
                    makeRawPartnership({ id: '3', array_options: { options_nome_espaco: 'Outdoor Stage', options_descreva: 'Open air venue', options_lotacao_em_pe: '500' } }),
                ],
            });
        };

        it('filters by search term matching name', async () => {
            makeVenueList();
            const result = await service.searchPartnerships({ search: 'grand' });
            expect(result).toHaveLength(1);
            expect(result[0].id).toBe('1');
        });

        it('filters by search term matching description', async () => {
            makeVenueList();
            const result = await service.searchPartnerships({ search: 'open air' });
            expect(result).toHaveLength(1);
            expect(result[0].id).toBe('3');
        });

        it('filters by minCapacity (standing)', async () => {
            makeVenueList();
            const result = await service.searchPartnerships({ minCapacity: 400 });
            expect(result).toHaveLength(1);
            expect(result[0].id).toBe('3');
        });

        it('filters by minCapacity (dinnerTable)', async () => {
            mockAxios.get.mockResolvedValue({
                status: 200,
                data: [
                    makeRawPartnership({ id: '1', array_options: { options_lotacao_mesa_jantar: '300' } }),
                    makeRawPartnership({ id: '2', array_options: { options_lotacao_mesa_jantar: '50' } }),
                ],
            });
            const result = await service.searchPartnerships({ minCapacity: 200 });
            expect(result).toHaveLength(1);
            expect(result[0].id).toBe('1');
        });

        it('filters by minCapacity (reference)', async () => {
            mockAxios.get.mockResolvedValue({
                status: 200,
                data: [
                    makeRawPartnership({ id: '1', array_options: { options_quantidade_pessoas: '400' } }),
                    makeRawPartnership({ id: '2', array_options: { options_quantidade_pessoas: '100' } }),
                ],
            });
            const result = await service.searchPartnerships({ minCapacity: 300 });
            expect(result).toHaveLength(1);
            expect(result[0].id).toBe('1');
        });

        it('filters by typeCode', async () => {
            mockAxios.get.mockResolvedValue({
                status: 200,
                data: [
                    makeRawPartnership({ id: '1', type_code: 'VENUE', array_options: { options_nome_espaco: 'Grand Hall' } }),
                    makeRawPartnership({ id: '2', type_code: 'STUDIO', array_options: { options_nome_espaco: 'Small Room' } }),
                    makeRawPartnership({ id: '3', type_code: 'VENUE', array_options: { options_nome_espaco: 'Outdoor Stage' } }),
                ],
            });
            const result = await service.searchPartnerships({ typeCode: 'STUDIO' });
            expect(result).toHaveLength(1);
            expect(result[0].id).toBe('2');
        });

        it('combines multiple filters', async () => {
            mockAxios.get.mockResolvedValue({
                status: 200,
                data: [
                    makeRawPartnership({ id: '1', type_code: 'VENUE', array_options: { options_nome_espaco: 'Grand Hall', options_lotacao_em_pe: '500' } }),
                    makeRawPartnership({ id: '2', type_code: 'VENUE', array_options: { options_nome_espaco: 'Small Room', options_lotacao_em_pe: '50' } }),
                    makeRawPartnership({ id: '3', type_code: 'STUDIO', array_options: { options_nome_espaco: 'Grand Studio', options_lotacao_em_pe: '600' } }),
                ],
            });
            const result = await service.searchPartnerships({ search: 'grand', minCapacity: 400, typeCode: 'VENUE' });
            expect(result).toHaveLength(1);
            expect(result[0].id).toBe('1');
        });

        it('returns empty when no matches', async () => {
            makeVenueList();
            const result = await service.searchPartnerships({ search: 'nonexistent' });
            expect(result).toEqual([]);
        });

        it('returns all when no filters', async () => {
            makeVenueList();
            const result = await service.searchPartnerships();
            expect(result).toHaveLength(3);
        });

        it('returns empty array on error', async () => {
            mockAxios.get.mockRejectedValue(new Error('fail'));
            const result = await service.searchPartnerships();
            expect(result).toEqual([]);
        });
    });

    describe('getPartnershipsByType', () => {
        it('groups partnerships by typeLabel', async () => {
            mockAxios.get.mockResolvedValue({
                status: 200,
                data: [
                    makeRawPartnership({ id: '1', type_label: 'Venue' }),
                    makeRawPartnership({ id: '2', type_label: 'Venue' }),
                    makeRawPartnership({ id: '3', type_label: 'Studio' }),
                ],
            });
            const result = await service.getPartnershipsByType();
            expect(result['Venue']).toHaveLength(2);
            expect(result['Studio']).toHaveLength(1);
        });

        it('uses "Sem Tipo" for missing typeLabel', async () => {
            const raw = makeRawPartnership();
            raw.type_label = '';
            mockAxios.get.mockResolvedValue({ status: 200, data: [raw] });
            const result = await service.getPartnershipsByType();
            expect(result['Sem Tipo']).toHaveLength(1);
        });
    });

    describe('getPricingForEventType', () => {
        it('returns pricing for weekday', () => {
            const venue: VenuePartnership = {
                id: '1', ref: 'P1', name: 'Test', description: null,
                typeCode: 'V', typeLabel: 'Venue', status: '1', fkSoc: '1',
                startDate: 0, notes: null,
                contact: { site: null, whatsapp: null, email: null, address: null },
                capacity: { standing: null, dinnerTable: null, smallTable: null, reference: null },
                ratings: { overall: null, classification: null, location: null, size: null, price: null, greenRoom: null, tablesChairs: null, furniture: null, reception: null, parking: null, stage: null, equipment: null },
                pricing: { weekday: 1000, weekend: 2000, corporate: 3000, party: 4000, cultural: 1500, partnership: 1200, package: 5000 },
                includedServices: [],
                createdAt: 0,
                updatedAt: '',
            };
            expect(service.getPricingForEventType(venue, 'weekday')).toBe(1000);
            expect(service.getPricingForEventType(venue, 'weekend')).toBe(2000);
            expect(service.getPricingForEventType(venue, 'corporate')).toBe(3000);
            expect(service.getPricingForEventType(venue, 'party')).toBe(4000);
            expect(service.getPricingForEventType(venue, 'cultural')).toBe(1500);
        });

        it('returns null for null pricing', () => {
            const venue: VenuePartnership = {
                id: '1', ref: 'P1', name: 'Test', description: null,
                typeCode: 'V', typeLabel: 'Venue', status: '1', fkSoc: '1',
                startDate: 0, notes: null,
                contact: { site: null, whatsapp: null, email: null, address: null },
                capacity: { standing: null, dinnerTable: null, smallTable: null, reference: null },
                ratings: { overall: null, classification: null, location: null, size: null, price: null, greenRoom: null, tablesChairs: null, furniture: null, reception: null, parking: null, stage: null, equipment: null },
                pricing: { weekday: null, weekend: null, corporate: null, party: null, cultural: null, partnership: null, package: null },
                includedServices: [],
                createdAt: 0,
                updatedAt: '',
            };
            expect(service.getPricingForEventType(venue, 'weekday')).toBeNull();
        });
    });
});
