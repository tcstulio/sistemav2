import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../config/features', () => ({
    FEATURES: {
        TULIPA_ENABLED: true,
        CRM_SYNC_ENABLED: true,
    },
}));

vi.mock('../../services/tulipaService', () => ({
    tulipaService: {
        getPeople: vi.fn(),
        linkPersonToCustomer: vi.fn(),
    },
    BrainPerson: undefined,
}));

vi.mock('../../services/dolibarr', () => ({
    dolibarrService: {
        getThirdParty: vi.fn(),
        getThirdPartyByPhone: vi.fn(),
        searchThirdParty: vi.fn(),
        createThirdParty: vi.fn(),
    },
}));

import { syncService, SyncService } from '../../services/syncService';
import { tulipaService } from '../../services/tulipaService';
import { dolibarrService } from '../../services/dolibarr';
import { FEATURES } from '../../config/features';

describe('SyncService', () => {
    const mockPerson = {
        id: 'p1',
        name: 'John Doe',
        phone: '5511999999999',
        email: 'john@test.com',
        firstSeen: '2024-01-01',
        lastSeen: '2024-01-15',
        messageCount: 10,
        channels: ['whatsapp'],
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('isEnabled', () => {
        it('returns true when both features enabled', () => {
            (FEATURES as any).TULIPA_ENABLED = true;
            (FEATURES as any).CRM_SYNC_ENABLED = true;
            expect(syncService.isEnabled()).toBe(true);
        });

        it('returns false when TULIPA disabled', () => {
            (FEATURES as any).TULIPA_ENABLED = false;
            (FEATURES as any).CRM_SYNC_ENABLED = true;
            expect(syncService.isEnabled()).toBe(false);
        });

        it('returns false when CRM_SYNC disabled', () => {
            (FEATURES as any).TULIPA_ENABLED = true;
            (FEATURES as any).CRM_SYNC_ENABLED = false;
            expect(syncService.isEnabled()).toBe(false);
        });
    });

    describe('matchPerson', () => {
        it('matches by linked customer', async () => {
            const person = { ...mockPerson, linkedCustomerId: 'cust1' };
            (dolibarrService.getThirdParty as any).mockResolvedValue({ id: 'cust1', name: 'John' });

            const result = await syncService.matchPerson(person);
            expect(result.matchType).toBe('linked');
            expect(result.confidence).toBe('high');
        });

        it('falls through when linked customer not found', async () => {
            const person = { ...mockPerson, linkedCustomerId: 'cust1' };
            (dolibarrService.getThirdParty as any).mockResolvedValue(null);
            (dolibarrService.getThirdPartyByPhone as any).mockResolvedValue({ id: 'c2' });

            const result = await syncService.matchPerson(person);
            expect(result.matchType).toBe('phone');
        });

        it('matches by phone', async () => {
            (dolibarrService.getThirdPartyByPhone as any).mockResolvedValue({ id: 'c1' });

            const result = await syncService.matchPerson(mockPerson);
            expect(result.matchType).toBe('phone');
            expect(result.confidence).toBe('high');
        });

        it('matches by email with single result', async () => {
            (dolibarrService.getThirdPartyByPhone as any).mockResolvedValue(null);
            (dolibarrService.searchThirdParty as any).mockResolvedValue([{ id: 'c1' }]);

            const result = await syncService.matchPerson(mockPerson);
            expect(result.matchType).toBe('email');
        });

        it('skips email match with multiple results', async () => {
            (dolibarrService.getThirdPartyByPhone as any).mockResolvedValue(null);
            (dolibarrService.searchThirdParty as any).mockResolvedValue([{ id: 'c1' }]);

            const person = { ...mockPerson, email: undefined };
            const result = await syncService.matchPerson(person);
            expect(result.matchType).toBe('name');
        });

        it('matches by name with single result', async () => {
            (dolibarrService.getThirdPartyByPhone as any).mockResolvedValue(null);
            (dolibarrService.searchThirdParty as any).mockResolvedValue([{ id: 'c1' }]);

            const result = await syncService.matchPerson({ ...mockPerson, email: undefined });
            expect(result.matchType).toBe('name');
            expect(result.confidence).toBe('medium');
        });

        it('returns low confidence for multiple name matches', async () => {
            (dolibarrService.getThirdPartyByPhone as any).mockResolvedValue(null);
            (dolibarrService.searchThirdParty as any).mockResolvedValue([{ id: 'c1' }, { id: 'c2' }]);

            const result = await syncService.matchPerson({ ...mockPerson, email: undefined });
            expect(result.matchType).toBe('name');
            expect(result.confidence).toBe('low');
            expect(result.dolibarrCustomer).toBeNull();
        });

        it('returns none when no match found', async () => {
            (dolibarrService.getThirdPartyByPhone as any).mockResolvedValue(null);
            (dolibarrService.searchThirdParty as any).mockResolvedValue([]);

            const person = { ...mockPerson, email: undefined, name: undefined };
            const result = await syncService.matchPerson(person);
            expect(result.matchType).toBe('none');
            expect(result.confidence).toBe('none');
        });
    });

    describe('getPeopleWithMatches', () => {
        it('returns empty when TULIPA disabled', async () => {
            (FEATURES as any).TULIPA_ENABLED = false;
            const result = await syncService.getPeopleWithMatches();
            expect(result).toEqual([]);
        });

        it('returns matches for all people', async () => {
            (FEATURES as any).TULIPA_ENABLED = true;
            (tulipaService.getPeople as any).mockResolvedValue([mockPerson]);
            (dolibarrService.getThirdParty as any).mockResolvedValue(null);
            (dolibarrService.getThirdPartyByPhone as any).mockResolvedValue({ id: 'c1' });

            const result = await syncService.getPeopleWithMatches();
            expect(result).toHaveLength(1);
            expect(result[0].matchType).toBe('phone');
        });
    });

    describe('linkPersonToCustomer', () => {
        it('returns false when TULIPA disabled', async () => {
            (FEATURES as any).TULIPA_ENABLED = false;
            const result = await syncService.linkPersonToCustomer('p1', 'c1');
            expect(result).toBe(false);
        });

        it('links person successfully', async () => {
            (FEATURES as any).TULIPA_ENABLED = true;
            (tulipaService.linkPersonToCustomer as any).mockResolvedValue(true);

            const result = await syncService.linkPersonToCustomer('p1', 'c1');
            expect(result).toBe(true);
        });

        it('returns false on link failure', async () => {
            (FEATURES as any).TULIPA_ENABLED = true;
            (tulipaService.linkPersonToCustomer as any).mockResolvedValue(false);

            const result = await syncService.linkPersonToCustomer('p1', 'c1');
            expect(result).toBe(false);
        });
    });

    describe('createCustomerFromPerson', () => {
        it('creates customer and links', async () => {
            (dolibarrService.createThirdParty as any).mockResolvedValue({ id: 123 });
            (tulipaService.linkPersonToCustomer as any).mockResolvedValue(true);

            const result = await syncService.createCustomerFromPerson(mockPerson);
            expect(result).toBe('123');
        });

        it('returns null when creation fails', async () => {
            (dolibarrService.createThirdParty as any).mockResolvedValue(null);
            const result = await syncService.createCustomerFromPerson(mockPerson);
            expect(result).toBeNull();
        });

        it('returns null on error', async () => {
            (dolibarrService.createThirdParty as any).mockRejectedValue(new Error('DB error'));
            const result = await syncService.createCustomerFromPerson(mockPerson);
            expect(result).toBeNull();
        });
    });

    describe('syncAll', () => {
        beforeEach(() => {
            (FEATURES as any).TULIPA_ENABLED = true;
            (FEATURES as any).CRM_SYNC_ENABLED = true;
        });

        it('returns error when disabled', async () => {
            (FEATURES as any).TULIPA_ENABLED = false;
            (FEATURES as any).CRM_SYNC_ENABLED = false;

            const result = await syncService.syncAll();
            expect(result.success).toBe(false);
            expect(result.errors.length).toBeGreaterThan(0);
        });

        it('syncs with autoLink', async () => {
            (tulipaService.getPeople as any).mockResolvedValue([
                { ...mockPerson, linkedCustomerId: 'c1' },
            ]);
            (dolibarrService.getThirdParty as any).mockResolvedValue({ id: 'c1' });

            const result = await syncService.syncAll({ autoLink: true });
            expect(result.matched).toBe(1);
            expect(result.details).toHaveLength(1);
        });

        it('syncs with autoCreate for unmatched', async () => {
            (tulipaService.getPeople as any).mockResolvedValue([mockPerson]);
            (dolibarrService.getThirdParty as any).mockResolvedValue(null);
            (dolibarrService.getThirdPartyByPhone as any).mockResolvedValue(null);
            (dolibarrService.searchThirdParty as any).mockResolvedValue([]);
            (dolibarrService.createThirdParty as any).mockResolvedValue({ id: 456 });
            (tulipaService.linkPersonToCustomer as any).mockResolvedValue(true);

            const result = await syncService.syncAll({ autoCreate: true });
            expect(result.created).toBe(1);
        });

        it('handles person sync failure', async () => {
            (tulipaService.getPeople as any).mockResolvedValue([mockPerson]);
            (dolibarrService.getThirdParty as any).mockRejectedValue(new Error('DB error'));
            (dolibarrService.getThirdPartyByPhone as any).mockRejectedValue(new Error('DB error'));

            const result = await syncService.syncAll({ autoLink: true });
            expect(result.failed).toBe(1);
        });

        it('handles getPeople failure', async () => {
            (tulipaService.getPeople as any).mockRejectedValue(new Error('Tulipa error'));

            const result = await syncService.syncAll();
            expect(result.success).toBe(false);
        });

        it('skips when no autoLink/autoCreate', async () => {
            (tulipaService.getPeople as any).mockResolvedValue([mockPerson]);
            (dolibarrService.getThirdParty as any).mockResolvedValue(null);
            (dolibarrService.getThirdPartyByPhone as any).mockResolvedValue(null);
            (dolibarrService.searchThirdParty as any).mockResolvedValue([]);

            const result = await syncService.syncAll();
            expect(result.details[0].action).toBe('skipped');
        });
    });

    describe('getSyncStatus', () => {
        it('returns disabled when TULIPA disabled', async () => {
            (FEATURES as any).TULIPA_ENABLED = false;
            const status = await syncService.getSyncStatus();
            expect(status.enabled).toBe(false);
        });

        it('returns status with counts', async () => {
            (FEATURES as any).TULIPA_ENABLED = true;
            (FEATURES as any).CRM_SYNC_ENABLED = true;
            (tulipaService.getPeople as any).mockResolvedValue([
                { ...mockPerson, linkedCustomerId: 'c1' },
                mockPerson,
            ]);

            const status = await syncService.getSyncStatus();
            expect(status.enabled).toBe(true);
            expect(status.totalPeople).toBe(2);
            expect(status.linkedPeople).toBe(1);
            expect(status.unlinkedPeople).toBe(1);
        });

        it('handles error gracefully', async () => {
            (FEATURES as any).TULIPA_ENABLED = true;
            (FEATURES as any).CRM_SYNC_ENABLED = true;
            (tulipaService.getPeople as any).mockRejectedValue(new Error('fail'));

            const status = await syncService.getSyncStatus();
            expect(status.totalPeople).toBe(0);
        });
    });
});
