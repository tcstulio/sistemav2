import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Toggle } from '../../components/Toggle';

describe('Toggle', () => {
    it('comeca no estado "Desligado"', () => {
        render(<Toggle />);
        expect(screen.getByText('Desligado')).toBeInTheDocument();
    });

    it('alterna para "Ligado" ao clicar', () => {
        render(<Toggle />);
        fireEvent.click(screen.getByRole('button'));
        expect(screen.getByText('Ligado')).toBeInTheDocument();
    });

    it('volta para "Desligado" ao clicar de novo', () => {
        render(<Toggle />);
        const button = screen.getByRole('button');
        fireEvent.click(button);
        expect(screen.getByText('Ligado')).toBeInTheDocument();
        fireEvent.click(button);
        expect(screen.getByText('Desligado')).toBeInTheDocument();
    });
});
