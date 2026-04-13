import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MasterDetailLayout } from '../../components/ui/MasterDetailLayout';

describe('MasterDetailLayout', () => {
    it('renders list content', () => {
        render(
            <MasterDetailLayout
                list={<div>List Content</div>}
                detail={<div>Detail Content</div>}
                showDetail={false}
            />
        );
        expect(screen.getByText('List Content')).toBeInTheDocument();
    });

    it('renders detail when showDetail is true', () => {
        render(
            <MasterDetailLayout
                list={<div>List Content</div>}
                detail={<div>Detail Content</div>}
                showDetail={true}
            />
        );
        expect(screen.getByText('Detail Content')).toBeInTheDocument();
    });

    it('does not render detail when showDetail is false', () => {
        render(
            <MasterDetailLayout
                list={<div>List Content</div>}
                detail={<div>Detail Content</div>}
                showDetail={false}
            />
        );
        expect(screen.queryByText('Detail Content')).not.toBeInTheDocument();
    });

    it('does not render detail when detail is undefined', () => {
        render(
            <MasterDetailLayout
                list={<div>List Content</div>}
                showDetail={true}
            />
        );
        expect(screen.queryByText('Selecione um item para ver detalhes')).toBeInTheDocument();
    });

    it('shows empty state when no detail on desktop', () => {
        render(
            <MasterDetailLayout
                list={<div>List Content</div>}
                showDetail={false}
            />
        );
        expect(screen.getByText('Selecione um item para ver detalhes')).toBeInTheDocument();
    });

    it('applies custom className', () => {
        const { container } = render(
            <MasterDetailLayout
                list={<div>List</div>}
                className="custom-class"
            />
        );
        expect(container.firstChild).toHaveClass('custom-class');
    });

    it('renders with listWidth prop', () => {
        const { container } = render(
            <MasterDetailLayout
                list={<div>List</div>}
                detail={<div>Detail</div>}
                showDetail={true}
                listWidth="1/2"
            />
        );
        expect(container.firstChild).toBeInTheDocument();
    });

});