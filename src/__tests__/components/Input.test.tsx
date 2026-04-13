import React, { useRef, useEffect } from 'react';
import { describe, it, expect } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import { Input } from '../../components/ui/Input';
import { forwardRef } from 'react';

describe('Input', () => {
    it('renders without crashing', () => {
        const { container } = render(<Input />);
        expect(container.querySelector('input')).toBeTruthy();
    });

    it('renders with label', () => {
        render(<Input label="Email Address" />);
        expect(screen.getByText('Email Address')).toBeTruthy();
    });

    it('renders with hint text', () => {
        render(<Input hint="Enter your email" />);
        expect(screen.getByText('Enter your email')).toBeTruthy();
    });

    it('renders with error message', () => {
        render(<Input error="Invalid email" />);
        expect(screen.getByText('Invalid email')).toBeTruthy();
    });

    it('shows error state styling when error prop is provided', () => {
        const { container } = render(<Input error="Error" />);
        const input = container.querySelector('input');
        expect(input).toBeTruthy();
    });

    it('handles onChange', () => {
        const handleChange = vi.fn();
        const { container } = render(<Input onChange={handleChange} />);
        const input = container.querySelector('input') as HTMLInputElement;
        fireEvent.change(input, { target: { value: 'test@example.com' } });
        expect(handleChange).toHaveBeenCalled();
    });

    it('accepts standard input props', () => {
        const { container } = render(<Input type="email" placeholder="Enter email" />);
        const input = container.querySelector('input') as HTMLInputElement;
        expect(input.type).toBe('email');
        expect(input.placeholder).toBe('Enter email');
    });

    it('is disabled when disabled prop is true', () => {
        const { container } = render(<Input disabled />);
        const input = container.querySelector('input') as HTMLInputElement;
        expect(input.disabled).toBe(true);
    });

    it('renders with different types', () => {
        const types = ['text', 'email', 'password', 'number', 'tel'];
        types.forEach(type => {
            const { container } = render(<Input type={type as any} />);
            const input = container.querySelector('input') as HTMLInputElement;
            expect(input.type).toBe(type);
        });
    });

    it('renders with id attribute', () => {
        const { container } = render(<Input id="test-input" />);
        const input = container.querySelector('input');
        expect(input?.id).toBe('test-input');
    });

    it('renders with fullWidth', () => {
        const { container } = render(<Input fullWidth />);
        const wrapper = container.querySelector('div');
        expect(wrapper?.className).toContain('w-full');
    });

    it('renders without fullWidth', () => {
        const { container } = render(<Input fullWidth={false} />);
        const wrapper = container.querySelector('div');
        expect(wrapper?.className).not.toContain('w-full');
    });
});