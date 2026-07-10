import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('child_process', () => ({ exec: vi.fn(), execFile: vi.fn() }));

import { exec, execFile } from 'child_process';
import { getFreeDiskBytes, formatGB } from '../../utils/diskSpace';

const GB = 1024 * 1024 * 1024;

describe('diskSpace — getFreeDiskBytes + formatGB', () => {
    const origPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
    const win = () => Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    const nix = () => Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });

    beforeEach(() => { vi.clearAllMocks(); });
    afterEach(() => {
        if (origPlatform) Object.defineProperty(process, 'platform', origPlatform);
    });

    it('Windows: parseia bytes livres do Get-PSDrive', async () => {
        win();
        vi.mocked(exec).mockImplementation((_cmd: string, _opts: any, cb: any) => {
            if (typeof _opts === 'function') cb = _opts;
            setImmediate(() => cb(null, { stdout: '5368709120\n', stderr: '' }));
            return undefined as any;
        });
        const bytes = await getFreeDiskBytes('C:\\Projetos\\repo');
        expect(bytes).toBe(5 * GB); // 5368709120 = 5 GiB
        expect(vi.mocked(exec)).toHaveBeenCalled();
    });

    it('Unix: parseia a 4ª coluna (blocos de 1K) de df -kP', async () => {
        nix();
        vi.mocked(execFile).mockImplementation((_file: string, _args: any, _opts: any, cb: any) => {
            if (typeof _opts === 'function') cb = _opts;
            // Filesystem 1024-blocks Used Available Capacity Mounted-on; Available = 4ª coluna
            setImmediate(() => cb(null, { stdout: 'Filesystem  1024-blocks    Used Available Capacity Mounted on\n/dev/sda1   100000000  90000000  1000000      90%    /\n', stderr: '' }));
            return undefined as any;
        });
        const bytes = await getFreeDiskBytes('/var/repo');
        expect(bytes).toBe(1000000 * 1024); // 1.000.000 blocos de 1K
    });

    it('retorna null quando o comando falha (best-effort, não lança)', async () => {
        win();
        vi.mocked(exec).mockImplementation((_cmd: string, _opts: any, cb: any) => {
            if (typeof _opts === 'function') cb = _opts;
            setImmediate(() => cb(new Error('powershell ausente')));
            return undefined as any;
        });
        const bytes = await getFreeDiskBytes('C:\\repo');
        expect(bytes).toBeNull();
    });

    it('retorna null quando a saída não contém número', async () => {
        win();
        vi.mocked(exec).mockImplementation((_cmd: string, _opts: any, cb: any) => {
            if (typeof _opts === 'function') cb = _opts;
            setImmediate(() => cb(null, { stdout: 'sem número aqui', stderr: '' }));
            return undefined as any;
        });
        expect(await getFreeDiskBytes('C:\\repo')).toBeNull();
    });

    it('ignora path sem drive letter no Windows (retorna null)', async () => {
        win();
        expect(await getFreeDiskBytes('\\\\unc\\share')).toBeNull();
        expect(vi.mocked(exec)).not.toHaveBeenCalled();
    });

    it('formatGB formata bytes em GB com 2 casas', () => {
        expect(formatGB(0)).toBe('0.00');
        expect(formatGB(GB)).toBe('1.00');
        expect(formatGB(2.5 * GB)).toBe('2.50');
        expect(formatGB(3 * GB)).toBe('3.00');
    });
});
