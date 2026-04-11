import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import { atomicWriteSync } from '../../utils/atomicWrite';

vi.mock('fs');

describe('atomicWriteSync', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('writes JSON data to .tmp file then renames to target', () => {
        atomicWriteSync('/data/test.json', { key: 'value' });

        expect(fs.writeFileSync).toHaveBeenCalledWith(
            '/data/test.json.tmp',
            JSON.stringify({ key: 'value' }, null, 2)
        );
        expect(fs.renameSync).toHaveBeenCalledWith(
            '/data/test.json.tmp',
            '/data/test.json'
        );
    });

    it('handles object data', () => {
        atomicWriteSync('/tmp/file.json', { a: 1, b: [2, 3] });

        expect(fs.writeFileSync).toHaveBeenCalledWith(
            '/tmp/file.json.tmp',
            JSON.stringify({ a: 1, b: [2, 3] }, null, 2)
        );
    });

    it('handles array data', () => {
        atomicWriteSync('/tmp/arr.json', [1, 2, 3]);

        expect(fs.writeFileSync).toHaveBeenCalledWith(
            '/tmp/arr.json.tmp',
            JSON.stringify([1, 2, 3], null, 2)
        );
    });

    it('handles string data', () => {
        atomicWriteSync('/tmp/str.json', 'hello');

        expect(fs.writeFileSync).toHaveBeenCalledWith(
            '/tmp/str.json.tmp',
            JSON.stringify('hello', null, 2)
        );
    });

    it('handles number data', () => {
        atomicWriteSync('/tmp/num.json', 42);

        expect(fs.writeFileSync).toHaveBeenCalledWith(
            '/tmp/num.json.tmp',
            JSON.stringify(42, null, 2)
        );
    });

    it('calls writeFileSync before renameSync', () => {
        const order: string[] = [];
        vi.mocked(fs.writeFileSync).mockImplementation(() => { order.push('write'); });
        vi.mocked(fs.renameSync).mockImplementation(() => { order.push('rename'); });

        atomicWriteSync('/tmp/order.json', {});

        expect(order).toEqual(['write', 'rename']);
    });
});
