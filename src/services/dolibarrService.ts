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

    // Operations
    ...Operations,

    // Inventory
    ...Inventory,

    // HR & Admin
    ...HRAdmin
};
