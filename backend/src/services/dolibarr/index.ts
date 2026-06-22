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
import { DolibarrFinanceService } from './finance';
import { DolibarrSetupService } from './setup';

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
    private finance = new DolibarrFinanceService();
    private setup = new DolibarrSetupService();

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
    validateInvoice = (invoiceId: string, userKey?: string) => this.commercial.validateInvoice(invoiceId, userKey);
    validateOrder = (orderId: string, userKey?: string) => this.commercial.validateOrder(orderId, userKey);
    validateProposal = (proposalId: string, userKey?: string) => this.commercial.validateProposal(proposalId, userKey);

    // === Payments ===
    addPayment = (invoiceId: string, data: AddPaymentModel, userKey?: string) => this.payments.addPayment(invoiceId, data, userKey);
    listPayments = (limit?: number) => this.payments.listPayments(limit);
    listBankAccounts = () => this.payments.listBankAccounts();
    listBankLines = (accountId: string, limit?: number) => this.payments.listBankLines(accountId, limit);
    reconcileBankLine = (accountId: string, lineId: string, reconciled: boolean, userKey?: string) => this.payments.reconcileBankLine(accountId, lineId, reconciled, userKey);

    // === Products ===
    listProducts = (search?: string) => this.products.listProducts(search);
    listWarehouses = () => this.products.listWarehouses();
    listStockMovements = (productId?: string) => this.products.listStockMovements(productId);

    // === Operations ===
    addTimeSpent = (taskId: string, data: AddTimeSpentModel, userKey?: string) => this.operations.addTimeSpent(taskId, data, userKey);
    getTicket = (id: string) => this.operations.getTicket(id);
    listProjects = (params?: { search?: string; socid?: string }) => this.operations.listProjects(params);
    listTasks = (projectId?: string) => this.operations.listTasks(projectId);
    listUserTasks = (userId: string) => this.operations.listUserTasks(userId);
    listTasksFull = () => this.operations.listTasksFull();
    getAllTaskContacts = () => this.operations.getAllTaskContacts();
    setTaskDelegationState = (taskId: string, stateJson: string) => this.operations.setTaskDelegationState(taskId, stateJson);
    listDelegationStates = () => this.operations.listDelegationStates();
    getTaskContacts = (taskId: string) => this.operations.getTaskContacts(taskId);
    setTaskContact = (taskId: string, userId: string, typeCode?: 'TASKEXECUTIVE' | 'TASKCONTRIBUTOR') => this.operations.setTaskContact(taskId, userId, typeCode);
    removeTaskContact = (taskId: string, contactRowid: string) => this.operations.removeTaskContact(taskId, contactRowid);
    listTickets = (params?: { search?: string, limit?: number }) => this.operations.listTickets(params);
    listShipments = (search?: string) => this.operations.listShipments(search);
    listEvents = (limit?: number) => this.operations.listEvents(limit);
    createAgendaEvent = (data: Parameters<DolibarrOperationsService['createAgendaEvent']>[0], userKey?: string) => this.operations.createAgendaEvent(data, userKey);
    listInterventions = (search?: string) => this.operations.listInterventions(search);

    // === HR ===
    getUserById = (id: string) => this.hr.getUserById(id);
    updateUser = (id: string, payload: Record<string, any>) => this.hr.updateUser(id, payload);
    setUserPermissionProfile = (id: string, profile: unknown) => this.hr.setUserPermissionProfile(id, profile);
    listUsers = (search?: string) => this.hr.listUsers(search);
    findUserByLoginOrEmail = (loginOrEmail: string) => this.hr.findUserByLoginOrEmail(loginOrEmail);
    listExpenseReports = (status?: string) => this.hr.listExpenseReports(status);
    listLeaveRequests = (status?: string) => this.hr.listLeaveRequests(status);
    listCandidates = (search?: string) => this.hr.listCandidates(search);
    listJobPositions = (onlyOpen: boolean = true) => this.hr.listJobPositions(onlyOpen);

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

    // === Finance ===
    getBankBalances = () => this.finance.getBankBalances();
    getBankStatement = (accountId: string, dateFrom?: string, dateTo?: string) => this.finance.getBankStatement(accountId, dateFrom, dateTo);
    getAccountsReceivable = (dateFrom?: string, dateTo?: string) => this.finance.getAccountsReceivable(dateFrom, dateTo);
    getAccountsPayable = (dateFrom?: string, dateTo?: string) => this.finance.getAccountsPayable(dateFrom, dateTo);
    getOpenProposals = () => this.finance.getOpenProposals();
    getCashFlowForecast = (dateFrom: string, dateTo: string) => this.finance.getCashFlowForecast(dateFrom, dateTo);
    getFinancialSummary = () => this.finance.getFinancialSummary();

    // === Setup ===
    getCompanyInfo = () => this.setup.getCompanyInfo();
    listCurrencies = () => this.setup.listCurrencies();
    listCountries = () => this.setup.listCountries();
    listVatRates = () => this.setup.listVatRates();
    listPaymentTypes = () => this.setup.listPaymentTypes();
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
