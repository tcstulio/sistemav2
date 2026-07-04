import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
    TaskPrecheckBadge,
    TaskPrecheckAnalysis,
    TaskRejectedBanner,
    VERDICT_CONFIG,
    isRejectedPrecheck,
} from './TaskCard';
import type { PrecheckReport, Task } from '../types';

const baseTask = (overrides: Partial<Task> = {}): Task => ({
    id: '1',
    ref: 'TASK001',
    label: 'Corrigir bug no login',
    project_id: 'p1',
    progress: 0,
    ...overrides,
});

describe('TaskPrecheckBadge — vereditos', () => {
    it('NÃO renderiza badge quando não há precheck_report (regression)', () => {
        const { container } = render(<TaskPrecheckBadge report={null} />);
        expect(container).toBeEmptyDOMElement();
    });

    it('NÃO renderiza badge quando o veredito é "ok" (regression)', () => {
        const report: PrecheckReport = { verdict: 'ok' };
        const { container } = render(<TaskPrecheckBadge report={report} />);
        expect(container).toBeEmptyDOMElement();
    });

    it('renderiza badge amarelo "🔁 Duplicado" para verdict duplicate', () => {
        const report: PrecheckReport = {
            verdict: 'duplicate',
            reason: 'Similar ao #990',
            evidence: [{ type: 'similar_issue', reference: '#990', snippet: 'mesmo stack trace' }],
        };
        render(<TaskPrecheckBadge report={report} />);
        const badge = screen.getByRole('button', { name: '🔁 Duplicado' });
        expect(badge).toBeInTheDocument();
        expect(badge.className).toContain('amber');
    });

    it('renderiza badge verde "✅ Já resolvido" para verdict already_resolved', () => {
        const report: PrecheckReport = {
            verdict: 'already_resolved',
            evidence: [{ type: 'commit', reference: 'abc123', url: 'https://vcs/commit/abc123' }],
            original_url: 'https://vcs/pr/42',
        };
        render(<TaskPrecheckBadge report={report} />);
        const badge = screen.getByRole('button', { name: '✅ Já resolvido' });
        expect(badge).toBeInTheDocument();
        expect(badge.className).toContain('emerald');
    });

    it('renderiza badge vermelho "⚠️ Sem evidência" para verdict false_report', () => {
        const report: PrecheckReport = { verdict: 'false_report' };
        render(<TaskPrecheckBadge report={report} />);
        const badge = screen.getByRole('button', { name: '⚠️ Sem evidência' });
        expect(badge).toBeInTheDocument();
        expect(badge.className).toContain('red');
    });

    it('renderiza badge cinza "🤔 Baixa evidência" para verdict low_evidence', () => {
        const report: PrecheckReport = { verdict: 'low_evidence' };
        render(<TaskPrecheckBadge report={report} />);
        const badge = screen.getByRole('button', { name: '🤔 Baixa evidência' });
        expect(badge).toBeInTheDocument();
        expect(badge.className).toContain('slate');
    });

    it('cada verdict possui cor/ícone/label distintos no VERDICT_CONFIG', () => {
        const verdicts = ['duplicate', 'already_resolved', 'false_report', 'low_evidence'] as const;
        const labels = new Set(verdicts.map((v) => VERDICT_CONFIG[v].label));
        const icons = new Set(verdicts.map((v) => VERDICT_CONFIG[v].icon));
        const classes = new Set(verdicts.map((v) => VERDICT_CONFIG[v].classes));
        expect(labels.size).toBe(verdicts.length);
        expect(icons.size).toBe(verdicts.length);
        expect(classes.size).toBe(verdicts.length);
    });
});

