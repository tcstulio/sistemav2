import { describe, it, expect } from 'vitest';
import { llmCallLogService } from '../../services/llmCallLogService';

// fs é mockado globalmente em setup.ts → o store opera em memória (inicia vazio).
describe('llmCallLogService (#710)', () => {
    it('registra, lista (mais recentes primeiro), filtra e agrega', () => {
        llmCallLogService.record({ model: 'glm-5.2', primaryModel: 'glm-5.2', fellBack: false, ok: true, latencyMs: 100, origin: 'chat', totalTokens: 50 });
        llmCallLogService.record({ model: 'glm-5.2', primaryModel: 'glm-5.2', fellBack: false, ok: false, latencyMs: 200, origin: 'judge', errorCode: '429', errorDetail: 'rate limit' });
        llmCallLogService.record({ model: 'MiniMax-M3', primaryModel: 'glm-5.2', fellBack: true, ok: true, latencyMs: 300, origin: 'planner' });

        const all = llmCallLogService.list();
        expect(all.length).toBe(3);
        // mais recente primeiro (unshift): o fallback foi o último registrado
        expect(all[0].model).toBe('MiniMax-M3');
        expect(all[0].fellBack).toBe(true);

        const errs = llmCallLogService.list({ onlyErrors: true });
        expect(errs.length).toBe(1);
        expect(errs[0].errorCode).toBe('429');

        const mm = llmCallLogService.list({ model: 'MiniMax-M3' });
        expect(mm.length).toBe(1);

        const sum = llmCallLogService.summary();
        expect(sum.total).toBe(3);
        expect(sum.errors).toBe(1);
        expect(sum.fallbacks).toBe(1);
        expect(sum.avgLatencyMs).toBe(200); // (100+200+300)/3
        expect(sum.byModel['glm-5.2']).toEqual({ count: 2, errors: 1 });
        expect(sum.byModel['MiniMax-M3']).toEqual({ count: 1, errors: 0 });
    });
});
