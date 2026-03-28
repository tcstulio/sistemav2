/**
 * Sync Service
 *
 * Sincronização entre Brain Hub (Tulipa) e Dolibarr CRM.
 * Permite vincular pessoas do Brain Hub a clientes do Dolibarr.
 *
 * @see docs/MOLTBOT_INTEGRATION_PLAN.md
 */

import { FEATURES } from '../config/features';
import { tulipaService, BrainPerson } from './tulipaService';
import { dolibarrService } from './dolibarr';

// Types
export interface SyncResult {
    success: boolean;
    matched: number;
    created: number;
    updated: number;
    failed: number;
    errors: string[];
    details: SyncDetail[];
}

export interface SyncDetail {
    brainId: string;
    brainName: string;
    phone?: string;
    action: 'matched' | 'created' | 'updated' | 'failed' | 'skipped';
    dolibarrId?: string;
    error?: string;
}

export interface MatchResult {
    brainPerson: BrainPerson;
    dolibarrCustomer: any | null;
    matchType: 'phone' | 'email' | 'name' | 'linked' | 'none';
    confidence: 'high' | 'medium' | 'low' | 'none';
}

/**
 * Sync Service
 */
class SyncService {
    /**
     * Check if sync is enabled
     */
    isEnabled(): boolean {
        return FEATURES.TULIPA_ENABLED && FEATURES.CRM_SYNC_ENABLED;
    }

    /**
     * Match a Brain person to Dolibarr customer
     */
    async matchPerson(person: BrainPerson): Promise<MatchResult> {
        // Already linked?
        if (person.linkedCustomerId) {
            const customer = await dolibarrService.getThirdParty(person.linkedCustomerId);
            if (customer) {
                return {
                    brainPerson: person,
                    dolibarrCustomer: customer,
                    matchType: 'linked',
                    confidence: 'high'
                };
            }
        }

        // Try phone match (most reliable for WhatsApp contacts)
        if (person.phone) {
            const customer = await dolibarrService.getThirdPartyByPhone(person.phone);
            if (customer) {
                return {
                    brainPerson: person,
                    dolibarrCustomer: customer,
                    matchType: 'phone',
                    confidence: 'high'
                };
            }
        }

        // Try email match
        if (person.email) {
            const results = await dolibarrService.searchThirdParty(person.email);
            if (results.length === 1) {
                return {
                    brainPerson: person,
                    dolibarrCustomer: results[0],
                    matchType: 'email',
                    confidence: 'high'
                };
            }
        }

        // Try name match (less reliable)
        if (person.name) {
            const results = await dolibarrService.searchThirdParty(person.name);
            if (results.length === 1) {
                return {
                    brainPerson: person,
                    dolibarrCustomer: results[0],
                    matchType: 'name',
                    confidence: 'medium'
                };
            } else if (results.length > 1) {
                // Multiple matches, can't determine which one
                return {
                    brainPerson: person,
                    dolibarrCustomer: null,
                    matchType: 'name',
                    confidence: 'low'
                };
            }
        }

        return {
            brainPerson: person,
            dolibarrCustomer: null,
            matchType: 'none',
            confidence: 'none'
        };
    }

    /**
     * Get all people from Brain Hub with match status
     */
    async getPeopleWithMatches(): Promise<MatchResult[]> {
        if (!FEATURES.TULIPA_ENABLED) {
            return [];
        }

        const people = await tulipaService.getPeople();
        const results: MatchResult[] = [];

        for (const person of people) {
            const match = await this.matchPerson(person);
            results.push(match);
        }

        return results;
    }

    /**
     * Link a Brain person to a Dolibarr customer
     */
    async linkPersonToCustomer(brainPersonId: string, dolibarrCustomerId: string): Promise<boolean> {
        if (!FEATURES.TULIPA_ENABLED) {
            return false;
        }

        // Update the link in Tulipa
        const success = await tulipaService.linkPersonToCustomer(brainPersonId, dolibarrCustomerId);

        if (success) {
            console.log(`[SyncService] Linked Brain person ${brainPersonId} to Dolibarr customer ${dolibarrCustomerId}`);
        }

        return success;
    }

