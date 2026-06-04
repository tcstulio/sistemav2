import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';

vi.mock('../../utils/atomicWrite', () => ({ atomicWriteSync: vi.fn() }));
import { atomicWriteSync } from '../../utils/atomicWrite';

const mockedFs = vi.mocked(fs);
const mockedWrite = vi.mocked(atomicWriteSync);

import { DashboardArtifactsService } from '../../services/dashboardArtifactsService';

describe('dashboardArtifactsService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockedFs.existsSync.mockReturnValue(false);
    });

    it('retorna vazio por padrão', () => {
        const s = new DashboardArtifactsService('d.json');
        expect(s.get()).toEqual({ financialAnalysis: null, salesForecast: null });
    });

    it('setFinancialAnalysis persiste com autor e timestamp', () => {
        const s = new DashboardArtifactsService('d.json');
        const a = s.setFinancialAnalysis('## Resumo', 'maria');
        expect(a.value).toBe('## Resumo');
        expect(a.generatedBy).toBe('maria');
        expect(typeof a.generatedAt).toBe('number');
        expect(s.get().financialAnalysis?.value).toBe('## Resumo');
        expect(mockedWrite).toHaveBeenCalled();
    });

    it('setSalesForecast guarda o objeto', () => {
        const s = new DashboardArtifactsService('d.json');
        s.setSalesForecast({ trend: 'up', forecast: [] }, 'joao');
        expect(s.get().salesForecast?.value.trend).toBe('up');
        expect(s.get().salesForecast?.generatedBy).toBe('joao');
    });

    it('carrega do arquivo quando existe', () => {
        mockedFs.existsSync.mockReturnValue(true);
        mockedFs.readFileSync.mockReturnValue(JSON.stringify({
            financialAnalysis: { value: 'carregado', generatedBy: 'ana', generatedAt: 1 },
            salesForecast: null,
        }) as any);
        const s = new DashboardArtifactsService('d.json');
        expect(s.get().financialAnalysis?.value).toBe('carregado');
        expect(s.get().financialAnalysis?.generatedBy).toBe('ana');
    });
});
