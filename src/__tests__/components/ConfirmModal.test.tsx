import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { ConfirmModal } from '../../components/ui/ConfirmModal';

describe('ConfirmModal', () => {
    const defaultProps = {
        isOpen: true,
        onClose: vi.fn(),
        onConfirm: vi.fn(),
        message: 'Are you sure?',
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders when isOpen is true', () => {
        const { container } = render(<ConfirmModal {...defaultProps} />);
        expect(container.querySelector('button')).toBeTruthy();
    });

    it('does not render when isOpen is false', () => {
        const { container } = render(<ConfirmModal {...defaultProps} isOpen={false} />);
        expect(container).toBeEmptyDOMElement();
    });

    it('renders with custom title', () => {
        const { container } = render(<ConfirmModal {...defaultProps} title="Delete Item" />);
        expect(container.textContent).toContain('Delete Item');
    });

    it('renders default title when not provided', () => {
        const { container } = render(<ConfirmModal {...defaultProps} />);
        expect(container.textContent).toContain('Confirmar');
    });

    it('renders two buttons', () => {
        const { container } = render(<ConfirmModal {...defaultProps} />);
        const buttons = container.querySelectorAll('button');
        expect(buttons.length).toBe(2);
    });

    it('renders message text', () => {
        const { container } = render(<ConfirmModal {...defaultProps} />);
        expect(container.textContent).toContain('Are you sure?');
    });

    it('renders with danger variant by default', () => {
        const { container } = render(<ConfirmModal {...defaultProps} />);
        expect(container.querySelector('[class*="red"]')).toBeTruthy();
    });

    it('renders with warning variant', () => {
        const { container } = render(<ConfirmModal {...defaultProps} variant="warning" />);
        expect(container.querySelector('[class*="amber"]')).toBeTruthy();
    });

    it('renders with info variant', () => {
        const { container } = render(<ConfirmModal {...defaultProps} variant="info" />);
        expect(container.querySelector('[class*="blue"]')).toBeTruthy();
    });
});