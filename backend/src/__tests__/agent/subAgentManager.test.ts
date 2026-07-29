import { describe, it, expect, beforeEach, vi } from 'vitest';

const loggerMock = vi.hoisted(() => ({
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
}));

vi.mock('../../utils/logger', () => ({
    createLogger: () => loggerMock,
}));

import {
    getSubAgentManager,
    resetSubAgentManager,
    SubAgentManager,
} from '../../agent/subAgentManager';
import { MAX_CONCURRENT_SUBAGENTS, MAX_DELEGATIONS_PER_TASK } from '../../agent/config';

describe('#1037 SubAgentManager', () => {
    let mgr: InstanceType<typeof SubAgentManager>;

    beforeEach(() => {
        resetSubAgentManager();
        mgr = getSubAgentManager();
        loggerMock.warn.mockClear();
    });

    describe('singleton', () => {
        it('getSubAgentManager retorna a mesma instância', () => {
            expect(getSubAgentManager()).toBe(getSubAgentManager());
        });

        it('resetSubAgentManager cria uma nova instância zerada', () => {
            mgr.acquire('s1', 'a');
            expect(mgr.activeCount('s1')).toBe(1);
            resetSubAgentManager();
            const fresh = getSubAgentManager();
            expect(fresh.activeCount('s1')).toBe(0);
            expect(fresh).not.toBe(mgr);
        });
    });

    describe('concorrência (acquire/release/canAcquire)', () => {
        it('aceita até MAX_CONCURRENT_SUBAGENTS sub-agentes por sessão', () => {
            expect(mgr.acquire('s1', 'a')).toBe(true);
            expect(mgr.acquire('s1', 'b')).toBe(true);
            expect(mgr.acquire('s1', 'c')).toBe(true);
            expect(mgr.activeCount('s1')).toBe(MAX_CONCURRENT_SUBAGENTS);
        });

        it('4º sub-agente simultâneo é rejeitado pelo acquire', () => {
            mgr.acquire('s1', 'a');
            mgr.acquire('s1', 'b');
            mgr.acquire('s1', 'c');
            expect(mgr.acquire('s1', 'd')).toBe(false);
            expect(mgr.activeCount('s1')).toBe(3);
        });

        it('canAcquire vira false ao atingir o limite', () => {
            expect(mgr.canAcquire('s1')).toBe(true);
            mgr.acquire('s1', 'a');
            mgr.acquire('s1', 'b');
            mgr.acquire('s1', 'c');
            expect(mgr.canAcquire('s1')).toBe(false);
        });

        it('release libera capacidade para um novo sub-agente', () => {
            mgr.acquire('s1', 'a');
            mgr.acquire('s1', 'b');
            mgr.acquire('s1', 'c');
            expect(mgr.acquire('s1', 'd')).toBe(false);
            mgr.release('s1', 'b');
            expect(mgr.acquire('s1', 'd')).toBe(true);
        });

        it('acquire é idempotente para o mesmo subAgentId', () => {
            mgr.acquire('s1', 'a');
            mgr.acquire('s1', 'a');
            expect(mgr.activeCount('s1')).toBe(1);
        });

        it('contagem é isolada por sessão', () => {
            mgr.acquire('s1', 'a');
            mgr.acquire('s1', 'b');
            mgr.acquire('s1', 'c');
            expect(mgr.canAcquire('s1')).toBe(false);
            expect(mgr.canAcquire('s2')).toBe(true);
            expect(mgr.acquire('s2', 'x')).toBe(true);
        });

        it('release de sessão inexistente é no-op', () => {
            expect(() => mgr.release('nope', 'x')).not.toThrow();
        });

        it('release de id inexistente é no-op', () => {
            mgr.acquire('s1', 'a');
            expect(() => mgr.release('s1', 'zzz')).not.toThrow();
            expect(mgr.activeCount('s1')).toBe(1);
        });
    });

    describe('métrica delegation_total', () => {
        it('incrementDelegation acumula por sessão e retorna o total', () => {
            expect(mgr.incrementDelegation('s1')).toBe(1);
            expect(mgr.incrementDelegation('s1')).toBe(2);
            expect(mgr.delegationCount('s1')).toBe(2);
        });

        it('NÃO loga warning até o limite MAX_DELEGATIONS_PER_TASK', () => {
            for (let i = 0; i < MAX_DELEGATIONS_PER_TASK; i++) {
                mgr.incrementDelegation('s1');
            }
            expect(loggerMock.warn).not.toHaveBeenCalled();
        });

        it('loga warning ao ULTRAPASSAR MAX_DELEGATIONS_PER_TASK', () => {
            for (let i = 0; i < MAX_DELEGATIONS_PER_TASK; i++) {
                mgr.incrementDelegation('s1');
            }
            loggerMock.warn.mockClear();
            mgr.incrementDelegation('s1');
            expect(loggerMock.warn).toHaveBeenCalledTimes(1);
            expect(loggerMock.warn).toHaveBeenCalledWith(
                expect.stringContaining('possível loop de delegação'),
            );
        });
    });

    describe('reset', () => {
        it('resetSession descarta estado de uma sessão específica', () => {
            mgr.acquire('s1', 'a');
            mgr.incrementDelegation('s1');
            mgr.resetSession('s1');
            expect(mgr.activeCount('s1')).toBe(0);
            expect(mgr.delegationCount('s1')).toBe(0);
        });

        it('resetAll descarta o estado de todas as sessões', () => {
            mgr.acquire('s1', 'a');
            mgr.incrementDelegation('s2');
            mgr.resetAll();
            expect(mgr.activeCount('s1')).toBe(0);
            expect(mgr.delegationCount('s2')).toBe(0);
        });
    });
});
