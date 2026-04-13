import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Input } from '../../components/ui/Input';

describe('Input', () => {
    it('renders without label', () => {
        render(<Input placeholder="Enter text" />);
        expect(screen.getByPlaceholderText('Enter text')).toBeInTheDocument();
    });

    it('renders with label', () => {
        render(<Input label="Email" placeholder="email@example.com" />);
        expect(screen.getByText('Email')).toBeInTheDocument();
    });

    it('renders with hint', () => {
        render(<Input hint="Enter your email" />);
        expect(screen.getByText('Enter your email')).toBeInTheDocument();
    });

    it('renders with error', () => {
        render(<Input error="This field is required" />);
        expect(screen.getByText('This field is required')).toBeInTheDocument();
    });

    it('does not render hint when error is present', () => {
        render(<Input hint="Hint text" error="Error text" />);
        expect(screen.getByText('Error text')).toBeInTheDocument();
        expect(screen.queryByText('Hint text')).not.toBeInTheDocument();
    });

    it('handles text input', () => {
        render(<Input />);
        const input = screen.getByRole('textbox');
        input.focus();
        expect(document.activeElement).toBe(input);
    });

    it('applies fullWidth by default', () => {
        const { container } = render(<Input />);
        expect(container.querySelector('div')).toHaveClass('w-full');
    });

    it('renders with left icon', () => {
        render(<Input icon={<span>icon</span>} />);
        expect(screen.getByText('icon')).toBeInTheDocument();
    });

    it('renders with right icon', () => {
        render(<Input iconRight={<span>icon-right</span>} />);
        expect(screen.getByText('icon-right')).toBeInTheDocument();
    });
});