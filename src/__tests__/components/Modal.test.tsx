import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';

describe('Modal', () => {
    const defaultProps = {
        isOpen: true,
        onClose: vi.fn(),
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders when isOpen is true', () => {
        render(<Modal {...defaultProps}><p>Modal Content</p></Modal>);
        expect(screen.getByText('Modal Content')).toBeTruthy();
    });

    it('renders with title', () => {
        render(<Modal {...defaultProps} title="Modal Title"><p>Content</p></Modal>);
        expect(screen.getByText('Modal Title')).toBeTruthy();
    });

    it('renders footer when provided', () => {
        render(
            <Modal {...defaultProps} footer={<Button>Save</Button>}>
                <p>Content</p>
            </Modal>
        );
        expect(screen.getByText('Save')).toBeTruthy();
    });

    it('calls onClose when close button is clicked', () => {
        const handleClose = vi.fn();
        render(<Modal {...defaultProps} onClose={handleClose}><p>Content</p></Modal>);
        const closeButton = screen.getByRole('button', { name: /close modal/i });
        fireEvent.click(closeButton);
        expect(handleClose).toHaveBeenCalled();
    });

    it('renders and handles basic interaction', () => {
        const handleClose = vi.fn();
        render(<Modal {...defaultProps} onClose={handleClose}><p>Click me</p></Modal>);
        expect(screen.getByText('Click me')).toBeTruthy();
    });

    it('renders close button', () => {
        render(<Modal {...defaultProps}><p>Content</p></Modal>);
        expect(screen.getByRole('button', { name: /close modal/i })).toBeTruthy();
    });

    it('does not render when closed', () => {
        const { container } = render(<Modal {...defaultProps} isOpen={false}><p>Content</p></Modal>);
        expect(container).toBeEmptyDOMElement();
    });
});