import { DolibarrConfig, ThirdParty, Invoice, SupplierInvoice, Product, Proposal, Order, Project, Task, BankAccount, AgendaEvent, DolibarrUser, SupplierOrder, Intervention, ExpenseReport, RecruitmentJobPosition, Ticket, Warehouse, StockMovement, Shipment, Contact, Category, Candidate, BankLine, LeaveRequest, Contract, ManufacturingOrder, BOM, DolibarrDictionary, BOMLine } from '../types';
import * as Core from './api/core';
import * as Commercial from './api/commercial';
import * as Operations from './api/operations';
import * as Inventory from './api/inventory';
import * as HRAdmin from './api/hrAdmin';

export const DolibarrService = {
    // Core
    ...Core,

    // Commercial
    ...Commercial,
    validateSupplierInvoice: Commercial.validateSupplierInvoice,
    paySupplierInvoice: Commercial.paySupplierInvoice,
    markSupplierInvoiceAsPaid: Commercial.markSupplierInvoiceAsPaid,

    // Operations
    ...Operations,

    // Inventory
    ...Inventory,
    createProduct: async (config: DolibarrConfig, data: any) => {
        return Core.request(`${Core.sanitizeUrl(config.apiUrl)}/products`, {
            method: 'POST',
            headers: Core.getHeaders(config.apiKey),
            body: JSON.stringify(data)
        });
    },
    updateProduct: async (config: DolibarrConfig, id: string, data: any) => {
        return Core.request(`${Core.sanitizeUrl(config.apiUrl)}/products/${id}`, {
            method: 'PUT',
            headers: Core.getHeaders(config.apiKey),
            body: JSON.stringify(data)
        });
    },
    deleteProduct: async (config: DolibarrConfig, id: string) => {
        return Core.request(`${Core.sanitizeUrl(config.apiUrl)}/products/${id}`, {
            method: 'DELETE',
            headers: Core.getHeaders(config.apiKey)
        });
    },

    // HR & Admin
    ...HRAdmin,
    approveExpenseReport: HRAdmin.approveExpenseReport,
    markExpenseReportAsPaid: HRAdmin.markExpenseReportAsPaid,
    approveLeaveRequest: HRAdmin.approveLeaveRequest,
    validateLeaveRequest: HRAdmin.validateLeaveRequest,
    refuseLeaveRequest: HRAdmin.refuseLeaveRequest,

    // Ticket Actions
    closeTicket: async (config: DolibarrConfig, id: string) => {
        return Core.updateObject(config, 'tickets', id, { statut: '8' });
    },
    reopenTicket: async (config: DolibarrConfig, id: string) => {
        return Core.updateObject(config, 'tickets', id, { statut: '1' });
    }
};
