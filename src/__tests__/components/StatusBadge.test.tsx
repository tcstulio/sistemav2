import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusBadge } from '../../components/ui/StatusBadge';

describe('StatusBadge', () => {
    const mockConfig = {
        '0': { label: 'Rascunho', variant: 'slate' as const },
        '1': { label: 'A Pagar', variant: 'orange' as const },
        '2': { label: 'Pago', variant: 'emerald' as const },
    };

    it('renders label from config', () => {
        render(<StatusBadge status="1" config={mockConfig} />);
        expect(screen.getByText('A Pagar')).toBeInTheDocument();
    });

    it('renders default key when status not in config', () => {
        render(<StatusBadge status="99" config={mockConfig} />);
        expect(screen.getByText('99')).toBeInTheDocument();
    });

    it('renders multiple statuses', () => {
        render(<StatusBadge status={0} config={mockConfig} />);
        expect(screen.getByText('Rascunho')).toBeInTheDocument();
    });

    it('renders with string status', () => {
        render(<StatusBadge status="2" config={mockConfig} />);
        expect(screen.getByText('Pago')).toBeInTheDocument();
    });

    it('renders empty config', () => {
        render(<StatusBadge status="test" config={{}} />);
        expect(screen.getByText('test')).toBeInTheDocument();
    });
});