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
        vi.spyOn(fs, 'existsSync').mockReturnValue(true as any);
    });

    it('recupera sessões STOPPED com pasta de auth (não WORKING nem já-iniciando)', () => {
        // Só existem pastas p/ A, B, D em disco (o discriminador é a pasta de auth).
        vi.spyOn(fs, 'readdirSync').mockReturnValue([
            { name: 'session-A', isDirectory: () => true },
            { name: 'session-B', isDirectory: () => true },
            { name: 'session-D', isDirectory: () => true },
            { name: 'not-a-session', isDirectory: () => true },
        ] as any);
        svc.sessionStatus.set('A', 'STOPPED');   // recupera
        svc.sessionStatus.set('B', 'WORKING');   // não (conectada)
        svc.sessionStatus.set('D', 'STOPPED');   // não (já iniciando)
        svc.initializationLocks.set('D', true);

        const start = vi.spyOn(svc, 'startSession').mockResolvedValue({ status: 'STARTING' } as any);
        svc.recoverStoppedSessions();

        expect(start).toHaveBeenCalledTimes(1);
        expect(start).toHaveBeenCalledWith('A');
    });

    it('NÃO ressuscita sessão cuja pasta de auth foi removida (delete do usuário)', () => {
        // C está STOPPED mas SEM pasta em disco (o usuário deu DELETE → deleteSession apagou a pasta).
        vi.spyOn(fs, 'readdirSync').mockReturnValue([
            { name: 'session-A', isDirectory: () => true }, // só A tem pasta
        ] as any);
        svc.sessionStatus.set('A', 'STOPPED');
        svc.sessionStatus.set('C', 'STOPPED'); // sem pasta → sweep nem enxerga

        const start = vi.spyOn(svc, 'startSession').mockResolvedValue({ status: 'STARTING' } as any);
        svc.recoverStoppedSessions();

        expect(start).toHaveBeenCalledTimes(1);
        expect(start).toHaveBeenCalledWith('A');
        expect(start).not.toHaveBeenCalledWith('C');
    });
});
