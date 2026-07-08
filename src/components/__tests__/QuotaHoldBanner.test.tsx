/**
 * Testes do banner de quota-hold / peak-hold (#1167).
 *
 * Cobrem:
 *  - helpers puros `isAnyHoldActive` e `formatHoldSince`
 *  - o componente apresentacional `QuotaHoldBannerContent` (quando aparece e o que mostra)
 *
 * O container que faz o fetch (QuotaHoldBanner) é coberto indiretamente pelo teste de integração
 * do IssuesPage; aqui isolamos a lógica de apresentação (determinística, sem rede).
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
    QuotaHoldBannerContent,
    isAnyHoldActive,
    formatHoldSince,
    type QuotaStatus,
} from '../QuotaHoldBanner';

const OFF: QuotaStatus = { exhausted: false, since: null, reason: '', peakHold: false };

describe('#1167 — isAnyHoldActive', () => {
    it('false quando nada está ativo (ou null/undefined)', () => {
        expect(isAnyHoldActive(OFF)).toBe(false);
        expect(isAnyHoldActive(null)).toBe(false);
        expect(isAnyHoldActive(undefined)).toBe(false);
    });

    it('true quando quota esgotada', () => {
        expect(isAnyHoldActive({ ...OFF, exhausted: true, reason: '429' })).toBe(true);
    });

    it('true quando peak-hold', () => {
        expect(isAnyHoldActive({ ...OFF, peakHold: true })).toBe(true);
    });
});

describe('#1167 — formatHoldSince', () => {
    const NOW = 1_700_000_000_000; // epoch ms fixo p/ teste determinístico

    it('null quando since ausente/inválido', () => {
        expect(formatHoldSince(null)).toBeNull();
        expect(formatHoldSince(NaN)).toBeNull();
    });

    it('"agora" para diferença < 1min', () => {
        expect(formatHoldSince(NOW - 30_000, NOW)).toBe('agora');
    });

    it('"há Nmin" para minutos', () => {
        expect(formatHoldSince(NOW - 5 * 60_000, NOW)).toBe('há 5min');
    });

    it('"há Nh" para horas cheias', () => {
        expect(formatHoldSince(NOW - 2 * 3600_000, NOW)).toBe('há 2h');
    });

    it('"há NhMmin" para horas + minutos', () => {
        expect(formatHoldSince(NOW - (2 * 3600_000 + 15 * 60_000), NOW)).toBe('há 2h15min');
    });
});

describe('#1167 — QuotaHoldBannerContent (apresentação)', () => {
    it('NÃO renderiza nada quando nenhum hold está ativo', () => {
        const { container } = render(<QuotaHoldBannerContent status={OFF} />);
        expect(container.firstChild).toBeNull();
        expect(screen.queryByTestId('quota-hold-banner')).toBeNull();
    });

    it('NÃO renderiza quando status é null', () => {
        const { container } = render(<QuotaHoldBannerContent status={null} />);
        expect(container.firstChild).toBeNull();
    });

    it('renderiza SÓ a linha de quota esgotada (com motivo e "há Nmin")', () => {
        const since = Date.now() - 10 * 60_000;
        render(<QuotaHoldBannerContent status={{ exhausted: true, since, reason: 'HTTP 429 Too Many Requests', peakHold: false }} now={Date.now()} />);
        const banner = screen.getByTestId('quota-hold-banner');
        expect(banner).toHaveAttribute('data-exhausted', 'true');
        expect(banner).toHaveAttribute('data-peak-hold', 'false');
        expect(screen.getByTestId('quota-exhausted-row').textContent).toContain('Cota de LLM esgotada');
        expect(screen.getByTestId('quota-exhausted-row').textContent).toContain('429');
        expect(screen.getByTestId('quota-exhausted-row').textContent).toContain('há 10min');
        expect(screen.queryByTestId('peak-hold-row')).toBeNull();
    });

    it('renderiza SÓ a linha de peak-hold quando só ele está ativo', () => {
        render(<QuotaHoldBannerContent status={{ exhausted: false, since: null, reason: '', peakHold: true }} />);
        const banner = screen.getByTestId('quota-hold-banner');
        expect(banner).toHaveAttribute('data-peak-hold', 'true');
        expect(banner).toHaveAttribute('data-exhausted', 'false');
        expect(screen.getByTestId('peak-hold-row').textContent).toContain('Hold de pico');
        expect(screen.queryByTestId('quota-exhausted-row')).toBeNull();
    });

    it('renderiza AMBAS as linhas quando quota + peak coexistem', () => {
        render(<QuotaHoldBannerContent status={{ exhausted: true, since: Date.now() - 60_000, reason: 'sem saldo', peakHold: true }} now={Date.now()} />);
        expect(screen.getByTestId('quota-exhausted-row')).toBeTruthy();
        expect(screen.getByTestId('peak-hold-row')).toBeTruthy();
    });

    it('linha de quota sem reason não mostra o bloco "Motivo:"', () => {
        render(<QuotaHoldBannerContent status={{ exhausted: true, since: null, reason: '', peakHold: false }} />);
        expect(screen.getByTestId('quota-exhausted-row').textContent).not.toContain('Motivo:');
    });
});
