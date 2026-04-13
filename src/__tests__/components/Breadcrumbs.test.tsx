import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Breadcrumbs, usePageTitle } from '../../components/ui/Breadcrumbs';
import { MemoryRouter } from 'react-router-dom';
import { renderHook } from '@testing-library/react';

describe('Breadcrumbs', () => {
    it('renders with MemoryRouter', () => {
        render(
            <MemoryRouter initialEntries={['/customers']}>
                <Breadcrumbs />
            </MemoryRouter>
        );
        expect(document.body.textContent).toBeTruthy();
    });

    it('renders custom items', () => {
        render(
            <MemoryRouter>
                <Breadcrumbs
                    customItems={[
                        { label: 'Home', path: '/', isLast: false },
                        { label: 'Customers', path: '/customers', isLast: true },
                    ]}
                />
            </MemoryRouter>
        );
        expect(screen.getByText('Home')).toBeTruthy();
        expect(screen.getByText('Customers')).toBeTruthy();
    });

    it('shows home link when showHome is true', () => {
        render(
            <MemoryRouter initialEntries={['/customers']}>
                <Breadcrumbs showHome={true} />
            </MemoryRouter>
        );
        const homeLink = document.querySelector('a[href="/"]');
        expect(homeLink).toBeTruthy();
    });

    it('hides home link when showHome is false', () => {
        render(
            <MemoryRouter initialEntries={['/customers']}>
                <Breadcrumbs showHome={false} />
            </MemoryRouter>
        );
        const homeLink = document.querySelector('a[href="/"]');
        expect(homeLink).toBeNull();
    });

    it('renders last item as span (not link)', () => {
        render(
            <MemoryRouter>
                <Breadcrumbs
                    customItems={[
                        { label: 'Home', path: '/', isLast: false },
                        { label: 'Current', path: '/current', isLast: true },
                    ]}
                />
            </MemoryRouter>
        );
        expect(screen.getByText('Current').tagName).toBe('SPAN');
    });

    it('returns null on dashboard route', () => {
        const { container } = render(
            <MemoryRouter initialEntries={['/']}>
                <Breadcrumbs />
            </MemoryRouter>
        );
        expect(container.firstChild).toBeNull();
    });
});

describe('usePageTitle', () => {
    it('returns Dashboard for root path', () => {
        const { result } = renderHook(() => usePageTitle(), {
            wrapper: ({ children }) => (
                <MemoryRouter initialEntries={['/']}>
                    {children}
                </MemoryRouter>
            ),
        });
        expect(result.current).toBe('Dashboard');
    });

    it('returns label for known route', () => {
        const { result } = renderHook(() => usePageTitle(), {
            wrapper: ({ children }) => (
                <MemoryRouter initialEntries={['/customers']}>
                    {children}
                </MemoryRouter>
            ),
        });
        expect(result.current).toBe('Clientes');
    });
});