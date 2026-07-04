import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
    PrecheckBadge,
    PrecheckAnalysis,
    RejectedPrecheckBanner,
    VERDICT_CONFIG,
} from './TaskCard';
import type { PrecheckReport } from '../services/taskService';

describe('PrecheckBadge — vereditos', () => {
    it('NÃO renderiza badge quando não há precheck_report (regression)', () => {
        const { container } = render(<PrecheckBadge report={null} />);
        expect(container).toBeEmptyDOMElement();
    });

    it('NÃO renderiza badge quando o veredito é "ok" (regression)', () => {
        const report: PrecheckReport = { verdict: 'ok' };
        const { container } = render(<PrecheckBadge report={report} />);
        expect(container).toBeEmptyDOMElement();
    });

    it('renderiza badge amarelo "🔁 Duplicado" para verdict duplicate', () => {
        const report: PrecheckReport = {
            verdict: 'duplicate',
            reason: 'Similar ao #990',
            evidence: [{ type: 'similar_issue', reference: '#990', excerpt: 'mesmo stack trace' }],
        };
        render(<PrecheckBadge report={report} />);
        const badge = screen.getByRole('button', { name: '🔁 Duplicado' });
        expect(badge).toBeInTheDocument();
        expect(badge.className).toContain('amber');
    });

    it('renderiza badge verde "✅ Já resolvido" para verdict already_resolved', () => {
        const report: PrecheckReport = {
            verdict: 'already_resolved',
            evidence: [{ type: 'commit', reference: 'abc123', url: 'https://vcs/commit/abc123' }],
            originalUrl: 'https://vcs/pr/42',
        };
        render(<PrecheckBadge report={report} />);
        const badge = screen.getByRole('button', { name: '✅ Já resolvido' });
        expect(badge).toBeInTheDocument();
        expect(badge.className).toContain('emerald');
    });

    it('renderiza badge vermelho "⚠️ Sem evidência" para verdict false_report', () => {
        const report: PrecheckReport = { verdict: 'false_report' };
        render(<PrecheckBadge report={report} />);
        const badge = screen.getByRole('button', { name: '⚠️ Sem evidência' });
        expect(badge).toBeInTheDocument();
        expect(badge.className).toContain('red');
    });

    it('renderiza badge cinza "🤔 Baixa evidência" para verdict low_evidence', () => {
        const report: PrecheckReport = { verdict: 'low_evidence' };
        render(<PrecheckBadge report={report} />);
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

describe('PrecheckBadge — popover', () => {
    it('abre o popover ao clicar e exibe evidências + botão "Ver originais" (duplicate)', () => {
        const onOpenOriginal = vi.fn();
        const report: PrecheckReport = {
            verdict: 'duplicate',
            reason: 'Parecida com #990',
            evidence: [
                { type: 'similar_issue', reference: '#990', excerpt: 'stack trace igual', url: 'https://t/990' },
            ],
        };
        render(<PrecheckBadge report={report} onOpenOriginal={onOpenOriginal} />);

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
            originalUrl: 'https://vcs/pr/42',
        };
        render(<PrecheckBadge report={report} />);
        fireEvent.click(screen.getByRole('button', { name: '✅ Já resolvido' }));
        const link = screen.getByRole('link', { name: /ver resolução/i });
        expect(link).toHaveAttribute('href', 'https://vcs/pr/42');
    });
});

describe('PrecheckAnalysis', () => {
    it('não renderiza quando veredito é ok', () => {
        const { container } = render(<PrecheckAnalysis report={{ verdict: 'ok' }} />);
        expect(container).toBeEmptyDOMElement();
    });

    it('não renderiza quando não há evidências', () => {
        const { container } = render(<PrecheckAnalysis report={{ verdict: 'duplicate' }} />);
        expect(container).toBeEmptyDOMElement();
    });

    it('expande e lista evidências com tipo/referência/trecho', () => {
        const report: PrecheckReport = {
            verdict: 'duplicate',
            evidence: [
                { type: 'similar_issue', reference: '#990', excerpt: 'mesmo erro' },
                { type: 'commit', reference: 'abc123', excerpt: 'fix aplicado' },
            ],
        };
        render(<PrecheckAnalysis report={report} />);
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

describe('RejectedPrecheckBanner', () => {
    it('exibe banner destacado quando a task foi rejeitada por duplicado', () => {
        const report: PrecheckReport = { verdict: 'duplicate', originalUrl: 'https://t/990' };
        render(<RejectedPrecheckBanner report={report} />);
        const banner = screen.getByTestId('precheck-rejected-banner');
        expect(banner).toBeInTheDocument();
        expect(banner).toHaveTextContent(/rejeitada automaticamente pelo pre-check/i);
        expect(banner).toHaveTextContent('duplicado');
        expect(screen.getByRole('link', { name: 'Abrir original' })).toHaveAttribute('href', 'https://t/990');
    });

    it('exibe motivo "já resolvido" quando o veredito é already_resolved', () => {
        render(<RejectedPrecheckBanner report={{ verdict: 'already_resolved' }} />);
        const banner = screen.getByTestId('precheck-rejected-banner');
        expect(banner).toHaveTextContent('já resolvido');
    });

    it('não renderiza link "Abrir original" quando não há originalUrl', () => {
        render(<RejectedPrecheckBanner report={{ verdict: 'false_report' }} />);
        const banner = screen.getByTestId('precheck-rejected-banner');
        expect(banner).toHaveTextContent('rejeitada pelo pre-check');
        expect(screen.queryByRole('link', { name: 'Abrir original' })).not.toBeInTheDocument();
    });
});
