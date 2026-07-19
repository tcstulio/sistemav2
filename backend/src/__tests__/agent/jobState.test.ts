import { describe, it, expect, beforeEach } from 'vitest';
import { jobState } from '../../agent/jobState';

describe('jobState (#1578)', () => {
    beforeEach(() => {
        jobState._clearAllForTests();
    });

    describe('init', () => {
        it('cria estado inicial com tabHidden=false quando chamado sem dados', () => {
            jobState.init('job-1');
            const state = jobState.get('job-1');
            expect(state).toBeDefined();
            expect(state!.tabHidden).toBe(false);
            expect(state!.jobId).toBe('job-1');
        });

        it('preserva campos fornecidos (userId, userName, label)', () => {
            jobState.init('job-2', { userId: 'u1', userName: 'Ana', label: 'chat' });
            const state = jobState.get('job-2');
            expect(state!.userId).toBe('u1');
            expect(state!.userName).toBe('Ana');
            expect(state!.label).toBe('chat');
        });

        it('é idempotente — segunda chamada faz MERGE sem resetar tabHidden', () => {
            jobState.init('job-3', { userId: 'u1' });
            jobState.setVisibility('job-3', true);
            // Re-init com novo campo — NÃO pode resetar tabHidden nem userId.
            jobState.init('job-3', { label: 'chat' });
            const state = jobState.get('job-3');
            expect(state!.tabHidden).toBe(true);
            expect(state!.userId).toBe('u1');
            expect(state!.label).toBe('chat');
        });

        it('NÃO sobrescreve `notified` em re-init (decisão é definitiva)', () => {
            jobState.init('job-4');
            jobState.markNotified('job-4');
            // Re-init não inclui notified (Partial<Omit<..., 'notified'>>).
            jobState.init('job-4', { userId: 'u1' });
            expect(jobState.get('job-4')!.notified).toBe(true);
        });

        it('ignora init com jobId vazio', () => {
            jobState.init('');
            // nada foi criado — get de qualquer chave continua undefined
            expect(jobState.get('')).toBeUndefined();
        });
    });

    describe('setVisibility', () => {
        it('atualiza a flag e retorna true quando o job existe', () => {
            jobState.init('job-v1');
            expect(jobState.setVisibility('job-v1', true)).toBe(true);
            expect(jobState.get('job-v1')!.tabHidden).toBe(true);

            expect(jobState.setVisibility('job-v1', false)).toBe(true);
            expect(jobState.get('job-v1')!.tabHidden).toBe(false);
        });

        it('retorna false quando o job não existe (caller responde 404)', () => {
            expect(jobState.setVisibility('inexistente', true)).toBe(false);
        });
    });

    describe('markNotified', () => {
        it('marca o job como notificado', () => {
            jobState.init('job-n1');
            jobState.markNotified('job-n1');
            expect(jobState.get('job-n1')!.notified).toBe(true);
        });

        it('é no-op quando o job não existe (dedupe defensivo)', () => {
            expect(() => jobState.markNotified('inexistente')).not.toThrow();
        });
    });

    describe('get / clear', () => {
        it('get retorna undefined para job não trackeado', () => {
            expect(jobState.get('desconhecido')).toBeUndefined();
        });

        it('clear remove o estado (idempotente)', () => {
            jobState.init('job-c1');
            jobState.clear('job-c1');
            expect(jobState.get('job-c1')).toBeUndefined();
            // segunda chamada não lança
            expect(() => jobState.clear('job-c1')).not.toThrow();
        });
    });
});
