/**
 * Testes do DiffViewer — auditoria #1179 (consumidores de task.events no frontend).
 *
 * O DiffViewer é PURAMENTE presentacional: recebe `diff` + `judgeReview` (+ campos visuais)
 * como PROPS e NÃO consome `task.events` da listagem, nem chama TaskService.listEvents. A revisão
 * (IssuesPage.openReview) busca a task CHEIA on-demand (GET /:issueNumber) e repassa judgeReview/diff
 * por props. Aqui garantimos que o DiffViewer renderiza diff + judgeReview sem depender de events,
 * evidenciando a migração pedida no item #3 da issue.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import DiffViewer from '../../components/TasksBoard/DiffViewer';
import { TaskService } from '../../services/taskService';

// VisualProofPanel chama getScreenshotBlobUrl no mount (busca before/after autenticados).
// Mock null p/ não depender de blob/FS; listEvents fica como spy p/ afirmar NÃO chamado (#1179).
vi.mock('../../services/taskService', () => ({
    TaskService: {
        getScreenshotBlobUrl: vi.fn().mockResolvedValue(null),
        generateVisualProof: vi.fn().mockResolvedValue({ hasScreenshots: false }),
        listEvents: vi.fn().mockResolvedValue([]),
    },
}));

const baseProps = {
    onClose: vi.fn(),
    onMerge: vi.fn(),
    onFix: vi.fn(),
    onReject: vi.fn(),
};

const SAMPLE_DIFF = [
    'diff --git a/src/foo.ts b/src/foo.ts',
    'index 111..222 100644',
    '--- a/src/foo.ts',
    '+++ b/src/foo.ts',
    '@@ -1,3 +1,3 @@',
    ' const x = 1;',
    '-const old = 2;',
    '+const fresh = 3;',
    ' const y = 4;',
].join('\n');

describe('DiffViewer — presentacional, sem depender de task.events (#1179)', () => {
    beforeEach(() => { vi.clearAllMocks(); });

    it('renderiza o diff a partir das props (arquivo + linhas add/remove)', () => {
        render(<DiffViewer diff={SAMPLE_DIFF} {...baseProps} />);

        expect(screen.getByText('foo.ts')).toBeTruthy();
        expect(screen.getByText('const old = 2;')).toBeTruthy();
        expect(screen.getByText('const fresh = 3;')).toBeTruthy();
    });

    it('renderiza o judgeReview COMPLETO recebido por prop (não truncado da listagem, sem events)', () => {
        const review = 'r'.repeat(1200); // bem maior que o truncamento da listagem (300)
        render(<DiffViewer diff={SAMPLE_DIFF} judgeReview={review} judgeScore={8} {...baseProps} />);

        const node = screen.getByText(review);
        expect(node).toBeTruthy();
        // completo (não truncado): sem reticências do slice da listagem
        expect(node.textContent!.endsWith('…')).toBe(false);
    });

    it('NÃO chama TaskService.listEvents — consome diff/judgeReview das props, não task.events', () => {
        render(<DiffViewer diff={SAMPLE_DIFF} issueNumber={77} judgeReview="r" {...baseProps} />);

        expect(TaskService.listEvents).not.toHaveBeenCalled();
    });
});
