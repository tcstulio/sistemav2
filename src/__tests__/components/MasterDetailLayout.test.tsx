import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MasterDetailLayout } from '../../components/ui/MasterDetailLayout';

describe('MasterDetailLayout', () => {
    it('renders list content', () => {
        render(
            <MasterDetailLayout
                list={<div data-testid="list">List Content</div>}
            />
        );
        expect(screen.getByTestId('list')).toBeTruthy();
    });

    it('renders detail content when showDetail is true', () => {
        render(
            <MasterDetailLayout
                list={<div data-testid="list">List</div>}
                detail={<div data-testid="detail">Detail Content</div>}
                showDetail={true}
            />
        );
        expect(screen.getByTestId('detail')).toBeTruthy();
    });

    it('does not render detail when showDetail is false', () => {
        render(
            <MasterDetailLayout
                list={<div data-testid="list">List</div>}
                detail={<div data-testid="detail">Detail</div>}
                showDetail={false}
            />
        );
        expect(screen.queryByTestId('detail')).toBeNull();
    });

    it('shows empty state when no detail selected on desktop', () => {
        render(
            <MasterDetailLayout
                list={<div data-testid="list">List</div>}
                showDetail={false}
            />
        );
        expect(screen.getByText(/Selecione um item/)).toBeTruthy();
    });

    it('accepts listWidth prop', () => {
        const { container } = render(
            <MasterDetailLayout
                list={<div data-testid="list">List</div>}
                detail={<div data-testid="detail">Detail</div>}
                showDetail={true}
                listWidth="1/2"
            />
        );
        expect(container.firstChild).toBeTruthy();
    });

    it('accepts custom className', () => {
        const { container } = render(
            <MasterDetailLayout
                list={<div data-testid="list">List</div>}
                className="custom-layout"
            />
        );
        expect(container.firstChild).toHaveClass('custom-layout');
    });

    it('accepts hideListOnDetail prop', () => {
        const { container } = render(
            <MasterDetailLayout
                list={<div data-testid="list">List</div>}
                detail={<div data-testid="detail">Detail</div>}
                showDetail={true}
                hideListOnDetail={true}
            />
        );
        expect(container.firstChild).toBeTruthy();
    });
});