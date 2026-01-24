/**
 * Dolibarr Service - Unified Index
 * 
 * This file provides backward compatibility by creating a unified DolibarrService
 * that combines all modular services into a single interface.
 */

import { DolibarrServiceBase, CreateThirdPartyModel, CreateInvoiceModel, AddPaymentModel, ValidateSupplierOrderModel, CloseProposalModel, AddTimeSpentModel } from './core';
import { DolibarrThirdPartiesService } from './thirdparties';
import { DolibarrCommercialService } from './commercial';
import { DolibarrPaymentsService } from './payments';
import { DolibarrProductsService } from './products';
import { DolibarrOperationsService } from './operations';
import { DolibarrHRService } from './hr';
import { DolibarrManufacturingService } from './manufacturing';
import { DolibarrSuppliersService } from './suppliers';
import { DolibarrPartnershipsService, VenuePartnership } from './partnerships';

// Re-export types for backward compatibility
export { CreateThirdPartyModel, CreateInvoiceModel, AddPaymentModel, ValidateSupplierOrderModel, CloseProposalModel, AddTimeSpentModel };

/**
 * Unified DolibarrService class that combines all modules.
 * This provides full backward compatibility with the original monolithic service.
 */
export class DolibarrService extends DolibarrServiceBase {
    // Module instances for delegation
    private thirdParties = new DolibarrThirdPartiesService();
    private commercial = new DolibarrCommercialService();
    private payments = new DolibarrPaymentsService();
    private products = new DolibarrProductsService();
    private operations = new DolibarrOperationsService();
    private hr = new DolibarrHRService();
    private manufacturing = new DolibarrManufacturingService();
    private suppliers = new DolibarrSuppliersService();
    private partnerships = new DolibarrPartnershipsService();

    // === Third Parties ===
    createThirdParty = (data: CreateThirdPartyModel, userKey?: string) => this.thirdParties.createThirdParty(data, userKey);
    getThirdPartyByPhone = (phoneNumber: string) => this.thirdParties.getThirdPartyByPhone(phoneNumber);
    getThirdParty = (id: string) => this.thirdParties.getThirdParty(id);
    searchThirdParty = (query: string) => this.thirdParties.searchThirdParty(query);
    getCustomerContext = (thirdPartyId: string) => this.thirdParties.getCustomerContext(thirdPartyId);
    listSuppliers = (search?: string) => this.thirdParties.listSuppliers(search);
    listContacts = (search?: string) => this.thirdParties.listContacts(search);
    listCategories = (type?: string) => this.thirdParties.listCategories(type);

    // === Commercial ===
    createInvoice = (data: CreateInvoiceModel, userKey?: string) => this.commercial.createInvoice(data, userKey);
    closeProposal = (proposalId: string, data: CloseProposalModel, userKey?: string) => this.commercial.closeProposal(proposalId, data, userKey);
    getInvoice = (id: string) => this.commercial.getInvoice(id);
    getOrder = (id: string) => this.commercial.getOrder(id);
    listInvoices = (params?: { status?: string, limit?: number }) => this.commercial.listInvoices(params);
    listOrders = (params?: { status?: string, search?: string, limit?: number }) => this.commercial.listOrders(params);
    listProposals = (params?: { status?: string, search?: string, limit?: number }) => this.commercial.listProposals(params);
    listContracts = (search?: string) => this.commercial.listContracts(search);

    // === Payments ===
    addPayment = (invoiceId: string, data: AddPaymentModel, userKey?: string) => this.payments.addPayment(invoiceId, data, userKey);
    listPayments = (limit?: number) => this.payments.listPayments(limit);
    listBankAccounts = () => this.payments.listBankAccounts();
    listBankLines = (accountId: string, limit?: number) => this.payments.listBankLines(accountId, limit);

    // === Products ===
    listProducts = (search?: string) => this.products.listProducts(search);
    listWarehouses = () => this.products.listWarehouses();
    listStockMovements = (productId?: string) => this.products.listStockMovements(productId);

    // === Operations ===
    addTimeSpent = (taskId: string, data: AddTimeSpentModel, userKey?: string) => this.operations.addTimeSpent(taskId, data, userKey);
    getTicket = (id: string) => this.operations.getTicket(id);
    listProjects = (search?: string) => this.operations.listProjects(search);
    listTasks = (projectId?: string) => this.operations.listTasks(projectId);
    listTickets = (params?: { search?: string, limit?: number }) => this.operations.listTickets(params);
    listShipments = (search?: string) => this.operations.listShipments(search);
    listEvents = (limit?: number) => this.operations.listEvents(limit);
    listInterventions = (search?: string) => this.operations.listInterventions(search);

    // === HR ===
    listUsers = (search?: string) => this.hr.listUsers(search);
    listExpenseReports = (status?: string) => this.hr.listExpenseReports(status);
    listLeaveRequests = (status?: string) => this.hr.listLeaveRequests(status);
    listCandidates = (search?: string) => this.hr.listCandidates(search);
    listJobPositions = () => this.hr.listJobPositions();

    // === Manufacturing ===
    listBOMs = (search?: string) => this.manufacturing.listBOMs(search);
    listManufacturingOrders = (status?: string) => this.manufacturing.listManufacturingOrders(status);

    // === Suppliers ===
    validateSupplierOrder = (orderId: string, data: ValidateSupplierOrderModel, userKey?: string) => this.suppliers.validateSupplierOrder(orderId, data, userKey);
    listSupplierInvoices = (status?: string) => this.suppliers.listSupplierInvoices(status);
    listSupplierOrders = (status?: string) => this.suppliers.listSupplierOrders(status);

    // === Partnerships (Venues) ===
    listPartnerships = (params?: { limit?: number, status?: string }) => this.partnerships.listPartnerships(params);
    getPartnership = (id: string) => this.partnerships.getPartnership(id);
    searchPartnerships = (params?: { search?: string, minCapacity?: number, typeCode?: string, limit?: number }) => this.partnerships.searchPartnerships(params);
    getPartnershipsByType = () => this.partnerships.getPartnershipsByType();
}

// Export singleton instance for backward compatibility
export const dolibarrService = new DolibarrService();

// Export individual modules for direct use
export { DolibarrServiceBase } from './core';
export { DolibarrThirdPartiesService } from './thirdparties';
export { DolibarrCommercialService } from './commercial';
export { DolibarrPaymentsService } from './payments';
export { DolibarrProductsService } from './products';
export { DolibarrOperationsService } from './operations';
export { DolibarrHRService } from './hr';
export { DolibarrManufacturingService } from './manufacturing';
export { DolibarrSuppliersService } from './suppliers';
export { DolibarrPartnershipsService, VenuePartnership } from './partnerships';
