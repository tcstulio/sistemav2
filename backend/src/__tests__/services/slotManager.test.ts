import { describe, it, expect } from 'vitest';
import path from 'path';
import { slotManager } from '../../services/slotManager';

// Este teste vive em backend/src/__tests__/services (um nível mais fundo que o slotManager.ts,
// que está em backend/src/services) — daí 4 subidas p/ chegar à raiz do repo, não 3.
const REPO_ROOT = path.resolve(__dirname, '../../../../');
const EXPECTED_WT_ROOT = path.resolve(REPO_ROOT, '..', 'sistemav2-taskrunner-wt');

describe('slotManager (Fase 2.1 — fundação slot-aware)', () => {
    it('slot1.root é byte-idêntico ao antigo WT_ROOT', () => {
        expect(slotManager.slot1.root).toBe(EXPECTED_WT_ROOT);
    });

    it('slot1 tem id=1 e dataDir=null (herda o XDG default)', () => {
        expect(slotManager.slot1.id).toBe(1);
        expect(slotManager.slot1.dataDir).toBeNull();
    });

    it('slots() devolve só o slot-1 (clamp em 1)', () => {
        const s = slotManager.slots();
        expect(s).toHaveLength(1);
        expect(s[0]).toBe(slotManager.slot1);
    });

    it('maxParallelExec() é HARD-CLAMPADO em 1 (serial, byte-idêntico ao de hoje)', () => {
        expect(slotManager.maxParallelExec()).toBe(1);
    });
});
