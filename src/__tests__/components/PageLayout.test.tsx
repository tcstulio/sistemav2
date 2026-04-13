import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { PageLayout } from '../../components/ui/PageLayout';

describe('PageLayout', () => {
    it('renders children', () => {
        const { getByText } = render(<PageLayout><div>Content</div></PageLayout>);
        expect(getByText('Content')).toBeTruthy();
    });

    it('has role="main"', () => {
        const { container } = render(<PageLayout><div>Content</div></PageLayout>);
        expect(container.querySelector('[role="main"]')).toBeTruthy();
    });

    it('applies custom className', () => {
        const { container } = render(<PageLayout className="custom-layout"><div>Content</div></PageLayout>);
        expect(container.firstChild).toHaveClass('custom-layout');
    });

    it('applies title to aria-label', () => {
        const { container } = render(<PageLayout title="Test Page"><div>Content</div></PageLayout>);
        expect(container.querySelector('[aria-label="Test Page"]')).toBeTruthy();
    });

    it('renders with different maxWidth values', () => {
        const maxWidths = ['sm', 'md', 'lg', 'xl', '2xl', 'full'] as const;
        maxWidths.forEach(maxWidth => {
            const { container } = render(
                <PageLayout maxWidth={maxWidth}><div>Content</div></PageLayout>
            );
            expect(container.firstChild).toBeTruthy();
        });
    });

    it('renders without padding when noPadding is true', () => {
        const { container } = render(
            <PageLayout noPadding={true}><div>Content</div></PageLayout>
        );
        const innerDiv = container.querySelector('[role="main"]');
        expect(innerDiv?.className).not.toContain('p-4');
    });

    it('renders with default padding', () => {
        const { container } = render(<PageLayout><div>Content</div></PageLayout>);
        const innerDiv = container.querySelector('[role="main"]');
        expect(innerDiv?.className).toContain('p-');
    });
});