import { describe, it, expect, afterEach } from 'vitest';
import path from 'path';
import { slotManager, SLOT2_ROOT, SLOT2_XDG, type Slot } from '../../services/slotManager';

// Este teste vive em backend/src/__tests__/services (um nível mais fundo que o slotManager.ts,
// que está em backend/src/services) — daí 4 subidas p/ chegar à raiz do repo, não 3.
const REPO_ROOT = path.resolve(__dirname, '../../../../');
const EXPECTED_WT_ROOT = path.resolve(REPO_ROOT, '..', 'sistemav2-taskrunner-wt');

const fakeSlot2: Slot = { id: 2, root: '/tmp/slot2', dataDir: 'C:/tmp/slot2-xdg', kind: 'clone' };

// slotManager é SINGLETON — registrar/env vazam entre testes. Sempre reverter ao estado default.
afterEach(() => {
    slotManager.unregisterSlot2();
    delete process.env.TASKRUNNER_MAX_PARALLEL;
});

describe('slotManager (Fase 2.1 — fundação slot-aware)', () => {
    it('slot1.root é byte-idêntico ao antigo WT_ROOT', () => {
        expect(slotManager.slot1.root).toBe(EXPECTED_WT_ROOT);
    });

    it('slot1 tem id=1, dataDir=null (herda o XDG default) e kind=worktree', () => {
        expect(slotManager.slot1.id).toBe(1);
        expect(slotManager.slot1.dataDir).toBeNull();
        expect(slotManager.slot1.kind).toBe('worktree');
    });

    it('DEFAULT (sem slot-2, sem env): slots()=1 e maxParallelExec()=1 — byte-idêntico ao de hoje', () => {
        const s = slotManager.slots();
        expect(s).toHaveLength(1);
        expect(s[0]).toBe(slotManager.slot1);
        expect(slotManager.maxParallelExec()).toBe(1);
    });
});

describe('slotManager — registro do slot-2 + fórmula do clamp (PR-1)', () => {
    it('registerSlot2 coloca o slot-2 em slots(); unregisterSlot2 tira', () => {
        slotManager.registerSlot2(fakeSlot2);
        expect(slotManager.slots()).toEqual([slotManager.slot1, fakeSlot2]);
        slotManager.unregisterSlot2();
        expect(slotManager.slots()).toEqual([slotManager.slot1]);
    });

    it('slot-2 registrado MAS env default (1) → maxParallelExec()=1 (gate do env segura)', () => {
        slotManager.registerSlot2(fakeSlot2);
        expect(slotManager.slots()).toHaveLength(2);
        expect(slotManager.maxParallelExec()).toBe(1); // registrar é inerte sem o env
    });

    it('slot-2 registrado + TASKRUNNER_MAX_PARALLEL=2 → maxParallelExec()=2 (o flip)', () => {
        process.env.TASKRUNNER_MAX_PARALLEL = '2';
        slotManager.registerSlot2(fakeSlot2);
        expect(slotManager.maxParallelExec()).toBe(2);
    });

    it('env=5 mas só 2 slots → clampa em 2 (min(env, slots().length))', () => {
        process.env.TASKRUNNER_MAX_PARALLEL = '5';
        slotManager.registerSlot2(fakeSlot2);
        expect(slotManager.maxParallelExec()).toBe(2);
    });

    it('env=2 mas SEM slot-2 → 1 (min com 1 slot) — nunca despacha p/ slot inexistente', () => {
        process.env.TASKRUNNER_MAX_PARALLEL = '2';
        expect(slotManager.slots()).toHaveLength(1);
        expect(slotManager.maxParallelExec()).toBe(1);
    });

    it('env lixo/vazio/0 → 1 (Number(...)||1 neutraliza), mesmo com slot-2 registrado', () => {
        slotManager.registerSlot2(fakeSlot2);
        for (const bad of ['abc', '', '0']) {
            process.env.TASKRUNNER_MAX_PARALLEL = bad;
            expect(slotManager.maxParallelExec()).toBe(1);
        }
    });

    it('piso 1: env negativo nunca zera o paralelismo', () => {
        process.env.TASKRUNNER_MAX_PARALLEL = '-3';
        expect(slotManager.maxParallelExec()).toBe(1);
    });
});

describe('slotManager — consts do slot-2', () => {
    it('SLOT2_ROOT é sibling de prod', () => {
        expect(SLOT2_ROOT).toBe(path.resolve(REPO_ROOT, '..', 'sistemav2-taskrunner-slot2'));
    });
    it('SLOT2_XDG usa forward slashes (imune a mangling no bash -lc) e termina em -xdg', () => {
        expect(SLOT2_XDG).not.toMatch(/\\/);
        expect(SLOT2_XDG.endsWith('sistemav2-taskrunner-slot2-xdg')).toBe(true);
    });
});
