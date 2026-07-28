import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';

// resolveBash é chamado no load do módulo — mock leve.
vi.mock('../../utils/runOpencode', () => ({ resolveBash: () => 'bash' }));

const spawnMock = vi.hoisted(() => vi.fn());
vi.mock('child_process', () => ({ spawn: spawnMock }));

import { claudeCliService } from '../../services/claudeCliService';

// Fake child do spawn: emite (opcional stdout +) 'close' com o código dado no próximo tick.
function fakeChild(code: number, stdout = ''): any {
    const child: any = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = vi.fn();
    setImmediate(() => {
        if (stdout) child.stdout.emit('data', Buffer.from(stdout));
        child.emit('close', code);
    });
    return child;
}

beforeEach(() => {
    vi.clearAllMocks();
});

describe('claudeCliService — retry do juiz no exit 126/127 do shim (#1449)', () => {
    // IMPORTANTE: children criados LAZY (mockImplementation) — se criados cedo (mockReturnValue),
    // o setImmediate do fakeChild emite 'close' antes de o runBash anexar o listener → trava.
    it('exit 126 na 1ª tentativa, OK na 2ª → usa o Claude (retry transparente ao chamador)', async () => {
        const okJson = JSON.stringify({ result: 'veredito do opus', is_error: false });
        spawnMock
            .mockImplementationOnce(() => fakeChild(126))
            .mockImplementationOnce(() => fakeChild(0, okJson));

        const r = await claudeCliService.runText('avalie este PR', { timeoutMs: 5000 });

        expect(r.text).toBe('veredito do opus');
        expect(r.isError).toBe(false);
        expect(spawnMock).toHaveBeenCalledTimes(2); // 1 falha 126 + 1 sucesso = retry aconteceu
    });

    it('exit 127 também é transitório (command not found do shim) → retenta', async () => {
        const okJson = JSON.stringify({ result: 'ok', is_error: false });
        spawnMock
            .mockImplementationOnce(() => fakeChild(127))
            .mockImplementationOnce(() => fakeChild(0, okJson));

        const r = await claudeCliService.runText('p', { timeoutMs: 5000 });

        expect(r.text).toBe('ok');
        expect(spawnMock).toHaveBeenCalledTimes(2);
    });

    it('exit 1 (falha REAL do modelo) NÃO retenta — propaga na hora', async () => {
        spawnMock.mockImplementation(() => fakeChild(1));

        await expect(claudeCliService.runText('p', { timeoutMs: 5000 })).rejects.toThrow(/código 1/);
        expect(spawnMock).toHaveBeenCalledTimes(1); // sem retry em erro não-transitório
    });

    it('exit 126 SEMPRE → esgota os retries e propaga (o juiz então cai no fallback MiniMax)', async () => {
        spawnMock.mockImplementation(() => fakeChild(126));

        await expect(claudeCliService.runText('p', { timeoutMs: 5000 })).rejects.toThrow(/código 126/);
        expect(spawnMock).toHaveBeenCalledTimes(3); // 1 tentativa + 2 retries
    }, 10000); // backoff 1s+2s → dar folga sobre o default de 5s
});
