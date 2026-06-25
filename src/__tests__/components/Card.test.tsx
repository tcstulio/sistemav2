import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Card } from '../../components/ui/Card';

describe('Card', () => {
    it('renders children', () => {
        render(<Card>Card content</Card>);
        expect(screen.getByText('Card content')).toBeInTheDocument();
    });

    it('renders with header', () => {
        render(<Card header="Card Header">Content</Card>);
        expect(screen.getByText('Card Header')).toBeInTheDocument();
    });

    it('renders with footer', () => {
        render(<Card footer="Card Footer">Content</Card>);
        expect(screen.getByText('Card Footer')).toBeInTheDocument();
    });

    it('renders header and footer with content', () => {
        render(
            <Card header="Header" footer="Footer">
                <span>Middle</span>
            </Card>
        );
        expect(screen.getByText('Header')).toBeInTheDocument();
        expect(screen.getByText('Middle')).toBeInTheDocument();
        expect(screen.getByText('Footer')).toBeInTheDocument();
    });

    it('handles click when onClick provided', () => {
        const handleClick = vi.fn();
        render(<Card onClick={handleClick}>Clickable</Card>);
        fireEvent.click(screen.getByText('Clickable'));
        expect(handleClick).toHaveBeenCalled();
    });

    it('applies selected styling', () => {
        const { container } = render(<Card selected>Selected</Card>);
        expect(container.firstChild).toHaveClass('border-indigo-500');
    });

    it('applies hoverable styling', () => {
        const { container } = render(<Card hoverable>Hoverable</Card>);
        expect(container.firstChild).toHaveClass('hover:shadow-md');
    });

    // #822: Card clicável NÃO renderiza um <button> real — vira <div role="button">
    // para permitir botões de ação aninhados sem erro de hidratação.
    it('#822 expõe role="button" (e é um div, não <button>) quando onClick é fornecido', () => {
        const { container } = render(<Card onClick={() => {}}>Clickable Card</Card>);
        expect(screen.getByRole('button')).toBeInTheDocument();
        // Raiz é um <div>, não um <button> → evita button-dentro-de-button.
        expect(container.firstChild).not.toHaveProperty('tagName', 'BUTTON');
        expect((container.firstChild as HTMLElement).tagName).toBe('DIV');
        // Foco/teclado preservados.
        expect(container.firstChild).toHaveAttribute('tabindex', '0');
    });

    it('#822 é focável e ativável via teclado (Enter e Space)', () => {
        const handleClick = vi.fn();
        render(<Card onClick={handleClick}>Keyboard Card</Card>);
        const card = screen.getByRole('button');
        card.focus();
        expect(card).toHaveFocus();

        fireEvent.keyDown(card, { key: 'Enter' });
        expect(handleClick).toHaveBeenCalledTimes(1);

        fireEvent.keyDown(card, { key: ' ' });
        expect(handleClick).toHaveBeenCalledTimes(2);
    });

    it('#822 permite um <button> aninhado sem gerar button-dentro-de-button', () => {
        const { container } = render(
            <Card onClick={() => {}}>
                <button type="button">Ação</button>
            </Card>
        );
        // O card clicável não é um <button> real, então nenhum <button> é
        // descendente de outro <button> (causa do erro de hidratação).
        const nestedButtonButtons = container.querySelectorAll('button button');
        expect(nestedButtonButtons).toHaveLength(0);
        // O botão de ação interno (um <button> real) ainda está presente.
        const innerButton = container.querySelector('button');
        expect(innerButton).not.toBeNull();
        expect(innerButton?.textContent).toBe('Ação');
    });

    it('renders as div when no onClick', () => {
        const { container } = render(<Card>Div Card</Card>);
        expect(container.querySelector('div')).toBeInTheDocument();
    });

    it('applies custom className', () => {
        const { container } = render(<Card className="custom-class">Custom</Card>);
        expect(container.firstChild).toHaveClass('custom-class');
    });

});