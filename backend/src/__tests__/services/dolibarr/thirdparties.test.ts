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

import { DolibarrThirdPartiesService } from '../../../services/dolibarr/thirdparties';

describe('DolibarrThirdPartiesService', () => {
    let service: DolibarrThirdPartiesService;

    beforeEach(() => {
        vi.clearAllMocks();
        service = new DolibarrThirdPartiesService();
    });

    describe('createThirdParty', () => {
        it('calls requestWithAuth with POST', async () => {
            mockAxios.mockResolvedValue({ data: 1 });
            const result = await service.createThirdParty({ name: 'Test' } as any, 'user-key');
            expect(result).toBe(1);
        });

        it('usa apiKey do sistema quando sem userKey (fallback #347)', async () => {
            mockAxios.mockResolvedValue({ data: 1 });
            await service.createThirdParty({ name: 'Test' } as any);
            expect(mockAxios.mock.calls[0][0].headers.DOLAPIKEY).toBe('test-api-key-1234567890');
        });
    });

    describe('getThirdPartyByPhone', () => {
        it('returns matching third party', async () => {
            const thirdParty = { id: 1, name: 'John' };
            mockAxios.get.mockResolvedValue({ status: 200, data: [thirdParty] });
            const result = await service.getThirdPartyByPhone('(11) 99999-1234');
            expect(result).toEqual(thirdParty);
        });

        it('strips non-digit characters from phone', async () => {
            mockAxios.get.mockResolvedValue({ status: 200, data: [] });
            await service.getThirdPartyByPhone('(11) 99999-1234');
            const params = mockAxios.get.mock.calls[0][1].params;
            expect(params.sqlfilters).toContain('99991234');
        });

        it('uses last 8 digits for long phone numbers', async () => {
            mockAxios.get.mockResolvedValue({ status: 200, data: [] });
            await service.getThirdPartyByPhone('55119999912345');
            const params = mockAxios.get.mock.calls[0][1].params;
            expect(params.sqlfilters).toContain('9912345');
        });

        it('returns null when no match found (404)', async () => {
            mockAxios.get.mockResolvedValue({ status: 404, data: null });
            const result = await service.getThirdPartyByPhone('12345678');
            expect(result).toBeNull();
        });

        it('returns null when response is empty array', async () => {
            mockAxios.get.mockResolvedValue({ status: 200, data: [] });
            const result = await service.getThirdPartyByPhone('12345678');
            expect(result).toBeNull();
        });

        it('returns null on error', async () => {
            mockAxios.get.mockRejectedValue(new Error('fail'));
            const result = await service.getThirdPartyByPhone('12345678');
            expect(result).toBeNull();
        });
    });

    describe('getThirdParty', () => {
        it('returns third party data when found', async () => {
            const tp = { id: 1, name: 'Test Corp' };
            mockAxios.get.mockResolvedValue({ status: 200, data: tp });
            const result = await service.getThirdParty('1');
            expect(result).toEqual(tp);
        });

        it('returns null when not found', async () => {
            mockAxios.get.mockResolvedValue({ status: 404, data: null });
            const result = await service.getThirdParty('999');
            expect(result).toBeNull();
        });

        it('returns null on error', async () => {
            mockAxios.get.mockRejectedValue(new Error('fail'));
            const result = await service.getThirdParty('1');
            expect(result).toBeNull();
        });
    });

    describe('searchThirdParty', () => {
        it('returns search results', async () => {
            const results = [{ id: 1 }, { id: 2 }];
            mockAxios.get.mockResolvedValue({ status: 200, data: results });
            const result = await service.searchThirdParty('test');
            expect(result).toEqual(results);
        });

        it('returns empty array when response is not array', async () => {
            mockAxios.get.mockResolvedValue({ status: 200, data: null });
            const result = await service.searchThirdParty('test');
            expect(result).toEqual([]);
        });

        // #1350: erro-mascarado — antes devolvia [] em 5xx/timeout/rede e o agente afirmava
        // "cliente não cadastrado". Agora propaga para que o caller saiba que falhou.
        it('propaga erros de rede/timeout (NÃO devolve [] silencioso) (#1350)', async () => {
            mockAxios.get.mockRejectedValue(new Error('Network Error'));
            await expect(service.searchThirdParty('test')).rejects.toThrow('Network Error');
        });

        it('propaga erro 5xx do Dolibarr (não confunde com "não existe") (#1350)', async () => {
            const axiosErr = Object.assign(new Error('Request failed with status code 500'), {
                isAxiosError: true,
                response: { status: 500, data: { error: { message: 'DB down' } } },
            });
            mockAxios.get.mockRejectedValue(axiosErr);
            await expect(service.searchThirdParty('test')).rejects.toBeDefined();
        });

        it('retorna [] em 404 — termo inexistente é caso legítimo, não erro (#1350)', async () => {
            mockAxios.get.mockResolvedValue({ status: 404, data: null });
            const result = await service.searchThirdParty('termo-inexistente');
            expect(result).toEqual([]);
        });

        it('aceita 200/404 em validateStatus e rejeita 5xx/401/403 (#1350)', async () => {
            mockAxios.get.mockResolvedValue({ status: 200, data: [] });
            await service.searchThirdParty('test');
            const cfg = mockAxios.get.mock.calls[0][1];
            expect(cfg.validateStatus(200)).toBe(true);
            expect(cfg.validateStatus(404)).toBe(true);
            expect(cfg.validateStatus(500)).toBe(false);
            expect(cfg.validateStatus(401)).toBe(false);
            expect(cfg.validateStatus(403)).toBe(false);
        });
    });

    describe('getCustomerContext', () => {
        it('returns default message when no thirdPartyId', async () => {
            const result = await service.getCustomerContext('');
            expect(result).toBe('Dados do cliente não identificados.');
        });

        it('builds context with invoices, projects, and events', async () => {
            mockAxios.get.mockImplementation((url: string) => {
                if (url.includes('invoices')) {
                    return Promise.resolve({
                        status: 200,
                        data: [{ ref: 'INV001', total_ttc: 100.5, date: 1700000000 }],
                    });
                }
                if (url.includes('projects')) {
                    return Promise.resolve({
                        status: 200,
                        data: [{ ref: 'PRJ1', title: 'My Project', statut: 1 }],
                    });
                }
                if (url.includes('agenda')) {
                    return Promise.resolve({
                        status: 200,
                        data: [{ datep: 1700000000, label: 'Meeting', type_code: 'AC_RDV' }],
                    });
                }
                return Promise.resolve({ status: 200, data: [] });
            });

            const result = await service.getCustomerContext('123');
            expect(result).toContain('CLIENTE ID: 123');
            expect(result).toContain('FATURAS EM ABERTO');
            expect(result).toContain('INV001');
            expect(result).toContain('PROJETOS RECENTES');
            expect(result).toContain('PRJ1');
            expect(result).toContain('PRÓXIMOS EVENTOS');
            expect(result).toContain('Meeting');
        });

        it('handles empty data sections', async () => {
            mockAxios.get.mockResolvedValue({ status: 200, data: [] });
            const result = await service.getCustomerContext('123');
            expect(result).toContain('Nenhuma fatura pendente');
            expect(result).toContain('Nenhum projeto recente');
            expect(result).toContain('Nenhum evento na agenda');
        });

        it('handles non-200 status for data sections', async () => {
            mockAxios.get.mockResolvedValue({ status: 404, data: [] });
            const result = await service.getCustomerContext('123');
            expect(result).toContain('Nenhuma fatura pendente');
        });

        it('handles closed project status', async () => {
            mockAxios.get.mockImplementation((url: string) => {
                if (url.includes('projects')) {
                    return Promise.resolve({
                        status: 200,
                        data: [{ ref: 'PRJ1', title: 'Closed', statut: 0 }],
                    });
                }
                return Promise.resolve({ status: 200, data: [] });
            });
            const result = await service.getCustomerContext('123');
            expect(result).toContain('Fechado');
        });

        it('handles events without datep', async () => {
            mockAxios.get.mockImplementation((url: string) => {
                if (url.includes('agenda')) {
                    return Promise.resolve({
                        status: 200,
                        data: [{ label: 'No Date Event', type_code: null }],
                    });
                }
                return Promise.resolve({ status: 200, data: [] });
            });
            const result = await service.getCustomerContext('123');
            expect(result).toContain('N/A');
        });

        it('handles invoice with missing total_ttc', async () => {
            mockAxios.get.mockImplementation((url: string) => {
                if (url.includes('invoices')) {
                    return Promise.resolve({
                        status: 200,
                        data: [{ ref: 'INV002', date: 1700000000 }],
                    });
                }
                return Promise.resolve({ status: 200, data: [] });
            });
            const result = await service.getCustomerContext('123');
            expect(result).toContain('R$ 0.00');
        });

        it('returns error message on exception', async () => {
            mockAxios.get.mockRejectedValue(new Error('fail'));
            const result = await service.getCustomerContext('123');
            expect(result).toBe('Erro ao buscar dados detalhados do cliente no CRM.');
        });
    });

    describe('listSuppliers', () => {
        it('returns suppliers list', async () => {
            const suppliers = [{ id: 1 }];
            mockAxios.get.mockResolvedValue({ status: 200, data: suppliers });
            const result = await service.listSuppliers();
            expect(result).toEqual(suppliers);
        });

        it('applies search filter', async () => {
            mockAxios.get.mockResolvedValue({ status: 200, data: [] });
            await service.listSuppliers('test');
            const params = mockAxios.get.mock.calls[0][1].params;
            expect(params.sqlfilters).toContain('t.nom');
        });

        it('returns empty array when response is not array', async () => {
            mockAxios.get.mockResolvedValue({ status: 200, data: null });
            const result = await service.listSuppliers();
            expect(result).toEqual([]);
        });

        // #1350: listSuppliers alimenta prepare_create_supplier_invoice/proposal; erro de API
        // não pode virar "fornecedor não existe" (risco de duplicata).
        it('propaga erros de rede/timeout (NÃO devolve [] silencioso) (#1350)', async () => {
            mockAxios.get.mockRejectedValue(new Error('Network Error'));
            await expect(service.listSuppliers()).rejects.toThrow('Network Error');
        });

        it('propaga erro 5xx do Dolibarr (#1350)', async () => {
            const axiosErr = Object.assign(new Error('Request failed with status code 500'), {
                isAxiosError: true,
                response: { status: 500, data: { error: { message: 'DB down' } } },
            });
            mockAxios.get.mockRejectedValue(axiosErr);
            await expect(service.listSuppliers()).rejects.toBeDefined();
        });

        it('retorna [] em 404 — sem fornecedores para o filtro é caso legítimo (#1350)', async () => {
            mockAxios.get.mockResolvedValue({ status: 404, data: null });
            const result = await service.listSuppliers('nao-existe');
            expect(result).toEqual([]);
        });

        it('aceita 200/404 em validateStatus e rejeita 5xx/401/403 (#1350)', async () => {
            mockAxios.get.mockResolvedValue({ status: 200, data: [] });
            await service.listSuppliers();
            const cfg = mockAxios.get.mock.calls[0][1];
            expect(cfg.validateStatus(200)).toBe(true);
            expect(cfg.validateStatus(404)).toBe(true);
            expect(cfg.validateStatus(500)).toBe(false);
            expect(cfg.validateStatus(401)).toBe(false);
            expect(cfg.validateStatus(403)).toBe(false);
        });
    });

    describe('listContacts', () => {
        it('returns contacts list without search', async () => {
            const contacts = [{ id: 1 }];
            mockAxios.get.mockResolvedValue({ status: 200, data: contacts });
            const result = await service.listContacts();
            expect(result).toEqual(contacts);
            const params = mockAxios.get.mock.calls[0][1].params;
            expect(params.sqlfilters).toBeUndefined();
        });

        it('applies search filter', async () => {
            mockAxios.get.mockResolvedValue({ status: 200, data: [] });
            await service.listContacts('john');
            const params = mockAxios.get.mock.calls[0][1].params;
            expect(params.sqlfilters).toContain('t.firstname');
            expect(params.sqlfilters).toContain('t.lastname');
            expect(params.sqlfilters).toContain('t.email');
        });

        // #1350: erro-mascarado — propaga em vez de devolver [] silencioso.
        it('propaga erros de rede/timeout (NÃO devolve [] silencioso) (#1350)', async () => {
            mockAxios.get.mockRejectedValue(new Error('Network Error'));
            await expect(service.listContacts()).rejects.toThrow('Network Error');
        });

        it('propaga erro 5xx do Dolibarr (#1350)', async () => {
            const axiosErr = Object.assign(new Error('Request failed with status code 500'), {
                isAxiosError: true,
                response: { status: 500, data: { error: { message: 'DB down' } } },
            });
            mockAxios.get.mockRejectedValue(axiosErr);
            await expect(service.listContacts()).rejects.toBeDefined();
        });

        it('retorna [] em 404 — sem contatos para o filtro é caso legítimo (#1350)', async () => {
            mockAxios.get.mockResolvedValue({ status: 404, data: null });
            const result = await service.listContacts('nao-existe');
            expect(result).toEqual([]);
        });

        it('aceita 200/404 em validateStatus e rejeita 5xx/401/403 (#1350)', async () => {
            mockAxios.get.mockResolvedValue({ status: 200, data: [] });
            await service.listContacts();
            const cfg = mockAxios.get.mock.calls[0][1];
            expect(cfg.validateStatus(200)).toBe(true);
            expect(cfg.validateStatus(404)).toBe(true);
            expect(cfg.validateStatus(500)).toBe(false);
            expect(cfg.validateStatus(401)).toBe(false);
            expect(cfg.validateStatus(403)).toBe(false);
        });
    });

    describe('listCategories', () => {
        it('returns categories list', async () => {
            const cats = [{ id: 1 }];
            mockAxios.get.mockResolvedValue({ status: 200, data: cats });
            const result = await service.listCategories();
            expect(result).toEqual(cats);
        });

        it('passes type parameter', async () => {
            mockAxios.get.mockResolvedValue({ status: 200, data: [] });
            await service.listCategories('customer');
            const params = mockAxios.get.mock.calls[0][1].params;
            expect(params.type).toBe('customer');
        });

        it('does not pass type when undefined', async () => {
            mockAxios.get.mockResolvedValue({ status: 200, data: [] });
            await service.listCategories();
            const params = mockAxios.get.mock.calls[0][1].params;
            expect(params.type).toBeUndefined();
        });

        // #1350: erro-mascarado — propaga em vez de devolver [] silencioso.
        it('propaga erros de rede/timeout (NÃO devolve [] silencioso) (#1350)', async () => {
            mockAxios.get.mockRejectedValue(new Error('Network Error'));
            await expect(service.listCategories()).rejects.toThrow('Network Error');
        });

        it('propaga erro 5xx do Dolibarr (#1350)', async () => {
            const axiosErr = Object.assign(new Error('Request failed with status code 500'), {
                isAxiosError: true,
                response: { status: 500, data: { error: { message: 'DB down' } } },
            });
            mockAxios.get.mockRejectedValue(axiosErr);
            await expect(service.listCategories()).rejects.toBeDefined();
        });

        it('retorna [] em 404 — sem categorias é caso legítimo (#1350)', async () => {
            mockAxios.get.mockResolvedValue({ status: 404, data: null });
            const result = await service.listCategories();
            expect(result).toEqual([]);
        });

        it('aceita 200/404 em validateStatus e rejeita 5xx/401/403 (#1350)', async () => {
            mockAxios.get.mockResolvedValue({ status: 200, data: [] });
            await service.listCategories();
            const cfg = mockAxios.get.mock.calls[0][1];
            expect(cfg.validateStatus(200)).toBe(true);
            expect(cfg.validateStatus(404)).toBe(true);
            expect(cfg.validateStatus(500)).toBe(false);
            expect(cfg.validateStatus(401)).toBe(false);
            expect(cfg.validateStatus(403)).toBe(false);
        });
    });
});
