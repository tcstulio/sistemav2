import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PaginationControls } from '../../components/common/PaginationControls';

describe('PaginationControls', () => {
    const defaultProps = {
        page: 0,
        limit: 20,
        onPageChange: vi.fn(),
        onLimitChange: vi.fn(),
        hasNext: true,
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders page info', () => {
        render(<PaginationControls {...defaultProps} />);
        expect(screen.getByText('Pág 1')).toBeTruthy();
    });

    it('renders limit selector', () => {
        const { container } = render(<PaginationControls {...defaultProps} />);
        const select = container.querySelector('select');
        expect(select).toBeTruthy();
    });

    it('renders with default limit of 20', () => {
        const { container } = render(<PaginationControls {...defaultProps} />);
        const select = container.querySelector('select') as HTMLSelectElement;
        expect(select.value).toBe('20');
    });

    it('calls onLimitChange when limit changes', () => {
        render(<PaginationControls {...defaultProps} />);
        const select = screen.getByRole('combobox');
        fireEvent.change(select, { target: { value: '50' } });
        expect(defaultProps.onLimitChange).toHaveBeenCalledWith(50);
    });

    it('disables prev button on first page', () => {
        render(<PaginationControls {...defaultProps} page={0} />);
        const buttons = screen.getAllByRole('button');
        expect(buttons[0]).toBeDisabled();
    });

    it('disables next button when hasNext is false', () => {
        render(<PaginationControls {...defaultProps} hasNext={false} />);
        const buttons = screen.getAllByRole('button');
        expect(buttons[1]).toBeDisabled();
    });

    it('renders different limit options', () => {
        const { container } = render(<PaginationControls {...defaultProps} />);
        const select = container.querySelector('select') as HTMLSelectElement;
        const options = select.querySelectorAll('option');
        expect(options.length).toBe(4);
    });

    it('calls onPageChange when page changes', () => {
        const onPageChange = vi.fn();
        render(<PaginationControls {...defaultProps} page={1} onPageChange={onPageChange} />);
        const buttons = screen.getAllByRole('button');
        fireEvent.click(buttons[0]);
        expect(onPageChange).toHaveBeenCalledWith(0);
    });
});