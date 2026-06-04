import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { RichTextEditor } from '../../../components/ui/RichTextEditor';

describe('ui/RichTextEditor', () => {
    const defaultProps = {
        value: '',
        onChange: vi.fn(),
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders a contentEditable surface', () => {
        const { container } = render(<RichTextEditor {...defaultProps} />);
        expect(container.querySelector('[contenteditable]')).toBeTruthy();
    });

    it('renders the toolbar (bold, italic, list, link)', () => {
        const { container } = render(<RichTextEditor {...defaultProps} />);
        const buttons = container.querySelectorAll('button');
        expect(buttons.length).toBe(4);
    });

    it('exposes the placeholder via data-placeholder', () => {
        const { container } = render(
            <RichTextEditor {...defaultProps} placeholder="Descreva..." />
        );
        const editor = container.querySelector('[contenteditable]');
        expect(editor?.getAttribute('data-placeholder')).toBe('Descreva...');
    });

    it('applies custom className to the wrapper', () => {
        const { container } = render(
            <RichTextEditor {...defaultProps} className="custom-editor" />
        );
        expect(container.firstChild).toHaveClass('custom-editor');
    });

    it('renders allowed HTML from value', () => {
        const { container } = render(
            <RichTextEditor {...defaultProps} value="<b>Hello</b>" />
        );
        const editor = container.querySelector('[contenteditable]');
        expect(editor?.innerHTML).toContain('<b>Hello</b>');
    });

    it('sanitizes dangerous HTML before rendering into the editor', () => {
        const { container } = render(
            <RichTextEditor
                {...defaultProps}
                value={'<img src=x onerror="alert(1)"><script>alert(2)</script>'}
            />
        );
        const editor = container.querySelector('[contenteditable]');
        const html = editor?.innerHTML ?? '';
        expect(html).not.toContain('onerror');
        expect(html.toLowerCase()).not.toContain('<script');
    });
});
