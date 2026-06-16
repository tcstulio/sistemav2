import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../utils/logger', () => ({
    logger: {
        child: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }),
    },
}));

vi.mock('../services/api/core', () => ({
    request: vi.fn(),
    getHeaders: vi.fn(() => ({ DOLAPIKEY: 'k', 'Content-Type': 'application/json', Accept: 'application/json' })),
    sanitizeUrl: vi.fn(() => ''),
    fetchList: vi.fn(),
    fetchPage: vi.fn(),
}));

import { cloneProposal, mapProposalLineForClone } from '../services/api/commercial';
import * as core from '../services/api/core';

const requestMock = vi.mocked(core.request);
const config = { apiUrl: '', apiKey: 'test' } as any;

describe('mapProposalLineForClone', () => {
    it('preserves desc, qty, subprice, remise_percent, tva_tx and fk_product', () => {
        const mapped = mapProposalLineForClone({
            rowid: '99',
            fk_product: '7',
            desc: 'Serviço X',
            qty: '3',
            subprice: '150.5',
            remise_percent: '10',
            tva_tx: '23',
        });

        expect(mapped).toEqual({
            fk_product: '7',
            desc: 'Serviço X',
            qty: 3,
            subprice: 150.5,
            remise_percent: 10,
            tva_tx: 23,
        });
    });

    it('falls back to description when desc is missing and defaults discount/vat to 0', () => {
        const mapped = mapProposalLineForClone({
            fk_product: '5',
            description: 'Serviço Y',
            qty: '2',
            subprice: '40',
        });

        expect(mapped.desc).toBe('Serviço Y');
        expect(mapped.qty).toBe(2);
        expect(mapped.subprice).toBe(40);
        expect(mapped.remise_percent).toBe(0);
        expect(mapped.tva_tx).toBe(0);
    });

    it('does NOT map status/validation/payment/identity fields', () => {
        const mapped = mapProposalLineForClone({
            rowid: '1',
            product_type: '9',
            status: '1',
            fk_parent_line: '2',
            special_code: '1',
            info_bits: 0,
            date_start: '123',
            date_end: '456',
            rang: '1',
            fk_product: '5',
            desc: 'd',
            qty: '2',
            subprice: '10',
            remise_percent: '0',
            tva_tx: '0',
        });

        expect(mapped).not.toHaveProperty('rowid');
        expect(mapped).not.toHaveProperty('status');
        expect(mapped).not.toHaveProperty('product_type');
        expect(mapped).not.toHaveProperty('fk_parent_line');
        expect(mapped).not.toHaveProperty('special_code');
        expect(mapped).not.toHaveProperty('info_bits');
        expect(mapped).not.toHaveProperty('date_start');
        expect(mapped).not.toHaveProperty('date_end');
        expect(mapped).not.toHaveProperty('rang');
    });
});

describe('cloneProposal', () => {
    beforeEach(() => {
        requestMock.mockReset();
    });

    it('creates a draft clone preserving socid and lines, with date = today (not original)', async () => {
        const sourceProposal = {
            id: '100',
            socid: '42',
            date: '1577836800',
            cond_reglement: '1',
            mode_reglement: '2',
            statut: '1',
            lines: [
                { rowid: '1', fk_product: '5', desc: 'Item A', qty: '2', subprice: '10', remise_percent: '5', tva_tx: '23', status: '1' },
            ],
        };

        requestMock
            .mockResolvedValueOnce(sourceProposal)
            .mockResolvedValueOnce({ id: '200' })
            .mockResolvedValueOnce({ id: '300' });

        const newId = await cloneProposal(config, '100');

        expect(newId).toBe('200');
        expect(requestMock).toHaveBeenCalledTimes(3);

        const createBody = JSON.parse(String(requestMock.mock.calls[1]![1]!.body));
        expect(createBody.socid).toBe('42');
        expect(createBody.date).toBe(new Date().toISOString().slice(0, 10));
        expect(createBody.date).not.toBe('1577836800');
        expect(createBody.cond_reglement).toBe('1');
        expect(createBody.mode_reglement).toBe('2');
        expect(createBody.statut).toBeUndefined();
        expect(createBody.lines).toBeUndefined();

        const lineBody = JSON.parse(String(requestMock.mock.calls[2]![1]!.body));
        expect(lineBody).toEqual({
            fk_product: '5',
            desc: 'Item A',
            qty: 2,
            subprice: 10,
            remise_percent: 5,
            tva_tx: 23,
        });
        expect(lineBody.rowid).toBeUndefined();
        expect(lineBody.status).toBeUndefined();
    });

    it('creates the proposal even when there are no lines', async () => {
        requestMock
            .mockResolvedValueOnce({ id: '100', socid: '42', date: '1' })
            .mockResolvedValueOnce({ id: '200' });

        const newId = await cloneProposal(config, '100');

        expect(newId).toBe('200');
        expect(requestMock).toHaveBeenCalledTimes(2);
    });
});
