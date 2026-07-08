import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
    PrecheckBadge,
    PrecheckAnalysis,
    RejectedPrecheckBanner,
    RoundsChip,
    PlanCooldownChip,
    TaskAutomationChips,
    VERDICT_CONFIG,
} from './TaskCard';
import type { PrecheckReport, Task } from '../services/taskService';

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

describe('RoundsChip (issue #1188)', () => {
    it('omite silenciosamente quando roundsUsed é undefined (card legacy)', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const { container } = render(<RoundsChip maxRoundsPerTask={10} />);
        expect(container).toBeEmptyDOMElement();
        expect(warnSpy).not.toHaveBeenCalled();
        expect(errorSpy).not.toHaveBeenCalled();
        warnSpy.mockRestore();
        errorSpy.mockRestore();
    });

    it('omite silenciosamente quando roundsUsed é null', () => {
        const { container } = render(<RoundsChip roundsUsed={null} maxRoundsPerTask={10} />);
        expect(container).toBeEmptyDOMElement();
    });

    it('omite silenciosamente quando maxRoundsPerTask está ausente (config legacy)', () => {
        const { container } = render(<RoundsChip roundsUsed={5} />);
        expect(container).toBeEmptyDOMElement();
    });

    it('omite silenciosamente quando maxRoundsPerTask é inválido (0/negativo/NaN)', () => {
        const { container: c0 } = render(<RoundsChip roundsUsed={5} maxRoundsPerTask={0} />);
        expect(c0).toBeEmptyDOMElement();
        const { container: cNeg } = render(<RoundsChip roundsUsed={5} maxRoundsPerTask={-3} />);
        expect(cNeg).toBeEmptyDOMElement();
        const { container: cNaN } = render(<RoundsChip roundsUsed={5} maxRoundsPerTask={NaN} />);
        expect(cNaN).toBeEmptyDOMElement();
    });

    it('renderiza 🔄 roundsUsed/maxRoundsPerTask com cor neutra quando a proporção < 0.7', () => {
        render(<RoundsChip roundsUsed={6} maxRoundsPerTask={10} />);
        const chip = screen.getByTestId('task-rounds-chip');
        // 6/10 = 0.6 → neutro
        expect(chip).toHaveTextContent(/🔄\s*6\/10/);
        expect(chip.className).toContain('slate');
        expect(chip.className).not.toContain('amber');
        expect(chip.className).not.toContain('red');
    });

    it('cor âmbar quando a proporção roundsUsed/maxRoundsPerTask >= 0.7 (limite em 7/10)', () => {
        // 7/10 = exatamente 0.7 (limite inclusivo)
        const { rerender } = render(<RoundsChip roundsUsed={7} maxRoundsPerTask={10} />);
        let chip = screen.getByTestId('task-rounds-chip');
        expect(chip.className).toContain('amber');

        // 10/10 = 1.0 → ainda âmbar (não extrapolou)
        rerender(<RoundsChip roundsUsed={10} maxRoundsPerTask={10} />);
        chip = screen.getByTestId('task-rounds-chip');
        expect(chip.className).toContain('amber');
        expect(chip.className).not.toContain('red');
    });

    it('cor vermelha e valor real quando roundsUsed > maxRoundsPerTask (robô extrapolou)', () => {
        render(<RoundsChip roundsUsed={25} maxRoundsPerTask={20} />);
        const chip = screen.getByTestId('task-rounds-chip');
        expect(chip).toHaveTextContent(/🔄\s*25\/20/);
        expect(chip.className).toContain('red');
        expect(chip.className).not.toContain('amber');
    });
});

describe('PlanCooldownChip (issue #1188)', () => {
    it('não renderiza quando status !== "pending" mesmo com planWaitUntil futuro', () => {
        const future = Date.now() + 5 * 60_000;
        const { rerender } = render(<PlanCooldownChip status="running" planWaitUntil={future} />);
        expect(screen.queryByTestId('task-cooldown-chip')).not.toBeInTheDocument();
        // vário status não-pending também omitem
        rerender(<PlanCooldownChip status="approved" planWaitUntil={future} />);
        expect(screen.queryByTestId('task-cooldown-chip')).not.toBeInTheDocument();
    });

    it('não renderiza quando planWaitUntil está ausente', () => {
        const { container } = render(<PlanCooldownChip status="pending" />);
        expect(container).toBeEmptyDOMElement();
    });

    it('não renderiza quando planWaitUntil <= now (cooldown vencido)', () => {
        const fixedNow = 1_700_000_000_000;
        const { rerender } = render(
            <PlanCooldownChip status="pending" planWaitUntil={fixedNow} now={fixedNow} />,
        );
        expect(screen.queryByTestId('task-cooldown-chip')).not.toBeInTheDocument();
        rerender(<PlanCooldownChip status="pending" planWaitUntil={fixedNow - 1} now={fixedNow} />);
        expect(screen.queryByTestId('task-cooldown-chip')).not.toBeInTheDocument();
    });

    it('mostra minutos restantes arredondados para cima (mock Date.now)', () => {
        const fixedNow = 1_700_000_000_000;
        const spy = vi.spyOn(Date, 'now').mockReturnValue(fixedNow);
        render(<PlanCooldownChip status="pending" planWaitUntil={fixedNow + 5 * 60_000} />);
        // sem passar `now` → exerce Date.now() real (mockado)
        const chip = screen.getByTestId('task-cooldown-chip');
        expect(chip).toHaveTextContent('aguardando Planner (5min)');
        spy.mockRestore();
    });

    it('garante mínimo de 1 minuto quando faltam poucos segundos (mock Date.now)', () => {
        const fixedNow = 1_700_000_000_000;
        const spy = vi.spyOn(Date, 'now').mockReturnValue(fixedNow);
        // 2s restantes → ceil(2000/60000)=1, e Math.max(1, ...) trava no piso
        render(<PlanCooldownChip status="pending" planWaitUntil={fixedNow + 2_000} />);
        expect(screen.getByTestId('task-cooldown-chip')).toHaveTextContent('(1min)');
        spy.mockRestore();
    });
});

describe('TaskAutomationChips — snapshot e regressão (issue #1188)', () => {
    const baseTask: Task = {
        issueNumber: 1,
        title: 'Demo',
        body: '',
        labels: [],
        status: 'pending',
        feedbackHistory: [],
        updatedAt: '2024-01-01T00:00:00.000Z',
    };

    it('card legacy (sem roundsUsed e sem planWaitUntil) renderiza vazio — zero regressão', () => {
        const { container } = render(<TaskAutomationChips task={baseTask} maxRoundsPerTask={20} />);
        expect(container).toBeEmptyDOMElement();
    });

    it('snapshot do card com ambos os chips renderizando', () => {
        const fixedNow = 1_700_000_000_000;
        const task: Task = {
            ...baseTask,
            roundsUsed: 7,
            planWaitUntil: fixedNow + 5 * 60_000,
        };
        const { container } = render(
            <TaskAutomationChips task={task} maxRoundsPerTask={10} now={fixedNow} />,
        );
        expect(container).toMatchSnapshot();
    });
});
