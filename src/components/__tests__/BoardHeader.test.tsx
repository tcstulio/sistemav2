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
import { DailyRoundsBudgetBar, budgetTone } from '../BoardHeader';

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
