import { Project, Task, AgendaEvent, Intervention, ProjectContact } from '../../types/projects';
import { ThirdParty, Contact, Ticket } from '../../types/crm';
import { Invoice, SupplierInvoice, Proposal, Order, SupplierOrder, Contract } from '../../types/sales';
import { DolibarrConfig, DolibarrDocument, AppView, DolibarrUser } from '../../types/common';
import { Shipment } from '../../types/products';
import { ManufacturingOrder } from '../../types/manufacturing';
import { ExpenseReport } from '../../types/hr';

// Project Tab Types
export type ProjectTab =
    | 'overview'
    | 'tasks'
    | 'tickets'
    | 'events'
    | 'financials'
    | 'sales'
    | 'shipments'
    | 'purchases'
    | 'interventions'
    | 'expenses'
    | 'manufacturing'
    | 'contracts'
    | 'documents'
    | 'debug'
    | 'team'
    | 'chat';

// Shared Props for all tabs
export interface ProjectTabProps {
    project: Project;
    config: DolibarrConfig;
    onNavigate?: (view: AppView, id: string) => void;
    onRefresh?: () => void;
}

// Re-export common types for convenience
export type {
    Project,
    Task,
    Ticket,
    AgendaEvent,
    Intervention,
    ProjectContact,
    ThirdParty,
    Contact,
    Invoice,
    SupplierInvoice,
    Proposal,
    Order,
    SupplierOrder,
    Contract,
    ExpenseReport,
    DolibarrConfig,
    DolibarrDocument,
    AppView,
    Shipment,
    ManufacturingOrder,
    DolibarrUser
};
