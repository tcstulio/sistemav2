import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusBadge, StatusConfig } from '../../components/ui/StatusBadge';

describe('StatusBadge', () => {
    const invoiceStatuses: Record<string, StatusConfig> = {
        '0': { label: 'Rascunho', variant: 'slate' },
        '1': { label: 'A Pagar', variant: 'orange' },
        '2': { label: 'Pago', variant: 'emerald' },
    };

    it('renders with config matching status', () => {
        render(<StatusBadge status="1" config={invoiceStatuses} />);
        expect(screen.getByText('A Pagar')).toBeTruthy();
    });

    it('renders label from config', () => {
        render(<StatusBadge status="2" config={invoiceStatuses} />);
        expect(screen.getByText('Pago')).toBeTruthy();
    });

    it('renders unknown status as fallback', () => {
        render(<StatusBadge status="99" config={invoiceStatuses} />);
        expect(screen.getByText('99')).toBeTruthy();
    });

    it('renders with sm size', () => {
        const { container } = render(<StatusBadge status="1" config={invoiceStatuses} size="sm" />);
        expect(container.firstChild).toHaveClass('text-[10px]');
    });

    it('renders with md size (default)', () => {
        const { container } = render(<StatusBadge status="1" config={invoiceStatuses} />);
        expect(container.firstChild).toHaveClass('text-xs');
    });

    it('renders with custom className', () => {
        const { container } = render(<StatusBadge status="1" config={invoiceStatuses} className="custom-class" />);
        expect(container.firstChild).toHaveClass('custom-class');
    });

    it('renders with different variants', () => {
        const variants = ['slate', 'blue', 'emerald', 'orange', 'red', 'purple', 'indigo', 'amber', 'cyan'];
        variants.forEach(variant => {
            const config: Record<string, StatusConfig> = {
                '1': { label: 'Test', variant: variant as any },
            };
            const { container } = render(<StatusBadge status="1" config={config} />);
            expect(container.firstChild).toBeTruthy();
        });
    });

    it('handles numeric status values', () => {
        const numericConfig: Record<string, StatusConfig> = {
            '0': { label: 'Draft' },
            '1': { label: 'Active' },
        };
        render(<StatusBadge status={1} config={numericConfig} />);
        expect(screen.getByText('Active')).toBeTruthy();
    });

    it('renders with icon when provided in config', () => {
        const configWithIcon: Record<string, StatusConfig> = {
            '1': { label: 'With Icon', variant: 'blue', icon: <span data-testid="icon">X</span> },
        };
        render(<StatusBadge status="1" config={configWithIcon} />);
        expect(screen.getByTestId('icon')).toBeTruthy();
    });
});