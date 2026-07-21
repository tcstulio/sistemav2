import { describe, it, expect, vi } from 'vitest';

vi.mock('../../config/env', () => ({ config: { deeplinkSecret: 'test-report-tools-secret', dolibarrUrl: 'http://dolibarr.test', dolibarrKey: 'test-key' } }));
vi.mock('../../services/dolibarrService', () => ({ dolibarrService: {} }));
vi.mock('../../services/scraperService', () => ({ ScraperService: {} }));
vi.mock('../../utils/urlValidation', () => ({ isValidExternalUrl: () => true }));
vi.mock('fs', () => ({
    default: {
        existsSync: vi.fn(() => true),
        readFileSync: vi.fn(() => '<main><p class="error">falha</p><p class="error">outra</p></main>'),
        writeFileSync: vi.fn(),
        mkdirSync: vi.fn(),
    },
    existsSync: vi.fn(() => true),
    readFileSync: vi.fn(() => '<main><p class="error">falha</p><p class="error">outra</p></main>'),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
}));

import { getReportScreenshot } from '../../agent/tools/getReportScreenshot';
import { getReportHtml } from '../../agent/tools/getReportHtml';
import { getToolsPrompt, executeTool, runWithToolContext } from '../../services/agentTools';

const reportId = 'a1b2c3d4-e5f6-4890-abcd-ef1234567890';

describe('ferramentas de contexto visual de reports', () => {
    it('documenta e executa get_report_screenshot para report existente', async () => {
        const prompt = getToolsPrompt({ isAdmin: false });
        expect(prompt).toContain('get_report_screenshot(reportId)');
        expect(prompt).toContain('get_report_html(reportId, selector?)');
        const result = await runWithToolContext({ isAdmin: false }, () => executeTool('get_report_screenshot', { reportId }));
        expect(result).toContain(`/api/issues/report/${reportId}/screenshot?token=`);
        expect(result).toContain('1 hora');
    });

    it('retorna HTML completo e innerHTML filtrado', () => {
        expect(getReportHtml(reportId)).toContain('<main>');
        expect(getReportHtml(reportId, '.error')).toBe('falha');
    });

    it('retorna mensagem amigável quando o report não existe ou falta reportId', () => {
        expect(getReportScreenshot('42')).toBe('Report não encontrado.');
        expect(getReportHtml('42')).toBe('Report não encontrado.');
        expect(getReportScreenshot('')).toMatch(/reportId/);
    });
});
