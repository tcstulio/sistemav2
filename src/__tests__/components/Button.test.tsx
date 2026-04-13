import { describe, it, expect } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { Button } from '../../components/ui/Button';

describe('Button', () => {
    it('renders children', () => {
        const { getByRole } = render(<Button>Click me</Button>);
        expect(getByRole('button', { name: 'Click me' })).toBeTruthy();
    });

    it('applies variant classes', () => {
        const { getByRole } = render(<Button variant="primary">Primary</Button>);
        const button = getByRole('button');
        expect(button.className).toContain('bg-indigo-600');
    });

    it('applies size classes', () => {
        const { getByRole } = render(<Button size="sm">Small</Button>);
        const button = getByRole('button');
        expect(button.className).toContain('sm');
    });

    it('is disabled when disabled prop is true', () => {
        const { getByRole } = render(<Button disabled>Disabled</Button>);
        expect(getByRole('button')).toBeDisabled();
    });

    it('calls onClick when clicked', () => {
        const handleClick = vi.fn();
        const { getByRole } = render(<Button onClick={handleClick}>Click</Button>);
        fireEvent.click(getByRole('button'));
        expect(handleClick).toHaveBeenCalledTimes(1);
    });

    it('renders with fullWidth', () => {
        const { getByRole } = render(<Button fullWidth>Wide</Button>);
        const button = getByRole('button');
        expect(button.className).toContain('w-full');
    });

    it('renders primary variant', () => {
        const { getByRole } = render(<Button variant="primary">Primary</Button>);
        expect(getByRole('button')).toBeTruthy();
    });

    it('renders secondary variant', () => {
        const { getByRole } = render(<Button variant="secondary">Secondary</Button>);
        expect(getByRole('button')).toBeTruthy();
    });

    it('renders ghost variant', () => {
        const { getByRole } = render(<Button variant="ghost">Ghost</Button>);
        expect(getByRole('button')).toBeTruthy();
    });

    it('renders danger variant', () => {
        const { getByRole } = render(<Button variant="danger">Danger</Button>);
        expect(getByRole('button')).toBeTruthy();
    });

    it('renders outline variant', () => {
        const { getByRole } = render(<Button variant="outline">Outline</Button>);
        expect(getByRole('button')).toBeTruthy();
    });
});