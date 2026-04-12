import { describe, it, expect } from 'vitest';

import { getEntityLink } from '../../utils/navigationUtils';
import { AppView } from '../../types';

describe('navigationUtils', () => {
    describe('getEntityLink', () => {
        it('returns null when elementType is undefined', () => {
            expect(getEntityLink(undefined, 123)).toBeNull();
        });

        it('returns null when elementId is undefined', () => {
            expect(getEntityLink('facture', undefined)).toBeNull();
        });

        it('returns null when both are missing', () => {
            expect(getEntityLink(undefined, undefined)).toBeNull();
        });

        describe('projects', () => {
            it('handles projet', () => {
                const result = getEntityLink('projet', 456);
                expect(result).toEqual({ view: 'projects', id: '456' });
            });

            it('handles project', () => {
                const result = getEntityLink('project', 789);
                expect(result).toEqual({ view: 'projects', id: '789' });
            });

            it('handles numeric id', () => {
                const result = getEntityLink('projet', 123);
                expect(result?.id).toBe('123');
            });
        });

        describe('tasks', () => {
            it('handles task', () => {
                const result = getEntityLink('task', 100);
                expect(result).toEqual({ view: 'tasks', id: '100' });
            });

            it('handles projet_task', () => {
                const result = getEntityLink('projet_task', 200);
                expect(result).toEqual({ view: 'tasks', id: '200' });
            });
        });

        describe('tickets', () => {
            it('handles ticket', () => {
                const result = getEntityLink('ticket', 50);
                expect(result).toEqual({ view: 'tickets', id: '50' });
            });
        });

        describe('proposals', () => {
            it('handles propal', () => {
                const result = getEntityLink('propal', 10);
                expect(result).toEqual({ view: 'proposals', id: '10' });
            });

            it('handles comm/propal', () => {
                const result = getEntityLink('comm/propal', 11);
                expect(result).toEqual({ view: 'proposals', id: '11' });
            });

            it('handles proposal', () => {
                const result = getEntityLink('proposal', 12);
                expect(result).toEqual({ view: 'proposals', id: '12' });
            });
        });

        describe('supplier_proposals', () => {
            it('handles supplier_proposal', () => {
                const result = getEntityLink('supplier_proposal', 20);
                expect(result).toEqual({ view: 'supplier_proposals', id: '20' });
            });

            it('handles supplier_propal', () => {
                const result = getEntityLink('supplier_propal', 21);
                expect(result).toEqual({ view: 'supplier_proposals', id: '21' });
            });
        });

        describe('orders', () => {
            it('handles commande', () => {
                const result = getEntityLink('commande', 30);
                expect(result).toEqual({ view: 'orders', id: '30' });
            });

            it('handles order', () => {
                const result = getEntityLink('order', 31);
                expect(result).toEqual({ view: 'orders', id: '31' });
            });
        });

        describe('invoices', () => {
            it('handles facture', () => {
                const result = getEntityLink('facture', 40);
                expect(result).toEqual({ view: 'invoices', id: '40' });
            });

            it('handles invoice', () => {
                const result = getEntityLink('invoice', 41);
                expect(result).toEqual({ view: 'invoices', id: '41' });
            });
        });

        describe('supplier_invoices', () => {
            it('handles facture_fourn', () => {
                const result = getEntityLink('facture_fourn', 50);
                expect(result).toEqual({ view: 'supplier_invoices', id: '50' });
            });

            it('handles supplier_invoice', () => {
                const result = getEntityLink('supplier_invoice', 51);
                expect(result).toEqual({ view: 'supplier_invoices', id: '51' });
            });
        });

        describe('contracts', () => {
            it('handles contrat', () => {
                const result = getEntityLink('contrat', 60);
                expect(result).toEqual({ view: 'contracts', id: '60' });
            });

            it('handles contract', () => {
                const result = getEntityLink('contract', 61);
                expect(result).toEqual({ view: 'contracts', id: '61' });
            });
        });

        describe('customers', () => {
            it('handles societe', () => {
                const result = getEntityLink('societe', 70);
                expect(result).toEqual({ view: 'customers', id: '70' });
            });

            it('handles company', () => {
                const result = getEntityLink('company', 71);
                expect(result).toEqual({ view: 'customers', id: '71' });
            });

            it('handles thirdparty', () => {
                const result = getEntityLink('thirdparty', 72);
                expect(result).toEqual({ view: 'customers', id: '72' });
            });

            it('handles customer', () => {
                const result = getEntityLink('customer', 73);
                expect(result).toEqual({ view: 'customers', id: '73' });
            });
        });

        describe('suppliers', () => {
            it('handles supplier', () => {
                const result = getEntityLink('supplier', 80);
                expect(result).toEqual({ view: 'suppliers', id: '80' });
            });

            it('handles fournisseur', () => {
                const result = getEntityLink('fournisseur', 81);
                expect(result).toEqual({ view: 'suppliers', id: '81' });
            });
        });

        describe('interventions', () => {
            it('handles intervention', () => {
                const result = getEntityLink('intervention', 90);
                expect(result).toEqual({ view: 'interventions', id: '90' });
            });

            it('handles ficheinter', () => {
                const result = getEntityLink('ficheinter', 91);
                expect(result).toEqual({ view: 'interventions', id: '91' });
            });
        });

        describe('shipments', () => {
            it('handles shipment', () => {
                const result = getEntityLink('shipment', 100);
                expect(result).toEqual({ view: 'shipments', id: '100' });
            });

            it('handles expedition', () => {
                const result = getEntityLink('expedition', 101);
                expect(result).toEqual({ view: 'shipments', id: '101' });
            });
        });

        describe('payments', () => {
            it('handles payment', () => {
                const result = getEntityLink('payment', 110);
                expect(result).toEqual({ view: 'payments', id: '110' });
            });

            it('handles paiement', () => {
                const result = getEntityLink('paiement', 111);
                expect(result).toEqual({ view: 'payments', id: '111' });
            });
        });

        describe('supplier_payments', () => {
            it('handles supplier_payment', () => {
                const result = getEntityLink('supplier_payment', 120);
                expect(result).toEqual({ view: 'supplier_payments', id: '120' });
            });

            it('handles paiement_fourn', () => {
                const result = getEntityLink('paiement_fourn', 121);
                expect(result).toEqual({ view: 'supplier_payments', id: '121' });
            });
        });

        describe('products', () => {
            it('handles product', () => {
                const result = getEntityLink('product', 130);
                expect(result).toEqual({ view: 'products', id: '130' });
            });

            it('handles produit', () => {
                const result = getEntityLink('produit', 131);
                expect(result).toEqual({ view: 'products', id: '131' });
            });
        });

        describe('services', () => {
            it('handles service', () => {
                const result = getEntityLink('service', 140);
                expect(result).toEqual({ view: 'services', id: '140' });
            });
        });

        describe('hr', () => {
            it('handles user', () => {
                const result = getEntityLink('user', 150);
                expect(result).toEqual({ view: 'hr', id: '150' });
            });

            it('handles utilisateur', () => {
                const result = getEntityLink('utilisateur', 151);
                expect(result).toEqual({ view: 'hr', id: '151' });
            });
        });

        describe('venues', () => {
            it('handles venue', () => {
                const result = getEntityLink('venue', 160);
                expect(result).toEqual({ view: 'venues', id: '160' });
            });

            it('handles partnership', () => {
                const result = getEntityLink('partnership', 161);
                expect(result).toEqual({ view: 'venues', id: '161' });
            });
        });

        describe('agenda', () => {
            it('handles agenda', () => {
                const result = getEntityLink('agenda', 170);
                expect(result).toEqual({ view: 'agenda', id: '170' });
            });

            it('handles agenda_event', () => {
                const result = getEntityLink('agenda_event', 171);
                expect(result).toEqual({ view: 'agenda', id: '171' });
            });

            it('handles actioncomm', () => {
                const result = getEntityLink('actioncomm', 172);
                expect(result).toEqual({ view: 'agenda', id: '172' });
            });
        });

        describe('bank_accounts', () => {
            it('handles bank', () => {
                const result = getEntityLink('bank', 180);
                expect(result).toEqual({ view: 'bank_accounts', id: '180' });
            });

            it('handles bank_account', () => {
                const result = getEntityLink('bank_account', 181);
                expect(result).toEqual({ view: 'bank_accounts', id: '181' });
            });
        });

        describe('tax_payments', () => {
            it('handles tax_payment', () => {
                const result = getEntityLink('tax_payment', 190);
                expect(result).toEqual({ view: 'tax_payments', id: '190' });
            });

            it('handles chargesociales', () => {
                const result = getEntityLink('chargesociales', 191);
                expect(result).toEqual({ view: 'tax_payments', id: '191' });
            });
        });

        describe('salary_payments', () => {
            it('handles salary_payment', () => {
                const result = getEntityLink('salary_payment', 200);
                expect(result).toEqual({ view: 'salary_payments', id: '200' });
            });

            it('handles salary', () => {
                const result = getEntityLink('salary', 201);
                expect(result).toEqual({ view: 'salary_payments', id: '201' });
            });
        });

        describe('expense_report_payments', () => {
            it('handles expense_report', () => {
                const result = getEntityLink('expense_report', 210);
                expect(result).toEqual({ view: 'expense_report_payments', id: '210' });
            });

            it('handles expensereport', () => {
                const result = getEntityLink('expensereport', 211);
                expect(result).toEqual({ view: 'expense_report_payments', id: '211' });
            });
        });

        describe('fallback with extraData', () => {
            it('returns customers view with socid for unknown type', () => {
                const result = getEntityLink('unknown_type', 999, { socid: 123 });
                expect(result).toEqual({ view: 'customers', id: '123' });
            });

            it('returns customers with socid as string', () => {
                const result = getEntityLink('contact', 456, { socid: '789' });
                expect(result).toEqual({ view: 'customers', id: '789' });
            });
        });

        describe('unknown type fallback', () => {
            it('returns null for unknown type without extraData', () => {
                const result = getEntityLink('completely_unknown_type', 123);
                expect(result).toBeNull();
            });

            it('returns null for unknown type with empty extraData', () => {
                const result = getEntityLink('unknown', 123, {});
                expect(result).toBeNull();
            });
        });

        describe('case insensitivity', () => {
            it('handles uppercase element types', () => {
                const result = getEntityLink('FACTURE', 100);
                expect(result).toEqual({ view: 'invoices', id: '100' });
            });

            it('handles mixed case element types', () => {
                const result = getEntityLink('Facture', 100);
                expect(result).toEqual({ view: 'invoices', id: '100' });
            });
        });
    });
});