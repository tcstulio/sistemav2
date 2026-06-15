import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Counter } from '../../components/Counter';

describe('Counter', () => {
    it('starts at 0', () => {
        render(<Counter />);
        expect(screen.getByText('Contador: 0')).toBeTruthy();
    });

    it('increments to 1 when button clicked', async () => {
        const user = userEvent.setup();
        render(<Counter />);
        await user.click(screen.getByRole('button', { name: 'Incrementar' }));
        expect(screen.getByText('Contador: 1')).toBeTruthy();
    });

    it('increments to 2 when clicked twice', async () => {
        const user = userEvent.setup();
        render(<Counter />);
        const button = screen.getByRole('button', { name: 'Incrementar' });
        await user.click(button);
        await user.click(button);
        expect(screen.getByText('Contador: 2')).toBeTruthy();
    });
});
