import { describe, it, expect, vi, beforeEach } from 'vitest';

// Deps pesadas do sessionService — mockadas p/ não subir puppeteer/whatsapp-web.js.
vi.mock('whatsapp-web.js', () => ({ Client: vi.fn(), LocalAuth: vi.fn(), MessageMedia: vi.fn() }));
vi.mock('qrcode', () => ({ toDataURL: vi.fn(async () => 'data:'), toString: vi.fn(async () => '') }));
vi.mock('../../services/socketService', () => ({ socketService: { emit: vi.fn() } }));
vi.mock('../../services/botService', () => ({ botService: { processMessage: vi.fn() } }));
vi.mock('../../utils/processTree', () => ({ killChromesByProfile: vi.fn(async () => {}) }));

import * as fs from 'fs';
import { sessionService } from '../../services/legacy/sessionService';

const svc = sessionService as any;

describe('sessionService — auto-recover (#wa-autorecover)', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        svc.sessionStatus = new Map();
        svc.initializationLocks = new Map();
        svc.loggedOut = new Set();
        // pastas de auth persistidas em disco:
        vi.spyOn(fs, 'existsSync').mockReturnValue(true as any);
        vi.spyOn(fs, 'readdirSync').mockReturnValue([
            { name: 'session-A', isDirectory: () => true },
            { name: 'session-B', isDirectory: () => true },
            { name: 'session-C', isDirectory: () => true },
            { name: 'session-D', isDirectory: () => true },
            { name: 'not-a-session', isDirectory: () => true },
        ] as any);
    });

    it('recupera só a sessão STOPPED que NÃO foi deslogada nem está iniciando', () => {
        svc.sessionStatus.set('A', 'STOPPED');   // deve recuperar
        svc.sessionStatus.set('B', 'WORKING');   // não (conectada)
        svc.sessionStatus.set('C', 'STOPPED');   // não (logout deliberado)
        svc.loggedOut.add('C');
        svc.sessionStatus.set('D', 'STOPPED');   // não (já iniciando)
        svc.initializationLocks.set('D', true);

        const start = vi.spyOn(svc, 'startSession').mockResolvedValue({ status: 'STARTING' } as any);
        svc.recoverStoppedSessions();

        expect(start).toHaveBeenCalledTimes(1);
        expect(start).toHaveBeenCalledWith('A');
    });

    it('logout deliberado marca loggedOut; um start manual limpa a marca', async () => {
        // simula o ramo de LOGOUT do handler 'disconnected' (add) e o start (delete)
        svc.loggedOut.add('A');
        expect(svc.loggedOut.has('A')).toBe(true);

        vi.spyOn(svc, 'getStatus').mockReturnValue('STOPPED');
        // startSession real limpa loggedOut no topo; mockamos o resto p/ não subir client
        svc.clients = new Map();
        svc.sessionStartTimes = new Map();
        // chama só a parte de topo relevante: loggedOut.delete acontece antes do lock
        svc.initializationLocks.set('A', true); // faz retornar cedo (STARTING), mas após o delete
        await svc.startSession('A');
        expect(svc.loggedOut.has('A')).toBe(false);
    });
});