describe('TaskPrecheckBadge — popover', () => {
    it('abre o popover ao clicar e exibe evidências + botão "Ver originais" (duplicate)', () => {
        const onOpenOriginal = vi.fn();
        const report: PrecheckReport = {
            verdict: 'duplicate',
            reason: 'Parecida com #990',
            evidence: [
                { type: 'similar_issue', reference: '#990', snippet: 'stack trace igual', url: 'https://t/990' },
            ],
            original_ref: '#990',
        };
        render(<TaskPrecheckBadge report={report} onOpenOriginal={onOpenOriginal} />);

        expect(screen.queryByTestId('precheck-popover')).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: '🔁 Duplicado' }));
        const popover = screen.getByTestId('precheck-popover');
        expect(popover).toBeInTheDocument();
        expect(popover).toHaveTextContent('Parecida com #990');
        expect(popover).toHaveTextContent('similar_issue');
        expect(popover).toHaveTextContent('#990');

        fireEvent.click(screen.getByRole('button', { name: 'Ver originais' }));
        expect(onOpenOriginal).toHaveBeenCalledWith(report);
    });

    it('already_resolved mostra link para a resolução no popover', () => {
        const report: PrecheckReport = {
            verdict: 'already_resolved',
            evidence: [{ type: 'pr', reference: '#42' }],
            original_url: 'https://vcs/pr/42',
        };
        render(<TaskPrecheckBadge report={report} />);
        fireEvent.click(screen.getByRole('button', { name: '✅ Já resolvido' }));
        const link = screen.getByRole('link', { name: /ver resolução/i });
        expect(link).toHaveAttribute('href', 'https://vcs/pr/42');
    });
});

describe('TaskPrecheckAnalysis', () => {
    it('não renderiza quando veredito é ok', () => {
        const { container } = render(<TaskPrecheckAnalysis report={{ verdict: 'ok' }} />);
        expect(container).toBeEmptyDOMElement();
    });

    it('não renderiza quando não há evidências', () => {
        const { container } = render(<TaskPrecheckAnalysis report={{ verdict: 'duplicate' }} />);
        expect(container).toBeEmptyDOMElement();
    });

    it('expande e lista evidências com tipo/referência/trecho', () => {
        const report: PrecheckReport = {
            verdict: 'duplicate',
            evidence: [
                { type: 'similar_issue', reference: '#990', snippet: 'mesmo erro' },
                { type: 'commit', reference: 'abc123', snippet: 'fix aplicado' },
            ],
        };
        render(<TaskPrecheckAnalysis report={report} />);
        const toggle = screen.getByRole('button', { name: /análise prévia/i });
        expect(screen.queryAllByTestId('precheck-evidence')).toHaveLength(0);

        fireEvent.click(toggle);
        const items = screen.getAllByTestId('precheck-evidence');
        expect(items).toHaveLength(2);
        expect(items[0]).toHaveTextContent('similar_issue');
        expect(items[0]).toHaveTextContent('#990');
        expect(items[0]).toHaveTextContent('mesmo erro');
    });
});

describe('TaskRejectedBanner / isRejectedPrecheck', () => {
    it('isRejectedPrecheck detecta status rejected_precheck (string e statut)', () => {
        expect(isRejectedPrecheck(baseTask({ statut: 'rejected_precheck' }))).toBe(true);
        expect(isRejectedPrecheck(baseTask({ status: 1 }))).toBe(false);
        expect(isRejectedPrecheck(baseTask())).toBe(false);
    });

    it('exibe banner destacado quando a task foi rejeitada pelo pre-check', () => {
        const task = baseTask({
            statut: 'rejected_precheck',
            precheck_report: { verdict: 'duplicate', original_url: 'https://t/990' },
        });
        render(<TaskRejectedBanner task={task} />);
        const banner = screen.getByTestId('precheck-rejected-banner');
        expect(banner).toBeInTheDocument();
        expect(banner).toHaveTextContent(/rejeitada automaticamente pelo pre-check/i);
        expect(banner).toHaveTextContent('duplicado');
        expect(screen.getByRole('link', { name: 'Abrir original' })).toHaveAttribute('href', 'https://t/990');
    });

    it('não renderiza banner quando a task não foi rejeitada', () => {
        const { container } = render(<TaskRejectedBanner task={baseTask()} />);
        expect(container).toBeEmptyDOMElement();
    });
});
