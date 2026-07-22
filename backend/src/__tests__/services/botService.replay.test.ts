import { describe, it, expect } from 'vitest';
import { isReplayedOldMessage } from '../../services/botService';

// nowMs fixo (determinístico): 2026-07-22T18:00:00Z = 1784743200000 ms = 1784743200 s
const NOW_MS = 1784743200000;
const NOW_S = Math.floor(NOW_MS / 1000);
const MAX = 120;

describe('isReplayedOldMessage — guarda de idade contra replay de reconexão', () => {
    it('mensagem ao-vivo (agora) NÃO é descartada', () => {
        expect(isReplayedOldMessage(NOW_S, NOW_MS, MAX)).toBe(false);
    });

    it('mensagem de 60s atrás (< teto) NÃO é descartada', () => {
        expect(isReplayedOldMessage(NOW_S - 60, NOW_MS, MAX)).toBe(false);
    });

    it('mensagem exatamente no teto (120s) NÃO é descartada (só > teto)', () => {
        expect(isReplayedOldMessage(NOW_S - 120, NOW_MS, MAX)).toBe(false);
    });

    it('mensagem de 121s atrás (> teto) É descartada (replay)', () => {
        expect(isReplayedOldMessage(NOW_S - 121, NOW_MS, MAX)).toBe(true);
    });

    it('mensagem de 3 horas atrás (replay clássico da reconexão) É descartada', () => {
        expect(isReplayedOldMessage(NOW_S - 3 * 3600, NOW_MS, MAX)).toBe(true);
    });

    it('timestamp no FUTURO (bug do WhatsApp) → idade negativa → NÃO descarta', () => {
        expect(isReplayedOldMessage(NOW_S + 3600, NOW_MS, MAX)).toBe(false);
    });

    it('fail-open: timestamp ausente/0/NaN NÃO descarta (não engole msg real)', () => {
        expect(isReplayedOldMessage(undefined, NOW_MS, MAX)).toBe(false);
        expect(isReplayedOldMessage(0, NOW_MS, MAX)).toBe(false);
        expect(isReplayedOldMessage(null, NOW_MS, MAX)).toBe(false);
        expect(isReplayedOldMessage('abc', NOW_MS, MAX)).toBe(false);
    });

    it('timestamp em string numérica (wwebjs às vezes manda string) é interpretado', () => {
        expect(isReplayedOldMessage(String(NOW_S - 3600), NOW_MS, MAX)).toBe(true);
    });
});
