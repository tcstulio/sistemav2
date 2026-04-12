import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('axios', () => ({
    default: Object.assign(vi.fn(), {
        get: vi.fn(),
        isAxiosError: vi.fn(),
    }),
}));

vi.mock('https', () => ({
    default: { Agent: vi.fn() },
}));

vi.mock('fs', () => ({
    default: { existsSync: vi.fn(), readFileSync: vi.fn() },
}));

vi.mock('../../../config/env', () => ({
    config: {
        dolibarrUrl: 'https://test.dolibarr.com/api/index.php/',
        dolibarrKey: 'test-api-key-1234567890',
        dolibarrBypassCookie: 'test_cookie=1',
    },
}));

import * as dolibarrService from '../../../services/dolibarrService';
import {
    DolibarrService,
    dolibarrService as instance,
    DolibarrServiceBase,
    DolibarrThirdPartiesService,
    DolibarrCommercialService,
    DolibarrPaymentsService,
    DolibarrProductsService,
    DolibarrOperationsService,
    DolibarrHRService,
    DolibarrManufacturingService,
    DolibarrSuppliersService,
    DolibarrPartnershipsService,
} from '../../../services/dolibarrService';

describe('dolibarrService', () => {
    it('exports DolibarrService class', () => {
        expect(DolibarrService).toBeDefined();
    });

    it('exports singleton dolibarrService instance', () => {
        expect(instance).toBeDefined();
        expect(instance).toBeInstanceOf(DolibarrService);
    });

    it('exports DolibarrServiceBase', () => {
        expect(DolibarrServiceBase).toBeDefined();
    });

    it('exports all module classes', () => {
        expect(DolibarrThirdPartiesService).toBeDefined();
        expect(DolibarrCommercialService).toBeDefined();
        expect(DolibarrPaymentsService).toBeDefined();
        expect(DolibarrProductsService).toBeDefined();
        expect(DolibarrOperationsService).toBeDefined();
        expect(DolibarrHRService).toBeDefined();
        expect(DolibarrManufacturingService).toBeDefined();
        expect(DolibarrSuppliersService).toBeDefined();
        expect(DolibarrPartnershipsService).toBeDefined();
    });

    it('dolibarrService has all delegation methods', () => {
        const svc = instance as any;
        const methods = [
            'createThirdParty', 'getThirdPartyByPhone', 'getThirdParty', 'searchThirdParty',
            'getCustomerContext', 'listSuppliers', 'listContacts', 'listCategories',
            'createInvoice', 'closeProposal', 'getInvoice', 'getOrder',
            'listInvoices', 'listOrders', 'listProposals', 'listContracts',
            'addPayment', 'listPayments', 'listBankAccounts', 'listBankLines',
            'listProducts', 'listWarehouses', 'listStockMovements',
            'addTimeSpent', 'getTicket', 'listProjects', 'listTasks',
            'listTickets', 'listShipments', 'listEvents', 'listInterventions',
            'listUsers', 'listExpenseReports', 'listLeaveRequests',
            'listCandidates', 'listJobPositions',
            'listBOMs', 'listManufacturingOrders',
            'validateSupplierOrder', 'listSupplierInvoices', 'listSupplierOrders',
            'listPartnerships', 'getPartnership', 'searchPartnerships', 'getPartnershipsByType',
        ];
        methods.forEach(method => {
            expect(typeof svc[method]).toBe('function');
        });
    });

    it('re-exports types from core module', () => {
        expect(dolibarrService).toBeDefined();
    });
});
