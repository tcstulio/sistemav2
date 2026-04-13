import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Tabs, Tab } from '../../components/ui/Tabs';

describe('Tabs', () => {
    it('renders children (Tab components)', () => {
        const handleChange = vi.fn();
        render(
            <Tabs value="tab1" onChange={handleChange}>
                <Tab value="tab1">Tab One</Tab>
                <Tab value="tab2">Tab Two</Tab>
            </Tabs>
        );
        expect(screen.getByText('Tab One')).toBeTruthy();
        expect(screen.getByText('Tab Two')).toBeTruthy();
    });

    it('marks active tab based on value prop', () => {
        const handleChange = vi.fn();
        const { getByText } = render(
            <Tabs value="tab1" onChange={handleChange}>
                <Tab value="tab1">Tab One</Tab>
                <Tab value="tab2">Tab Two</Tab>
            </Tabs>
        );
        expect(getByText('Tab One').closest('button')).toHaveClass('border-indigo-600');
    });

    it('calls onChange when tab is clicked', () => {
        const handleChange = vi.fn();
        const { getByText } = render(
            <Tabs value="tab1" onChange={handleChange}>
                <Tab value="tab1">Tab One</Tab>
                <Tab value="tab2">Tab Two</Tab>
            </Tabs>
        );
        fireEvent.click(getByText('Tab Two'));
        expect(handleChange).toHaveBeenCalledWith('tab2');
    });

    it('does not call onChange when disabled tab is clicked', () => {
        const handleChange = vi.fn();
        const { getByText } = render(
            <Tabs value="tab1" onChange={handleChange}>
                <Tab value="tab1">Tab One</Tab>
                <Tab value="tab2" disabled>Tab Two</Tab>
            </Tabs>
        );
        fireEvent.click(getByText('Tab Two'));
        expect(handleChange).not.toHaveBeenCalled();
    });

    it('renders badge on tab', () => {
        const handleChange = vi.fn();
        const { getByText } = render(
            <Tabs value="tab1" onChange={handleChange}>
                <Tab value="tab1">Tab One</Tab>
                <Tab value="tab2" badge={5}>Tab Two</Tab>
            </Tabs>
        );
        expect(getByText('5')).toBeTruthy();
    });

    it('renders with custom className', () => {
        const handleChange = vi.fn();
        const { container } = render(
            <Tabs value="tab1" onChange={handleChange} className="custom-tabs">
                <Tab value="tab1">Tab One</Tab>
            </Tabs>
        );
        expect(container.firstChild).toHaveClass('custom-tabs');
    });

    it('renders multiple tabs with different active states', () => {
        const handleChange = vi.fn();
        const { getByText } = render(
            <Tabs value="tab2" onChange={handleChange}>
                <Tab value="tab1">Tab One</Tab>
                <Tab value="tab2">Tab Two</Tab>
                <Tab value="tab3">Tab Three</Tab>
            </Tabs>
        );
        expect(getByText('Tab Two').closest('button')).toHaveClass('border-indigo-600');
        expect(getByText('Tab One').closest('button')).not.toHaveClass('border-indigo-600');
    });
});

describe('Tab', () => {
    it('renders children as label', () => {
        render(<Tab value="test">Test Tab</Tab>);
        expect(screen.getByText('Test Tab')).toBeTruthy();
    });

    it('renders disabled state', () => {
        const { getByText } = render(<Tab value="test" disabled>Disabled Tab</Tab>);
        expect(getByText('Disabled Tab').closest('button')).toBeDisabled();
    });

    it('renders with badge', () => {
        const { getByText } = render(<Tab value="test" badge={10}>Badge Tab</Tab>);
        expect(getByText('10')).toBeTruthy();
    });
});