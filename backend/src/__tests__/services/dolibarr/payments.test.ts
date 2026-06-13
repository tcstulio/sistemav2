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

import { DolibarrPaymentsService } from '../../../services/dolibarr/payments';

describe('DolibarrPaymentsService', () => {
    let service: DolibarrPaymentsService;

    beforeEach(() => {
        vi.clearAllMocks();
        service = new DolibarrPaymentsService();
    });

    describe('addPayment', () => {
        it('calls requestWithAuth with POST', async () => {
            mockAxios.mockResolvedValue({ data: { success: true } });
            const result = await service.addPayment('1', { amount: 100 } as any, 'user-key');
            expect(result).toEqual({ success: true });
        });

        it('usa apiKey do sistema quando sem userKey (fallback #347)', async () => {
            mockAxios.mockResolvedValue({ data: {} });
            await service.addPayment('1', {} as any);
            expect(mockAxios.mock.calls[0][0].headers.DOLAPIKEY).toBe('test-api-key-1234567890');
        });
    });

    describe('listPayments', () => {
        it('returns payments list', async () => {
            const payments = [{ id: 1 }];
            mockAxios.get.mockResolvedValue({ status: 200, data: payments });
            const result = await service.listPayments();
            expect(result).toEqual(payments);
        });

        it('uses default limit of 10', async () => {
            mockAxios.get.mockResolvedValue({ status: 200, data: [] });
            await service.listPayments();
            const params = mockAxios.get.mock.calls[0][1].params;
            expect(params.limit).toBe(10);
        });

        it('uses custom limit', async () => {
            mockAxios.get.mockResolvedValue({ status: 200, data: [] });
            await service.listPayments(25);
            const params = mockAxios.get.mock.calls[0][1].params;
            expect(params.limit).toBe(25);
        });

        it('returns empty array when response is not array', async () => {
            mockAxios.get.mockResolvedValue({ status: 200, data: null });
            const result = await service.listPayments();
            expect(result).toEqual([]);
        });

        it('returns empty array on error', async () => {
            mockAxios.get.mockRejectedValue(new Error('fail'));
            const result = await service.listPayments();
            expect(result).toEqual([]);
        });
    });

    describe('listBankAccounts', () => {
        it('returns bank accounts list', async () => {
            const accounts = [{ id: 1, label: 'Main' }];
            mockAxios.get.mockResolvedValue({ status: 200, data: accounts });
            const result = await service.listBankAccounts();
            expect(result).toEqual(accounts);
        });

        it('returns empty array when response is not array', async () => {
            mockAxios.get.mockResolvedValue({ status: 200, data: null });
            const result = await service.listBankAccounts();
            expect(result).toEqual([]);
        });

        it('returns empty array on error', async () => {
            mockAxios.get.mockRejectedValue(new Error('fail'));
            const result = await service.listBankAccounts();
            expect(result).toEqual([]);
        });
    });

    describe('listBankLines', () => {
        it('returns bank lines list', async () => {
            const lines = [{ id: 1 }];
            mockAxios.get.mockResolvedValue({ status: 200, data: lines });
            const result = await service.listBankLines('acc1');
            expect(result).toEqual(lines);
        });

        it('uses default limit of 20', async () => {
            mockAxios.get.mockResolvedValue({ status: 200, data: [] });
            await service.listBankLines('acc1');
            const params = mockAxios.get.mock.calls[0][1].params;
            expect(params.limit).toBe(20);
        });

        it('uses custom limit', async () => {
            mockAxios.get.mockResolvedValue({ status: 200, data: [] });
            await service.listBankLines('acc1', 50);
            const params = mockAxios.get.mock.calls[0][1].params;
            expect(params.limit).toBe(50);
        });

        it('returns empty array when response is not array', async () => {
            mockAxios.get.mockResolvedValue({ status: 200, data: null });
            const result = await service.listBankLines('acc1');
            expect(result).toEqual([]);
        });

        it('returns empty array on error', async () => {
            mockAxios.get.mockRejectedValue(new Error('fail'));
            const result = await service.listBankLines('acc1');
            expect(result).toEqual([]);
        });
    });
});
