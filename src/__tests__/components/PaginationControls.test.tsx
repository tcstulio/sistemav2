import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PaginationControls } from '../../components/common/PaginationControls';

describe('PaginationControls', () => {
    const mockOnPageChange = vi.fn();
    const mockOnLimitChange = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders page number', () => {
        render(
            <PaginationControls
                page={0}
                limit={10}
                onPageChange={mockOnPageChange}
                onLimitChange={mockOnLimitChange}
                hasNext={false}
            />
        );
        expect(screen.getByText('Pág 1')).toBeInTheDocument();
    });

    it('renders page number correctly for page 1', () => {
        render(
            <PaginationControls
                page={1}
                limit={10}
                onPageChange={mockOnPageChange}
                onLimitChange={mockOnLimitChange}
                hasNext={true}
            />
        );
        expect(screen.getByText('Pág 2')).toBeInTheDocument();
    });

    it('renders limit options', () => {
        render(
            <PaginationControls
                page={0}
                limit={10}
                onPageChange={mockOnPageChange}
                onLimitChange={mockOnLimitChange}
                hasNext={false}
            />
        );
        expect(screen.getByText('10 / pág')).toBeInTheDocument();
        expect(screen.getByText('20 / pág')).toBeInTheDocument();
        expect(screen.getByText('50 / pág')).toBeInTheDocument();
        expect(screen.getByText('100 / pág')).toBeInTheDocument();
    });

    it('calls onPageChange when clicking previous on page > 0', () => {
        render(
            <PaginationControls
                page={1}
                limit={10}
                onPageChange={mockOnPageChange}
                onLimitChange={mockOnLimitChange}
                hasPrev={true}
                hasNext={true}
            />
        );
        const buttons = screen.getAllByRole('button');
        fireEvent.click(buttons[0]);
        expect(mockOnPageChange).toHaveBeenCalledWith(0);
    });

    it('calls onPageChange when clicking next', () => {
        render(
            <PaginationControls
                page={0}
                limit={10}
                onPageChange={mockOnPageChange}
                onLimitChange={mockOnLimitChange}
                hasNext={true}
            />
        );
        const buttons = screen.getAllByRole('button');
        fireEvent.click(buttons[1]);
        expect(mockOnPageChange).toHaveBeenCalledWith(1);
    });

    it('disables previous button on first page', () => {
        render(
            <PaginationControls
                page={0}
                limit={10}
                onPageChange={mockOnPageChange}
                onLimitChange={mockOnLimitChange}
                hasPrev={undefined}
                hasNext={true}
            />
        );
        const buttons = screen.getAllByRole('button');
        expect(buttons[0]).toBeDisabled();
    });

    it('disables next button when hasNext is false', () => {
        render(
            <PaginationControls
                page={0}
                limit={10}
                onPageChange={mockOnPageChange}
                onLimitChange={mockOnLimitChange}
                hasNext={false}
            />
        );
        const buttons = screen.getAllByRole('button');
        expect(buttons[1]).toBeDisabled();
    });

    it('calls onLimitChange when changing limit', () => {
        render(
            <PaginationControls
                page={0}
                limit={10}
                onPageChange={mockOnPageChange}
                onLimitChange={mockOnLimitChange}
                hasNext={false}
            />
        );
        const select = screen.getByRole('combobox');
        fireEvent.change(select, { target: { value: '20' } });
        expect(mockOnLimitChange).toHaveBeenCalledWith(20);
    });

    it('accepts custom itemName prop without error', () => {
        render(
            <PaginationControls
                page={0}
                limit={10}
                onPageChange={mockOnPageChange}
                onLimitChange={mockOnLimitChange}
                hasNext={true}
                itemName="clientes"
            />
        );
        expect(screen.getByText('Pág 1')).toBeInTheDocument();
    });
});