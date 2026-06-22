import { describe, it, expect } from 'vitest';
import * as mappers from '../../hooks/dolibarr/mappers';

describe('Dolibarr Mappers', () => {
    describe('ThirdParty mappers', () => {
        it('maps raw thirdparty to ThirdParty', () => {
            const raw = {
                id: '1',
                name: 'Test Company',
                email: 'test@company.com',
                phone: '5511999999999',
                client: '1',
                fournisseur: '0',
                date_modification: 1700000000,
            };
            const result = mappers.mapThirdParty(raw);
            expect(result.id).toBe('1');
            expect(result.name).toBe('Test Company');
            expect(result.email).toBe('test@company.com');
        });

        it('handles missing fields', () => {
            const raw = { id: '2' };
            const result = mappers.mapThirdParty(raw as any);
            expect(result.id).toBe('2');
            expect(result.name).toBe('');
        });

        it('maps extended fields (url, idprof1, typent_id, phone_mobile, fax, socialnetworks, array_options)', () => {
            const raw = {
                id: '3',
                name: 'Empresa XYZ',
                client: '1',
                fournisseur: '0',
                url: 'https://empresa.com',
                idprof1: '12.345.678/0001-99',
                typent_id: '5',
                phone_mobile: '+5511999999999',
                fax: '+551133334444',
                socialnetworks: { linkedin: 'https://linkedin.com/in/xyz' },
                array_options: { options_assinante: 'João Silva' },
            };
            const result = mappers.mapThirdParty(raw as any);
            expect(result.url).toBe('https://empresa.com');
            expect(result.idprof1).toBe('12.345.678/0001-99');
            expect(result.typent_id).toBe('5');
            expect(result.phone_mobile).toBe('+5511999999999');
            expect(result.fax).toBe('+551133334444');
            expect(result.socialnetworks?.linkedin).toBe('https://linkedin.com/in/xyz');
            expect(result.array_options?.options_assinante).toBe('João Silva');
        });

        it('mapSupplier maps extended fields', () => {
            const raw = {
                id: '10',
                name: 'Fornecedor ABC',
                client: '0',
                fournisseur: '1',
                url: 'https://fornecedor.com',
                idprof1: '98.765.432/0001-11',
                typent_id: '8',
                phone_mobile: '+5521988887777',
                fax: undefined,
                socialnetworks: undefined,
                array_options: undefined,
            };
            const result = mappers.mapSupplier(raw as any);
            expect(result.url).toBe('https://fornecedor.com');
            expect(result.idprof1).toBe('98.765.432/0001-11');
            expect(result.typent_id).toBe('8');
            expect(result.phone_mobile).toBe('+5521988887777');
            expect(result.fax).toBeUndefined();
            expect(result.socialnetworks).toBeUndefined();
            expect(result.array_options).toBeUndefined();
        });
    });

    describe('Invoice mappers', () => {
        it('maps raw invoice to Invoice', () => {
            const raw = {
                id: '1',
                ref: 'FA001',
                ref_client: 'CLI001',
                sallename: 'Client Test',
                date: '2024-01-15',
                total_ttc: 1000.50,
               statut: '1',
                mode_reglement_id: '3',
            };
            const result = mappers.mapInvoice(raw);
            expect(result.id).toBe('1');
            expect(result.ref).toBe('FA001');
            expect(result.total_ttc).toBe(1000.50);
        });

        it('handles null/undefined values', () => {
            const raw = { id: '3', ref: null, total_ttc: null };
            const result = mappers.mapInvoice(raw as any);
            expect(result.id).toBe('3');
        });
    });

    describe('SupplierInvoice mappers', () => {
        it('maps raw supplier invoice', () => {
            const raw = {
                id: '1',
                ref: 'SI001',
                fk_soc: '5',
                label: 'Supplier Invoice Test',
                datec: '2024-01-10 00:00:00',
                total_ttc: 500,
                paye: '0',
                statut: '0',
            };
            const result = mappers.mapSupplierInvoice(raw as any);
            expect(result.id).toBe('1');
            expect(result.ref).toBe('SI001');
            expect(result.total_ttc).toBe(500);
        });
    });

    describe('Order mappers', () => {
        it('maps raw order', () => {
            const raw = {
                id: '1',
                ref: 'OR001',
                ref_client: 'CLI001',
                date: '2024-01-20',
                total_ttc: 2000,
                statut: '1',
            };
            const result = mappers.mapOrder(raw);
            expect(result.id).toBe('1');
            expect(result.ref).toBe('OR001');
        });
    });

    describe('SupplierOrder mappers', () => {
        it('maps raw supplier order', () => {
            const raw = {
                id: '1',
                ref: 'SO001',
                ref_supplier: 'SUP001',
                date: '2024-01-18',
                total_ttc: 800,
            };
            const result = mappers.mapSupplierOrder(raw);
            expect(result.id).toBe('1');
        });
    });

    describe('Proposal mappers', () => {
        it('maps raw proposal', () => {
            const raw = {
                id: '1',
                ref: 'PR001',
                ref_client: 'CLI001',
                date: '2024-01-25',
                total_ttc: 1500,
                statut: '1',
            };
            const result = mappers.mapProposal(raw);
            expect(result.id).toBe('1');
            expect(result.ref).toBe('PR001');
        });
    });

    describe('SupplierProposal mappers', () => {
        it('maps raw supplier proposal', () => {
            const raw = {
                id: '1',
                ref: 'SP001',
                ref_supplier: 'SUP001',
                date: '2024-01-22',
                total_ttc: 1200,
            };
            const result = mappers.mapSupplierProposal(raw);
            expect(result.id).toBe('1');
        });
    });

    describe('Project mappers', () => {
        it('maps raw project', () => {
            const raw = {
                id: '1',
                ref: 'PRJ001',
                title: 'Test Project',
                date_start: '2024-01-01',
                date_end: '2024-12-31',
                statut: '1',
            };
            const result = mappers.mapProject(raw);
            expect(result.id).toBe('1');
            expect(result.title).toBe('Test Project');
        });
    });

    describe('Task mappers', () => {
        it('maps raw task', () => {
            const raw = {
                id: '1',
                label: 'Test Task',
                project_id: '1',
                date_start: '2024-01-15',
                date_end: '2024-01-20',
                statut: '1',
            };
            const result = mappers.mapTask(raw);
            expect(result.id).toBe('1');
            expect(result.label).toBe('Test Task');
        });
    });

    describe('Ticket mappers', () => {
        it('maps raw ticket', () => {
            const raw = {
                id: '1',
                ref: 'TKT001',
                subject: 'Test Ticket',
                ticket_id: '123',
                fd_date_creation: '2024-01-10',
                statut: '1',
            };
            const result = mappers.mapTicket(raw);
            expect(result.id).toBe('1');
            expect(result.subject).toBe('Test Ticket');
        });
    });

    describe('BankAccount mappers', () => {
        it('maps raw bank account', () => {
            const raw = {
                id: '1',
                label: 'Conta Corrente',
                bank: 'Banco do Brasil',
                code_banque: '001',
                account_number: '12345-6',
            };
            const result = mappers.mapBankAccount(raw);
            expect(result.id).toBe('1');
            expect(result.label).toBe('Conta Corrente');
        });
    });

    describe('BankLine mappers', () => {
        it('maps raw bank line', () => {
            const raw = {
                id: '1',
                date_operation: '2024-01-15 00:00:00',
                date_value: '2024-01-16 00:00:00',
                label: 'Test Transaction',
                amount: 500.50,
                fk_account: '1',
                rappro: '0',
            };
            const result = mappers.mapBankLine(raw as any);
            expect(result.id).toBe('1');
            expect(result.amount).toBe(500.50);
        });
    });

    describe('Product mappers', () => {
        it('maps raw product', () => {
            const raw = {
                id: '1',
                ref: 'PROD001',
                label: 'Test Product',
                price: 99.90,
                price_ttc: 119.88,
                stock_reel: 50,
            };
            const result = mappers.mapProduct(raw);
            expect(result.id).toBe('1');
            expect(result.label).toBe('Test Product');
        });
    });

    describe('Category mappers', () => {
        it('maps raw category', () => {
            const raw = {
                id: '1',
                label: 'Category Test',
                type: '0',
            };
            const result = mappers.mapCategory(raw);
            expect(result.id).toBe('1');
            expect(result.label).toBe('Category Test');
        });
    });

    describe('AgendaEvent mappers', () => {
        it('maps raw agenda event', () => {
            const raw = {
                id: '1',
                label: 'Meeting',
                date: '2024-01-15 10:00:00',
                dateend: '2024-01-15 11:00:00',
                fulldayevent: '0',
            };
            const result = mappers.mapAgendaEvent(raw);
            expect(result.id).toBe('1');
            expect(result.label).toBe('Meeting');
        });
    });

    describe('Shipment mappers', () => {
        it('maps raw shipment', () => {
            const raw = {
                id: '1',
                ref: 'SH001',
                ref_customer: 'CLI001',
                date: '2024-01-20',
                statut: '1',
            };
            const result = mappers.mapShipment(raw);
            expect(result.id).toBe('1');
        });
    });

    describe('Contact mappers', () => {
        it('maps raw contact', () => {
            const raw = {
                id: '1',
                lastname: 'Silva',
                firstname: 'João',
                email: 'joao@test.com',
                phone: '5511999999999',
            };
            const result = mappers.mapContact(raw);
            expect(result.id).toBe('1');
            expect(result.lastname).toBe('Silva');
        });
    });

    describe('Warehouse mappers', () => {
        it('maps raw warehouse', () => {
            const raw = {
                id: '1',
                label: 'Almoxarifado Central',
                address: 'Rua Principal, 100',
            };
            const result = mappers.mapWarehouse(raw);
            expect(result.id).toBe('1');
            expect(result.label).toBe('Almoxarifado Central');
        });

        it('preserves array_options (extrafields) from raw payload', () => {
            const raw = {
                id: '2',
                label: 'Dep Externo',
                statut: '1',
                array_options: { options_setor: 'Frio', options_cap: '5000' },
            };
            const result = mappers.mapWarehouse(raw);
            expect(result.array_options).toEqual({ options_setor: 'Frio', options_cap: '5000' });
        });

        it('maps address fields (address, zip, town, phone, fax)', () => {
            const raw = {
                id: '3',
                label: 'Dep Norte',
                statut: '1',
                address: 'Av. Brasil, 500',
                zip: '01310-000',
                town: 'São Paulo',
                phone: '(11) 1234-5678',
                fax: '(11) 8765-4321',
            };
            const result = mappers.mapWarehouse(raw);
            expect(result.address).toBe('Av. Brasil, 500');
            expect(result.zip).toBe('01310-000');
            expect(result.town).toBe('São Paulo');
            expect(result.phone).toBe('(11) 1234-5678');
            expect(result.fax).toBe('(11) 8765-4321');
        });

        it('does not set optional fields when absent in raw payload', () => {
            const raw = { id: '4', label: 'Dep Vazio', statut: '0' };
            const result = mappers.mapWarehouse(raw);
            expect(result.address).toBeUndefined();
            expect(result.zip).toBeUndefined();
            expect(result.town).toBeUndefined();
            expect(result.phone).toBeUndefined();
            expect(result.fax).toBeUndefined();
            expect(result.array_options).toBeUndefined();
        });
    });

    describe('StockMovement mappers', () => {
        it('maps raw stock movement', () => {
            const raw = {
                id: '1',
                fk_product: '10',
                fk_entrepot: '1',
                value: 100,
                type_mouvement: '1',
                label: 'Stock entry',
                datem: '2024-01-15 00:00:00',
            };
            const result = mappers.mapStockMovement(raw as any);
            expect(result.id).toBe('1');
            expect(result.qty).toBe(100);
        });
    });

    describe('Contract mappers', () => {
        it('maps raw contract', () => {
            const raw = {
                id: '1',
                ref: 'CTR001',
                ref_customer: 'CLI001',
                date_creation: '2024-01-01',
                statut: '1',
            };
            const result = mappers.mapContract(raw);
            expect(result.id).toBe('1');
            expect(result.ref).toBe('CTR001');
        });

        it('populates lines from raw contract with lines array', () => {
            const raw = {
                id: '10',
                ref: 'CTR010',
                fk_soc: '5',
                statut: '1',
                lines: [
                    { id: '100', description: 'Suporte mensal', qty: 1, subprice: 500 },
                    { id: '101', description: 'Licença anual', qty: 3, subprice: 200 },
                ],
            };
            const result = mappers.mapContract(raw);
            expect(result.lines).toHaveLength(2);
            expect(result.lines![0].desc).toBe('Suporte mensal');
            expect(result.lines![0].qty).toBe(1);
            expect(result.lines![0].price).toBe(500);
            expect(result.lines![1].desc).toBe('Licença anual');
            expect(result.lines![1].qty).toBe(3);
        });

        it('sets lines to empty array when raw has no lines', () => {
            const raw = { id: '11', ref: 'CTR011', statut: '0' };
            const result = mappers.mapContract(raw);
            expect(result.lines).toEqual([]);
        });

        it('populates array_options from raw contract', () => {
            const raw = {
                id: '12',
                ref: 'CTR012',
                statut: '1',
                array_options: { options_custom_field: 'valor123' },
            };
            const result = mappers.mapContract(raw);
            expect(result.array_options).toEqual({ options_custom_field: 'valor123' });
        });

        it('leaves array_options undefined when not present', () => {
            const raw = { id: '13', ref: 'CTR013', statut: '0' };
            const result = mappers.mapContract(raw);
            expect(result.array_options).toBeUndefined();
        });

        it('maps project_id from raw contract', () => {
            const raw = { id: '14', ref: 'CTR014', statut: '1', project_id: '42' };
            const result = mappers.mapContract(raw);
            expect(result.project_id).toBe('42');
        });
    });

    describe('Intervention mappers', () => {
        it('maps raw intervention', () => {
            const raw = {
                id: '1',
                ref: 'INT001',
                date: '2024-01-15',
                duree: 7200,
                statut: '1',
            };
            const result = mappers.mapIntervention(raw);
            expect(result.id).toBe('1');
        });
    });

    describe('ExpenseReport mappers', () => {
        it('maps raw expense report', () => {
            const raw = {
                id: '1',
                ref: 'EXP001',
                date_debut: '2024-01-01',
                date_fin: '2024-01-31',
                total_ttc: 500,
                statut: '1',
            };
            const result = mappers.mapExpenseReport(raw);
            expect(result.id).toBe('1');
            expect(result.total_ttc).toBe(500);
        });
    });

    describe('DolibarrUser mappers', () => {
        it('maps raw user', () => {
            const raw = {
                id: '1',
                login: 'john.doe',
                lastname: 'Doe',
                firstname: 'John',
                email: 'john@company.com',
                admin: 1,
            };
            const result = mappers.mapUser(raw as any);
            expect(result.id).toBe('1');
            expect(result.login).toBe('john.doe');
        });

        it('preserves admin field as-is', () => {
            const rawAdmin1 = { id: '1', login: 'a', admin: 1 };
            const rawAdminStr = { id: '2', login: 'b', admin: '1' };
            const rawAdminTrue = { id: '3', login: 'c', admin: true };
            const rawAdminFalse = { id: '4', login: 'd', admin: 0 };

            expect(mappers.mapUser(rawAdmin1 as any).admin).toBe(1);
            expect(mappers.mapUser(rawAdminStr as any).admin).toBe('1');
            expect(mappers.mapUser(rawAdminTrue as any).admin).toBe(true);
            expect(mappers.mapUser(rawAdminFalse as any).admin).toBe(0);
        });
    });

    describe('Payment mappers', () => {
        it('maps raw payment', () => {
            const raw = {
                id: 1,
                datep: '2024-01-15 00:00:00',
                amount: 1000,
                pct: 100,
            };
            const result = mappers.mapPayment(raw as any);
            expect(result.amount).toBe(1000);
        });
    });

    describe('SupplierPayment mappers', () => {
        it('maps raw supplier payment', () => {
            const raw = {
                id: 1,
                date_payment: '2024-01-20 00:00:00',
                amount: 500,
            };
            const result = mappers.mapSupplierPayment(raw as any);
            expect(result.amount).toBe(500);
        });
    });

    describe('SalaryPayment mappers', () => {
        it('preserves fk_typepayment when present (#625)', () => {
            const raw = {
                id: 10,
                ref: 'SAL010',
                fk_user: 5,
                date_payment: '2024-02-01 00:00:00',
                amount: 3000,
                salary: 3500,
                fk_bank: 7,
                fk_typepayment: 'PIX',
            };
            const result = mappers.mapSalaryPayment(raw as any);
            expect(result.fk_typepayment).toBe('PIX');
            expect(result.amount).toBe(3000);
        });

        it('leaves fk_typepayment undefined when absent (#625)', () => {
            const raw = { id: 11, ref: 'SAL011', fk_user: 5, amount: 1000, salary: 1200, fk_bank: 7 };
            const result = mappers.mapSalaryPayment(raw as any);
            expect(result.fk_typepayment).toBeUndefined();
        });

        it('preserves fk_salary when present in raw (#568)', () => {
            const raw = {
                id: 20,
                ref: 'SAL020',
                fk_user: '',
                fk_salary: '42',
                date_payment: '2024-03-01 00:00:00',
                amount: 4000,
                salary: 4500,
                fk_bank: 8,
            };
            const result = mappers.mapSalaryPayment(raw as any);
            expect(result.fk_salary).toBe('42');
            expect(result.fk_user).toBe('');
        });

        it('leaves fk_salary undefined when absent in raw (#568)', () => {
            const raw = { id: 21, ref: 'SAL021', fk_user: '3', amount: 2000, salary: 2200, fk_bank: 9 };
            const result = mappers.mapSalaryPayment(raw as any);
            expect(result.fk_salary).toBeUndefined();
            expect(result.fk_user).toBe('3');
        });

        it('maps fk_user correctly when present (#568)', () => {
            const raw = {
                id: 22,
                ref: 'SAL022',
                fk_user: '7',
                fk_salary: '55',
                amount: 5000,
                salary: 5500,
                fk_bank: 10,
            };
            const result = mappers.mapSalaryPayment(raw as any);
            expect(result.fk_user).toBe('7');
            expect(result.fk_salary).toBe('55');
        });
    });

    describe('Salary mappers', () => {
        it('maps raw salary record with fk_user (#568)', () => {
            const raw = {
                id: 42,
                ref: 'SAL-2024-01',
                fk_user: 7,
                amount: 5000,
                tms: '2024-01-31 00:00:00',
            };
            const result = mappers.mapSalary(raw as any);
            expect(result.id).toBe('42');
            expect(result.ref).toBe('SAL-2024-01');
            expect(result.fk_user).toBe('7');
            expect(result.amount).toBe(5000);
        });

        it('handles missing optional fields', () => {
            const raw = { id: '43', fk_user: '5', amount: 3000 };
            const result = mappers.mapSalary(raw as any);
            expect(result.id).toBe('43');
            expect(result.fk_user).toBe('5');
            expect(result.ref).toBe('');
            expect(result.date_modification).toBe(0);
        });
    });

    describe('Line item mappers', () => {
        it('maps invoice line', () => {
            const raw = {
                id: '1',
                fk_facture: '10',
                product_ref: 'PROD1',
                product_label: 'Product Description',
                qty: 5,
                total_ttc: 599.40,
            };
            const result = mappers.mapInvoiceLine(raw);
            expect(result.id).toBe('1');
            expect(result.qty).toBe(5);
        });

        it('maps order line', () => {
            const raw = {
                id: '2',
                fk_commande: '10',
                product_ref: 'PROD2',
                qty: 3,
                total_ttc: 359.64,
            };
            const result = mappers.mapOrderLine(raw);
            expect(result.id).toBe('2');
        });

        it('maps proposal line', () => {
            const raw = {
                id: '3',
                fk_propal: '10',
                product_ref: 'PROD3',
                qty: 2,
                total_ttc: 239.76,
            };
            const result = mappers.mapProposalLine(raw);
            expect(result.id).toBe('3');
        });
    });

    describe('Link mappers', () => {
        it('maps link', () => {
            const raw = {
                id: '1',
                sourcetype: 'customer',
                sourceid: '10',
                targettype: 'invoice',
                targetid: '20',
            };
            const result = mappers.mapLink(raw);
            expect(result.id).toBe('1');
            expect(result.sourcetype).toBe('customer');
        });
    });

    describe('SystemLog mappers', () => {
        it('maps system log', () => {
            const raw = {
                id: '1',
                entity: 'dolibarr',
                datas: 'Test log entry',
                datep: '2024-01-15 10:00:00',
            };
            const result = mappers.mapSystemLog(raw);
            expect(result.id).toBe('1');
        });
    });

    describe('Manufacturing mappers', () => {
        it('maps BOM', () => {
            const raw = {
                id: '1',
                ref: 'BOM001',
                datec: '2024-01-01',
            };
            const result = mappers.mapBOM(raw);
            expect(result.id).toBe('1');
        });

        it('maps manufacturing order', () => {
            const raw = {
                id: '1',
                ref: 'MO001',
                date_start: '2024-01-15',
                date_end: '2024-01-20',
                statut: '1',
            };
            const result = mappers.mapManufacturingOrder(raw);
            expect(result.id).toBe('1');
        });
    });

    describe('JobPosition and Candidate mappers', () => {
        it('maps job position', () => {
            const raw = {
                id: '1',
                label: 'Software Engineer',
                date_start: '2024-01-01',
            };
            const result = mappers.mapJobPosition(raw);
            expect(result.id).toBe('1');
            expect(result.label).toBe('Software Engineer');
        });

        it('maps candidate', () => {
            const raw = {
                id: '1',
                lastname: 'Candidate',
                firstname: 'Test',
                email: 'test@candidate.com',
            };
            const result = mappers.mapCandidate(raw);
            expect(result.id).toBe('1');
        });
    });

    describe('LeaveRequest mappers', () => {
        it('maps leave request', () => {
            const raw = {
                id: '1',
                fk_user: '10',
                date_debut: '2024-01-20',
                date_fin: '2024-01-25',
                statut: '1',
            };
            const result = mappers.mapLeaveRequest(raw);
            expect(result.id).toBe('1');
        });
    });

    describe('Edge cases', () => {
        it('handles empty objects', () => {
            const raw = {};
            const result = mappers.mapThirdParty(raw as any);
            expect(result).toBeDefined();
        });

        it('handles extra fields gracefully', () => {
            const raw = {
                id: '99',
                name: 'Extra Fields Test',
                extra_field: 'should be ignored',
                another_field: 123,
            };
            const result = mappers.mapThirdParty(raw as any);
            expect(result.id).toBe('99');
        });
    });
});