    /**
     * Create a new Dolibarr customer from Brain person
     */
    async createCustomerFromPerson(person: BrainPerson): Promise<string | null> {
        try {
            // Build customer data
            const customerData = {
                name: person.name || `WhatsApp ${person.phone || person.id}`,
                client: "1",  // Mark as customer
                phone: person.phone || '',
                email: person.email || '',
                note_private: `Criado automaticamente via Brain Hub.\nID Brain: ${person.id}\nPrimeiro contato: ${person.firstSeen}\nCanais: ${person.channels?.join(', ') || 'whatsapp'}`,
            };

            const result = await dolibarrService.createThirdParty(customerData);

            if (result && result.id) {
                // Link the new customer to the Brain person
                await this.linkPersonToCustomer(person.id, result.id.toString());
                console.log(`[SyncService] Created Dolibarr customer ${result.id} for Brain person ${person.id}`);
                return result.id.toString();
            }

            return null;
        } catch (error: any) {
            console.error(`[SyncService] Failed to create customer:`, error.message);
            return null;
        }
    }

    /**
     * Sync all unlinked Brain people to Dolibarr
     * Options:
     * - autoCreate: Create new customers for unmatched people
     * - autoLink: Automatically link high-confidence matches
     */
    async syncAll(options: {
        autoCreate?: boolean;
        autoLink?: boolean;
    } = {}): Promise<SyncResult> {
        const result: SyncResult = {
            success: true,
            matched: 0,
            created: 0,
            updated: 0,
            failed: 0,
            errors: [],
            details: []
        };

        if (!this.isEnabled()) {
            result.success = false;
            result.errors.push('Sync is not enabled. Set TULIPA_ENABLED=true and CRM_SYNC_ENABLED=true');
            return result;
        }

        try {
            const people = await tulipaService.getPeople();
            console.log(`[SyncService] Starting sync for ${people.length} people`);

            for (const person of people) {
                const detail: SyncDetail = {
                    brainId: person.id,
                    brainName: person.name || person.id,
                    phone: person.phone,
                    action: 'skipped'
                };

                try {
                    // Check if already linked
                    if (person.linkedCustomerId) {
                        detail.action = 'matched';
                        detail.dolibarrId = person.linkedCustomerId;
                        result.matched++;
                    } else {
                        // Try to find a match
                        const match = await this.matchPerson(person);

                        if (match.dolibarrCustomer && match.confidence === 'high') {
                            // High confidence match
                            if (options.autoLink) {
                                await this.linkPersonToCustomer(person.id, match.dolibarrCustomer.id);
                                detail.action = 'matched';
                                detail.dolibarrId = match.dolibarrCustomer.id;
                                result.matched++;
                            } else {
                                detail.action = 'skipped';
                            }
                        } else if (!match.dolibarrCustomer && options.autoCreate) {
                            // No match found, create new customer
                            const newCustomerId = await this.createCustomerFromPerson(person);
                            if (newCustomerId) {
                                detail.action = 'created';
                                detail.dolibarrId = newCustomerId;
                                result.created++;
                            } else {
                                detail.action = 'failed';
                                detail.error = 'Failed to create customer';
                                result.failed++;
                            }
                        } else {
                            detail.action = 'skipped';
                        }
                    }
                } catch (error: any) {
                    detail.action = 'failed';
                    detail.error = error.message;
                    result.failed++;
                    result.errors.push(`${person.id}: ${error.message}`);
                }

                result.details.push(detail);
            }

            console.log(`[SyncService] Sync completed: matched=${result.matched}, created=${result.created}, failed=${result.failed}`);
        } catch (error: any) {
            result.success = false;
            result.errors.push(`Sync failed: ${error.message}`);
        }

        return result;
    }

    /**
     * Get sync status summary
     */
    async getSyncStatus(): Promise<{
        enabled: boolean;
        totalPeople: number;
        linkedPeople: number;
        unlinkedPeople: number;
        lastSync?: number;
    }> {
        if (!FEATURES.TULIPA_ENABLED) {
            return {
                enabled: false,
                totalPeople: 0,
                linkedPeople: 0,
                unlinkedPeople: 0
            };
        }

        try {
            const people = await tulipaService.getPeople();
            const linked = people.filter(p => p.linkedCustomerId).length;

            return {
                enabled: this.isEnabled(),
                totalPeople: people.length,
                linkedPeople: linked,
                unlinkedPeople: people.length - linked
            };
        } catch (error) {
            return {
                enabled: this.isEnabled(),
                totalPeople: 0,
                linkedPeople: 0,
                unlinkedPeople: 0
            };
        }
    }
}

// Singleton instance
export const syncService = new SyncService();

// Export class for custom instances
export { SyncService };
