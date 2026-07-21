import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('whatsapp-web.js', () => ({ Client: vi.fn(), LocalAuth: vi.fn(), MessageMedia: vi.fn() }));
vi.mock('qrcode', () => ({ toDataURL: vi.fn(async () => 'data:'), toString: vi.fn(async () => '') }));
vi.mock('../../services/socketService', () => ({ socketService: { emit: vi.fn() } }));
vi.mock('../../services/botService', () => ({ botService: { processMessage: vi.fn() } }));
vi.mock('../../utils/processTree', () => ({ killChromesByProfile: vi.fn(async () => {}) }));

import { sessionService } from '../../services/legacy/sessionService';

const svc = sessionService as any;

describe('sessionService — histórico de conexão persistente (#wa-conn-history)', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        svc.sessionStatus = new Map();
    });

    it('registra a transição SÓ quando o status MUDA (dedup do spam de QR)', () => {
        const conn = vi.spyOn(svc, 'connLog').mockImplementation(() => {});

        svc.setStatus('X', 'INITIALIZING'); // - → INITIALIZING (registra)
        svc.setStatus('X', 'WORKING');      // INITIALIZING → WORKING (registra)
        svc.setStatus('X', 'WORKING');      // WORKING → WORKING (NÃO)
        svc.setStatus('X', 'SCAN_QR_CODE'); // WORKING → SCAN_QR (registra)
        svc.setStatus('X', 'SCAN_QR_CODE'); // repetido (QR rotativo) → NÃO

        expect(conn).toHaveBeenCalledTimes(3);
        expect(conn).toHaveBeenNthCalledWith(1, 'X', 'STATUS - → INITIALIZING');
        expect(conn).toHaveBeenNthCalledWith(2, 'X', 'STATUS INITIALIZING → WORKING');
        expect(conn).toHaveBeenNthCalledWith(3, 'X', 'STATUS WORKING → SCAN_QR_CODE');
    });

    it('connLog é best-effort — nunca lança (mesmo sem fs disponível no teste)', () => {
        expect(() => svc.connLog('Y', 'DISCONNECTED reason=LOGOUT')).not.toThrow();
    });
});
