import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ClickTarget, ClickTargetPrimary, ClickTargetSecondary } from '../../components/common/ClickTarget';

describe('ClickTarget — alvos de clique primário vs. secundário', () => {
    it('clicar no alvo primário chama SÓ o handler primário', async () => {
        const primarySpy = vi.fn();
        const secondarySpy = vi.fn();
        const user = userEvent.setup();

        render(
            <ClickTarget hoverable>
                <div className="flex justify-between">
                    <ClickTargetPrimary onClick={primarySpy} aria-label="Abrir fatura FA0001">
                        FA0001
                    </ClickTargetPrimary>
                    <ClickTargetSecondary>
                        <button type="button" onClick={secondarySpy}>
                            Ir para o cliente
                        </button>
                    </ClickTargetSecondary>
                </div>
            </ClickTarget>
        );

        await user.click(screen.getByRole('button', { name: 'Abrir fatura FA0001' }));

        expect(primarySpy).toHaveBeenCalledTimes(1);
        expect(secondarySpy).not.toHaveBeenCalled();
    });

    it('clicar num botão dentro do alvo secundário chama SÓ o handler secundário (não dispara o primário)', async () => {
        const primarySpy = vi.fn();
        const secondarySpy = vi.fn();
        const user = userEvent.setup();

        render(
            <ClickTarget hoverable>
                <div className="flex justify-between">
                    <ClickTargetPrimary onClick={primarySpy} aria-label="Abrir fatura FA0001">
                        FA0001
                    </ClickTargetPrimary>
                    <ClickTargetSecondary>
                        <button type="button" onClick={secondarySpy}>
                            Ir para o cliente
                        </button>
                    </ClickTargetSecondary>
                </div>
            </ClickTarget>
        );

        await user.click(screen.getByRole('button', { name: 'Ir para o cliente' }));

        expect(secondarySpy).toHaveBeenCalledTimes(1);
        expect(primarySpy).not.toHaveBeenCalled();
    });

    it('não renderiza <button> aninhado dentro de outro <button> (HTML válido)', () => {
        const { container } = render(
            <ClickTarget>
                <ClickTargetPrimary onClick={vi.fn()} aria-label="Abrir">
                    Abrir
                </ClickTargetPrimary>
                <ClickTargetSecondary>
                    <button type="button" onClick={vi.fn()}>
                        Secundário
                    </button>
                </ClickTargetSecondary>
            </ClickTarget>
        );

        const buttons = container.querySelectorAll('button');
        // Cada <button> deve ser filho direto/irmão (nenhum contém outro <button>).
        buttons.forEach((btn) => {
            expect(btn.querySelector('button')).toBeNull();
        });
    });
});
