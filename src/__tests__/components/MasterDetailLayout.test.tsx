import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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

    it('list panel resolves height via min-h-0 (#651)', () => {
        const { container } = render(
            <MasterDetailLayout
                list={<div>List</div>}
                showDetail={false}
            />
        );
        // The list panel is the first child of the outer flex container and must
        // carry min-h-0 so the flex chain yields a resolved height for virtualized lists.
        const listPanel = (container.firstChild as HTMLElement).firstElementChild as HTMLElement;
        expect(listPanel).toBeTruthy();
        expect(listPanel).toHaveClass('min-h-0');
        expect(listPanel).toHaveClass('flex-1');
        expect(listPanel).toHaveClass('overflow-y-auto');
    });

    // --- Responsividade (#557) ---

    it('root container has class relative for correct absolute-panel anchoring (#557)', () => {
        const { container } = render(
            <MasterDetailLayout
                list={<div>List</div>}
                detail={<div>Detail</div>}
                showDetail={true}
            />
        );
        expect(container.firstChild).toHaveClass('relative');
    });

    it('detail panel has absolute inset-0 positioning classes on mobile (#557)', () => {
        const { container } = render(
            <MasterDetailLayout
                list={<div>List</div>}
                detail={<div>Detail</div>}
                showDetail={true}
            />
        );
        // Detail panel is the second child of the root when showDetail=true (first is list panel)
        const root = container.firstChild as HTMLElement;
        const detailPanel = root.children[1] as HTMLElement;
        expect(detailPanel).toHaveClass('absolute');
        expect(detailPanel).toHaveClass('inset-0');
        expect(detailPanel).toHaveClass('z-20');
    });

    it('detail panel switches to static on desktop (lg:static lg:inset-auto lg:z-auto) (#557)', () => {
        const { container } = render(
            <MasterDetailLayout
                list={<div>List</div>}
                detail={<div>Detail</div>}
                showDetail={true}
            />
        );
        const root = container.firstChild as HTMLElement;
        const detailPanel = root.children[1] as HTMLElement;
        // Tailwind responsive classes are present in the className string even if not applied by JSDOM
        expect(detailPanel.className).toContain('lg:static');
        expect(detailPanel.className).toContain('lg:inset-auto');
        expect(detailPanel.className).toContain('lg:z-auto');
    });

    it('calls onCloseDetail when close button inside detail is clicked (#557)', () => {
        const onCloseDetail = vi.fn();
        render(
            <MasterDetailLayout
                list={<div>List</div>}
                detail={
                    <button onClick={onCloseDetail} aria-label="Fechar">
                        Fechar
                    </button>
                }
                showDetail={true}
                onCloseDetail={onCloseDetail}
            />
        );
        fireEvent.click(screen.getByRole('button', { name: /fechar/i }));
        expect(onCloseDetail).toHaveBeenCalledTimes(1);
    });

});