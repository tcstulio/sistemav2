import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Unit tests for the Playwright page object `ProposalListPage`.
 *
 * Playwright's `Page`/`Locator`/`expect` are mocked so we can verify the page
 * object's structural contract (inheritance, public API surface) and its
 * interaction sequences (which selectors are resolved and in which order)
 * without spinning up a browser. True end-to-end coverage lives in the
 * Playwright spec that consumes this page object.
 */

const { expectCalls } = vi.hoisted(() => ({
    expectCalls: [] as Array<{ matcher: string; arg?: unknown }>,
}));

vi.mock('@playwright/test', () => ({
    expect: () => ({
        toBeVisible: () => { expectCalls.push({ matcher: 'toBeVisible' }); },
        toContainText: (text: string) => { expectCalls.push({ matcher: 'toContainText', arg: text }); },
        toHaveCount: (n: number) => { expectCalls.push({ matcher: 'toHaveCount', arg: n }); },
        toHaveText: (text: string) => { expectCalls.push({ matcher: 'toHaveText', arg: text }); },
    }),
}));

import { CommercialBasePage } from '../../../tests/pages/CommercialBasePage';
import { ProposalListPage } from '../../../tests/pages/ProposalListPage';

interface InteractionLog {
    actions: string[];
    selectors: string[];
    locator: (selector: string) => MockLocator;
    page: MockPage;
}

interface MockLocator {
    selector: string;
    first: ReturnType<typeof vi.fn>;
    last: ReturnType<typeof vi.fn>;
    or: ReturnType<typeof vi.fn>;
    filter: ReturnType<typeof vi.fn>;
    locator: ReturnType<typeof vi.fn>;
    click: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
    waitFor: ReturnType<typeof vi.fn>;
    nth: ReturnType<typeof vi.fn>;
}

interface MockPage {
    goto: ReturnType<typeof vi.fn>;
    waitForLoadState: ReturnType<typeof vi.fn>;
    locator: ReturnType<(selector: string) => MockLocator>;
}

function createMockPage(): InteractionLog {
    const actions: string[] = [];
    const selectors: string[] = [];

    const makeLocator = (selector: string): MockLocator => {
        selectors.push(selector);
        const loc: MockLocator = {
            selector,
            first: vi.fn(() => loc),
            last: vi.fn(() => loc),
            or: vi.fn(() => loc),
            filter: vi.fn(() => loc),
            locator: vi.fn(() => loc),
            click: vi.fn(() => { actions.push(`click:${selector}`); return Promise.resolve(); }),
            count: vi.fn(() => Promise.resolve(1)),
            // Simulate "no confirmation dialog present" so convertToOrder's catch path runs.
            waitFor: vi.fn(() => Promise.reject(new Error('timeout'))),
            nth: vi.fn(() => loc),
        };
        return loc;
    };

    const page = {
        goto: vi.fn((url: string) => { actions.push(`goto:${url}`); return Promise.resolve({ status: () => 200 }); }),
        waitForLoadState: vi.fn((state: string) => { actions.push(`waitForLoadState:${state}`); return Promise.resolve(); }),
        locator: vi.fn((selector: string) => makeLocator(selector)),
    } as unknown as MockPage;

    return { actions, selectors, locator: makeLocator, page };
}

describe('ProposalListPage', () => {
    let log: InteractionLog;
    let pageObj: ProposalListPage;

    beforeEach(() => {
        expectCalls.length = 0;
        log = createMockPage();
        pageObj = new ProposalListPage(log.page as unknown as import('@playwright/test').Page);
    });

    describe('structural contract', () => {
        it('extends CommercialBasePage and exposes its helpers', () => {
            expect(pageObj).toBeInstanceOf(CommercialBasePage);
            expect(typeof pageObj.applyFilter).toBe('function');
            expect(typeof pageObj.clearFilters).toBe('function');
            expect(typeof pageObj.expectRowCount).toBe('function');
            expect(typeof pageObj.expectRowVisible).toBe('function');
        });

        it('declares the 5 required public methods', () => {
            expect(typeof pageObj.goto).toBe('function');
            expect(typeof pageObj.createForCustomer).toBe('function');
            expect(typeof pageObj.expectProposalInList).toBe('function');
            expect(typeof pageObj.convertToOrder).toBe('function');
            expect(typeof pageObj.expectStatus).toBe('function');
        });

        it('exposes the 4 required selectors (locator-returning)', () => {
            // newProposalButton is a getter
            const btn = pageObj.newProposalButton;
            expect(btn).toBeTruthy();
            expect(typeof btn.click).toBe('function');

            // proposalRow / statusBadge / convertToOrderButton are methods
            expect(pageObj.proposalRow('PR1')).toBeTruthy();
            expect(pageObj.statusBadge('PR1')).toBeTruthy();
            expect(pageObj.convertToOrderButton('PR1')).toBeTruthy();
        });
    });

    describe('goto()', () => {
        it('navigates to /proposals and waits for the network to settle', async () => {
            await pageObj.goto();

            expect(log.page.goto).toHaveBeenCalledWith('/proposals');
            expect(log.page.waitForLoadState).toHaveBeenCalledWith('networkidle');
        });
    });

    describe('createForCustomer()', () => {
        it('opens the form, selects the customer by id, submits and waits', async () => {
            await pageObj.createForCustomer('cust-42');

            // Four sequential clicks: Nova → customer trigger → option → submit.
            const clicks = log.actions.filter(a => a.startsWith('click:'));
            expect(clicks).toHaveLength(4);

            // The customer option selector must target the given id via data-value.
            expect(log.selectors.some(s => s.includes('[data-value="cust-42"]'))).toBe(true);

            // Form is submitted and the page waits for the list to reload.
            expect(log.page.waitForLoadState).toHaveBeenCalledWith('networkidle');
        });
    });

    describe('expectProposalInList()', () => {
        it('asserts the proposal row is visible', async () => {
            await pageObj.expectProposalInList('PR100');

            expect(expectCalls).toContainEqual({ matcher: 'toBeVisible' });
        });
    });

    describe('expectStatus()', () => {
        it('asserts the status badge contains the given status label', async () => {
            await pageObj.expectStatus('PR100', 'Assinada');

            expect(expectCalls).toContainEqual({ matcher: 'toContainText', arg: 'Assinada' });
        });
    });

    describe('convertToOrder()', () => {
        it('opens the detail, clicks convert and tolerates a missing confirm dialog', async () => {
            await pageObj.convertToOrder('PR7');

            // Row click + convert-button click.
            const clicks = log.actions.filter(a => a.startsWith('click:'));
            expect(clicks.length).toBeGreaterThanOrEqual(2);

            // Convert-to-order selector must be resolved at least once.
            expect(log.selectors.some(s => s.includes('convert-to-order') || s.includes('Criar Pedido'))).toBe(true);

            // Conversion always waits for the network to settle afterwards.
            expect(log.page.waitForLoadState).toHaveBeenCalledWith('networkidle');
        });
    });
});
