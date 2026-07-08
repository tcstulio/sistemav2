/**
 * Testes de COMPONENTE (RTL) para a barra de orçamento diário de rodadas (#1189).
 *
 * Cobrem exatamente os critérios de aceite do issue:
 *  - used=5,  budget=20 (25%)  → verde
 *  - used=15, budget=20 (75%)  → âmbar
 *  - used=20, budget=20 (100%) → vermelho
 *  - estados loading e error renderizam sem crash
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DailyRoundsBudgetBar, budgetTone, DecisionCounter } from '../BoardHeader';

const fill = () => screen.getByTestId('daily-rounds-budget-fill');
const root = () => screen.getByTestId('daily-rounds-budget-bar');

describe('#1189 — DailyRoundsBudgetBar: cor por consumo', () => {
    it('used=5, budget=20 (25%) → verde', () => {
        render(<DailyRoundsBudgetBar used={5} budget={20} />);
        expect(fill()).toHaveAttribute('data-tone', 'green');
        expect(budgetTone(25)).toBe('green');
    });

    it('used=15, budget=20 (75%) → âmbar', () => {
        render(<DailyRoundsBudgetBar used={15} budget={20} />);
        expect(fill()).toHaveAttribute('data-tone', 'amber');
    });

    it('used=20, budget=20 (100%) → vermelho', () => {
        render(<DailyRoundsBudgetBar used={20} budget={20} />);
        expect(fill()).toHaveAttribute('data-tone', 'red');
    });

    it('exibe o rótulo "Orçamento do dia: {used}/{budget} rodadas"', () => {
        render(<DailyRoundsBudgetBar used={5} budget={20} />);
        expect(screen.getByText('Orçamento do dia: 5/20 rodadas')).toBeInTheDocument();
    });

    it('limita o preenchimento a 100% quando usado excede o orçamento', () => {
        render(<DailyRoundsBudgetBar used={999} budget={20} />);
        // > 100% continua vermelho e a largura fica cravada em 100%.
        expect(fill()).toHaveAttribute('data-tone', 'red');
        expect((fill() as HTMLElement).style.width).toBe('100%');
    });
});

describe('#1189 — DailyRoundsBudgetBar: estados de aquisição', () => {
    it('estado loading renderiza sem crash (barra neutra, sem tone)', () => {
        render(<DailyRoundsBudgetBar used={0} budget={20} status="loading" />);
        expect(root()).toHaveAttribute('data-status', 'loading');
        expect(fill()).not.toHaveAttribute('data-tone');
    });

    it('estado error renderiza sem crash e mostra "Orçamento indisponível"', () => {
        render(<DailyRoundsBudgetBar used={5} budget={20} status="error" />);
        expect(root()).toHaveAttribute('data-status', 'error');
        expect(screen.getByText('Orçamento indisponível')).toBeInTheDocument();
        expect(fill()).not.toHaveAttribute('data-tone');
    });

    it('success explícito respeita a cor do consumo', () => {
        render(<DailyRoundsBudgetBar used={14} budget={20} status="success" />);
        // 70% = limiar do âmbar
        expect(fill()).toHaveAttribute('data-tone', 'amber');
    });
});

describe('#1189 — DailyRoundsBudgetBar: robustez contra `used` ausente/NaN (regressão do render sweep /issues)', () => {
    it('used=undefined NÃO renderiza "NaN" — coalesce p/ 0', () => {
        render(<DailyRoundsBudgetBar used={undefined as any} budget={20} />);
        expect(screen.queryByText(/\bNaN\b/)).toBeNull();
        expect(screen.getByText('Orçamento do dia: 0/20 rodadas')).toBeInTheDocument();
    });

    it('used=NaN NÃO renderiza "NaN" e a barra fica em tom verde (0%)', () => {
        render(<DailyRoundsBudgetBar used={NaN} budget={20} />);
        expect(screen.queryByText(/\bNaN\b/)).toBeNull();
        expect(fill()).toHaveAttribute('data-tone', 'green');
        expect((fill() as HTMLElement).style.width).toBe('0%');
    });

    it('budget ausente cai no default (não gera divisão inválida)', () => {
        render(<DailyRoundsBudgetBar used={undefined as any} budget={undefined as any} />);
        expect(screen.queryByText(/\bNaN\b/)).toBeNull();
    });
});

describe('#1189 — budgetTone (limites das faixas)', () => {
    it('verde abaixo de 70%', () => {
        expect(budgetTone(0)).toBe('green');
        expect(budgetTone(69)).toBe('green');
    });
    it('âmbar de 70% a 99%', () => {
        expect(budgetTone(70)).toBe('amber');
        expect(budgetTone(99)).toBe('amber');
    });
    it('vermelho a partir de 100%', () => {
        expect(budgetTone(100)).toBe('red');
        expect(budgetTone(250)).toBe('red');
    });
});

describe('#1167 — DecisionCounter: "N aguardando sua decisão"', () => {
    it('renderiza o contador quando count > 0', () => {
        render(<DecisionCounter count={3} />);
        const el = screen.getByTestId('decision-counter');
        expect(el.textContent).toContain('3');
        expect(el.textContent).toContain('aguardando sua decisão');
        expect(el).toHaveAttribute('data-count', '3');
    });

    it('NÃO renderiza nada quando count <= 0 (não polui o header ocioso)', () => {
        const { container } = render(<DecisionCounter count={0} />);
        expect(container.firstChild).toBeNull();
        expect(screen.queryByTestId('decision-counter')).toBeNull();
    });

    it('usa singular no title quando há exatamente 1 task', () => {
        render(<DecisionCounter count={1} />);
        expect(screen.getByTestId('decision-counter').getAttribute('title')).toContain('task aguardando');
    });

    it('usa plural no title quando há mais de 1 task', () => {
        render(<DecisionCounter count={5} />);
        expect(screen.getByTestId('decision-counter').getAttribute('title')).toContain('tasks aguardando');
    });
});
