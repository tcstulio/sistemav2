import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RichTextEditor } from '../../components/common/RichTextEditor';

describe('RichTextEditor', () => {
    const defaultProps = {
        value: '',
        onChange: vi.fn(),
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders', () => {
        const { container } = render(<RichTextEditor {...defaultProps} />);
        expect(container.querySelector('[contenteditable]')).toBeTruthy();
    });

    it('renders with placeholder', () => {
        const { container } = render(
            <RichTextEditor {...defaultProps} placeholder="Enter text..." />
        );
        const editor = container.querySelector('[contenteditable]');
        expect(editor).toBeTruthy();
    });

    it('applies custom className', () => {
        const { container } = render(
            <RichTextEditor {...defaultProps} className="custom-editor" />
        );
        expect(container.firstChild).toHaveClass('custom-editor');
    });

    it('renders toolbar buttons', () => {
        const { container } = render(<RichTextEditor {...defaultProps} />);
        const buttons = container.querySelectorAll('button');
        expect(buttons.length).toBeGreaterThanOrEqual(4);
    });

    it('renders with initial value', () => {
        const { container } = render(
            <RichTextEditor {...defaultProps} value="<p>Hello</p>" />
        );
        const editor = container.querySelector('[contenteditable]');
        expect(editor).toBeTruthy();
    });
});