import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { ConfirmModal } from '../../components/ui/ConfirmModal';

// O Modal usa createPortal (renderiza em document.body), então inspecionamos `baseElement`
// (= document.body, inclui o portal) em vez de `container` (subárvore do render, agora vazia).
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
        const { baseElement } = render(<ConfirmModal {...defaultProps} />);
        expect(baseElement.querySelector('button')).toBeTruthy();
    });

    it('does not render when isOpen is false', () => {
        const { container } = render(<ConfirmModal {...defaultProps} isOpen={false} />);
        expect(container).toBeEmptyDOMElement();
    });

    it('renders with custom title', () => {
        const { baseElement } = render(<ConfirmModal {...defaultProps} title="Delete Item" />);
        expect(baseElement.textContent).toContain('Delete Item');
    });

    it('renders default title when not provided', () => {
        const { baseElement } = render(<ConfirmModal {...defaultProps} />);
        expect(baseElement.textContent).toContain('Confirmar');
    });

    it('renders two buttons', () => {
        const { baseElement } = render(<ConfirmModal {...defaultProps} />);
        const buttons = baseElement.querySelectorAll('button');
        expect(buttons.length).toBe(2);
    });

    it('renders message text', () => {
        const { baseElement } = render(<ConfirmModal {...defaultProps} />);
        expect(baseElement.textContent).toContain('Are you sure?');
    });

    it('renders with danger variant by default', () => {
        const { baseElement } = render(<ConfirmModal {...defaultProps} />);
        expect(baseElement.querySelector('[class*="red"]')).toBeTruthy();
    });

    it('renders with warning variant', () => {
        const { baseElement } = render(<ConfirmModal {...defaultProps} variant="warning" />);
        expect(baseElement.querySelector('[class*="amber"]')).toBeTruthy();
    });

    it('renders with info variant', () => {
        const { baseElement } = render(<ConfirmModal {...defaultProps} variant="info" />);
        expect(baseElement.querySelector('[class*="blue"]')).toBeTruthy();
    });
});
