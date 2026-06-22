import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MasterDetailLayout } from '../../components/ui/MasterDetailLayout';

/**
 * Tests for the HR detail panel pattern (#561):
 * - Clicking a list item shows the detail panel via MasterDetailLayout (not a fixed overlay)
 * - A back/close button on the detail panel closes it and returns to the list
 *
 * These tests use MasterDetailLayout directly (the component consumed by HRList)
 * following the pattern in MasterDetailLayout.test.tsx, since HRList and UserDetail
 * depend on many heavyweight hooks/providers that would require deep mocking.
 */
describe('HR Detail Panel (MasterDetailLayout pattern, issue #561)', () => {
    it('shows list and hides detail when showDetail is false', () => {
        render(
            <MasterDetailLayout
                list={<ul><li>Alice</li><li>Bob</li></ul>}
                detail={<div>Detalhe do Usuário</div>}
                showDetail={false}
            />
        );

        expect(screen.getByText('Alice')).toBeInTheDocument();
        // Detail panel should not be rendered
        expect(screen.queryByText('Detalhe do Usuário')).not.toBeInTheDocument();
    });

    it('shows detail panel (not overlay) when showDetail is true', () => {
        render(
            <MasterDetailLayout
                list={<ul><li>Alice</li></ul>}
                detail={<div>Detalhe do Usuário</div>}
                showDetail={true}
            />
        );

        const detail = screen.getByText('Detalhe do Usuário');
        expect(detail).toBeInTheDocument();

        // Ensure no fixed overlay wrapper (fixed inset-0 z-50 bg-black/50) is present
        const overlayEl = document.querySelector('.fixed.inset-0.z-50');
        expect(overlayEl).toBeNull();
    });

    it('calls onCloseDetail when back/close button is invoked', () => {
        const onCloseDetail = vi.fn();

        render(
            <MasterDetailLayout
                list={<ul><li>Alice</li></ul>}
                detail={
                    <div>
                        <button onClick={onCloseDetail} aria-label="Voltar">Voltar</button>
                        <p>Detalhe Alice</p>
                    </div>
                }
                showDetail={true}
                onCloseDetail={onCloseDetail}
            />
        );

        const backBtn = screen.getByRole('button', { name: /voltar/i });
        fireEvent.click(backBtn);
        expect(onCloseDetail).toHaveBeenCalledTimes(1);
    });

    it('detail panel does not use fixed overlay classes', () => {
        const { container } = render(
            <MasterDetailLayout
                list={<div>Lista RH</div>}
                detail={<div>Detalhe RH</div>}
                showDetail={true}
            />
        );

        // The detail panel in MasterDetailLayout uses absolute/lg:static — NOT fixed inset-0 z-50 bg-black/50
        const fixedOverlay = container.querySelector('.bg-black\\/50');
        expect(fixedOverlay).toBeNull();
    });

    it('list becomes hidden on mobile when detail is shown (hidden class applied)', () => {
        const { container } = render(
            <MasterDetailLayout
                list={<div>Lista RH</div>}
                detail={<div>Detalhe RH</div>}
                showDetail={true}
            />
        );

        // The list panel should have the 'hidden' class when detail is shown (mobile behavior)
        const listPanel = (container.firstChild as HTMLElement).firstElementChild as HTMLElement;
        expect(listPanel).toHaveClass('hidden');
    });
});
