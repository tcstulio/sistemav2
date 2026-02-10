import React, { Suspense } from 'react';
import { BrowserRouter, Routes, Route, useParams, useNavigate } from 'react-router-dom';
import { useDolibarr } from '../context/DolibarrContext';
import { Loader2 } from 'lucide-react';
import { RestrictedAccess } from './RestrictedAccess';
import { ErrorBoundary } from './ui/ErrorBoundary';
import { Toaster } from 'sonner';

// Static imports (critical path - always needed)
import Dashboard from './Dashboard';
import SetupWizard from './SetupWizard';
import { MainLayout } from './Layout/MainLayout';
import { useNotifications } from '../hooks/useNotifications';
import NotFound from './NotFound';
import { DolibarrConfig } from '../types';

// Lazy imports - Route components loaded on demand
const CustomerList = React.lazy(() => import('./CustomerList').then(m => ({ default: m.CustomerList })));
const InvoiceList = React.lazy(() => import('./InvoiceList'));
const ProductList = React.lazy(() => import('./ProductList'));
const ProposalList = React.lazy(() => import('./ProposalList'));
const SupplierProposalList = React.lazy(() => import('./SupplierProposalList'));
const SmartQuotationWizard = React.lazy(() => import('./SmartQuotationWizard').then(m => ({ default: m.SmartQuotationWizard })));
const OrderList = React.lazy(() => import('./OrderList'));
const ProjectList = React.lazy(() => import('./ProjectList'));
const TicketList = React.lazy(() => import('./TicketList'));
const BankAccountList = React.lazy(() => import('./BankAccountList'));
const SupplierList = React.lazy(() => import('./SupplierList').then(m => ({ default: m.SupplierList })));
const VenueList = React.lazy(() => import('./VenueList').then(m => ({ default: m.VenueList })));
const SupplierInvoiceList = React.lazy(() => import('./SupplierInvoiceList'));
const SettingsView = React.lazy(() => import('./Settings'));
const HRList = React.lazy(() => import('./HRList'));
const InventoryView = React.lazy(() => import('./InventoryView').then(m => ({ default: m.InventoryView })));
const ReportsView = React.lazy(() => import('./ReportsView'));
const DevelopmentView = React.lazy(() => import('./DevelopmentView'));
const ManufacturingView = React.lazy(() => import('./ManufacturingView'));
const InterventionList = React.lazy(() => import('./InterventionList'));
const ContractList = React.lazy(() => import('./ContractList'));
const AgendaView = React.lazy(() => import('./AgendaView'));
const AgendaEntryDetail = React.lazy(() => import('./AgendaEntryDetail'));
const ShipmentList = React.lazy(() => import('./ShipmentList'));
const PaymentList = React.lazy(() => import('./PaymentList'));
const CategoryList = React.lazy(() => import('./CategoryList'));
const WhatsAppView = React.lazy(() => import('./WhatsAppView'));
const EmailView = React.lazy(() => import('./Email/EmailView'));
const SchedulerAdmin = React.lazy(() => import('./SchedulerAdmin'));
const ActivityView = React.lazy(() => import('./ActivityView'));
const TaskDetail = React.lazy(() => import('./TaskDetail'));
const PendingPayments = React.lazy(() => import('./PendingPayments').then(m => ({ default: m.PendingPayments })));
const SupplierPaymentList = React.lazy(() => import('./SupplierPaymentList'));
const SalaryPaymentList = React.lazy(() => import('./HR/SalaryPaymentList'));
const TaxPaymentList = React.lazy(() => import('./Finance/TaxPaymentList'));
const ExpenseReportPaymentList = React.lazy(() => import('./Finance/ExpenseReportPaymentList'));
const TaxPaymentDetail = React.lazy(() => import('./Finance/TaxPaymentDetail'));
const UserTaskDashboard = React.lazy(() => import('./Tasks/UserTaskDashboard'));
const MonthlyReport = React.lazy(() => import('../pages/Reports/MonthlyReport').then(m => ({ default: m.MonthlyReport })));
const ChatPage = React.lazy(() => import('../pages/ChatPage').then(m => ({ default: m.ChatPage })));
const ChatConversation = React.lazy(() => import('../pages/ChatPage').then(m => ({ default: m.ChatConversation })));
const Simulator = React.lazy(() => import('../pages/Simulator'));
const CentroVibeManager = React.lazy(() => import('./CentroVibe/CentroVibeManager'));

interface ViewWrapperProps {
    Component: React.ComponentType<{
        config: DolibarrConfig | null;
        onNavigate: (view: string, id?: string) => void;
        initialItemId?: string;
        onRefresh: (options?: { forceFull?: boolean; limit?: number; page?: number; query?: string }) => Promise<void>;
        [key: string]: unknown;
    }>;
    viewId?: string;
    passProps?: Record<string, unknown>;
}

const ViewWrapper: React.FC<ViewWrapperProps> = ({ Component, viewId, passProps = {} }) => {
    const { id } = useParams();
    const navigate = useNavigate();
    const { config, canAccess, refreshData } = useDolibarr();

    // Route Guard
    if (canAccess && viewId && !canAccess(viewId)) {
        return <RestrictedAccess view={viewId} />;
    }

    const handleNavigate = (view: string, itemId: string = '') => {
        if (itemId) navigate(`/${view}/${itemId}`);
        else navigate(`/${view}`);
    };

    return (
        <Component
            {...passProps}
            config={config}
            onNavigate={handleNavigate}
            initialItemId={id}
            onRefresh={refreshData}
        />
    );
};

// Notification Handler Component
const NotificationHandler = () => {
    const { setNotifications } = useDolibarr();
    const navigate = useNavigate();

    const handleNavigate = (view: string, id: string) => {
        if (id) navigate(`/${view}/${id}`);
        else navigate(`/${view}`);
    };

    useNotifications(setNotifications, handleNavigate);

    return null;
};

const App: React.FC = () => {
    const { config, setConfig, isInitialized } = useDolibarr();

    if (!isInitialized) {
        return (
            <div className="flex h-screen w-full items-center justify-center bg-slate-50 dark:bg-slate-950">
                <div className="flex flex-col items-center gap-4">
                    <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
                    <p className="text-sm font-medium text-slate-500 animate-pulse">Iniciando sistema...</p>
                </div>
            </div>
        );
    }

    if (!config) {
        return <SetupWizard onComplete={setConfig} />;
    }

    return (
        <>
            <Toaster richColors position="top-right" />
            <BrowserRouter>
                <NotificationHandler />
                <ErrorBoundary componentName="CoolGroove Sistema">
                <Suspense fallback={
                    <div className="flex h-screen w-full items-center justify-center bg-slate-50 dark:bg-slate-950">
                        <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
                    </div>
                }>
                <Routes>
                    <Route element={<MainLayout />}>
                        <Route path="/" element={<ViewWrapper Component={Dashboard} viewId="dashboard" />} />
                        <Route path="/my-tasks" element={<ViewWrapper Component={UserTaskDashboard} viewId="projects" />} />

                        <Route path="/whatsapp" element={<ViewWrapper Component={WhatsAppView} viewId="whatsapp" />} />
                        <Route path="/email" element={<ViewWrapper Component={EmailView} viewId="email" />} />
                        <Route path="/automation" element={<ViewWrapper Component={SchedulerAdmin} viewId="whatsapp" />} />

                        <Route path="/customers" element={<ViewWrapper Component={CustomerList} viewId="customers" />} />
                        <Route path="/customers/:id" element={<ViewWrapper Component={CustomerList} viewId="customers" />} />

                        <Route path="/suppliers" element={<ViewWrapper Component={SupplierList} viewId="suppliers" />} />
                        <Route path="/suppliers/:id" element={<ViewWrapper Component={SupplierList} viewId="suppliers" />} />

                        <Route path="/venues" element={<ViewWrapper Component={VenueList} viewId="partnerships" />} />
                        <Route path="/venues/:id" element={<ViewWrapper Component={VenueList} viewId="partnerships" />} />

                        <Route path="/invoices" element={<ViewWrapper Component={InvoiceList} viewId="invoices" />} />
                        <Route path="/invoices/:id" element={<ViewWrapper Component={InvoiceList} viewId="invoices" />} />

                        <Route path="/supplier_invoices" element={<ViewWrapper Component={SupplierInvoiceList} viewId="supplier_invoices" />} />
                        <Route path="/supplier_invoices/:id" element={<ViewWrapper Component={SupplierInvoiceList} viewId="supplier_invoices" />} />

                        <Route path="/pending_payments" element={<ViewWrapper Component={PendingPayments} viewId="invoices" />} />

                        <Route path="/proposals" element={<ViewWrapper Component={ProposalList} viewId="proposals" />} />
                        <Route path="/proposals/:id" element={<ViewWrapper Component={ProposalList} viewId="proposals" />} />

                        <Route path="/supplier_proposals" element={<ViewWrapper Component={SupplierProposalList} viewId="supplier_proposals" />} />
                        <Route path="/supplier_proposals/:id" element={<ViewWrapper Component={SupplierProposalList} viewId="supplier_proposals" />} />
                        <Route path="/smart_quotation" element={<ViewWrapper Component={SmartQuotationWizard} viewId="supplier_proposals" />} />

                        <Route path="/orders" element={<ViewWrapper Component={OrderList} viewId="orders" />} />
                        <Route path="/orders/:id" element={<ViewWrapper Component={OrderList} viewId="orders" />} />

                        <Route path="/shipments" element={<ViewWrapper Component={ShipmentList} viewId="shipments" />} />

                        <Route path="/projects" element={<ViewWrapper Component={ProjectList} viewId="projects" />} />
                        <Route path="/projects/:id" element={<ViewWrapper Component={ProjectList} viewId="projects" />} />

                        <Route path="/tasks" element={<ViewWrapper Component={TaskDetail} viewId="projects" />} />
                        <Route path="/tasks/:id" element={<ViewWrapper Component={TaskDetail} viewId="projects" />} />

                        <Route path="/tickets" element={<ViewWrapper Component={TicketList} viewId="tickets" />} />
                        <Route path="/tickets/:id" element={<ViewWrapper Component={TicketList} viewId="tickets" />} />

                        <Route path="/bank_accounts" element={<ViewWrapper Component={BankAccountList} viewId="bank_accounts" />} />

                        <Route path="/products" element={<ViewWrapper Component={ProductList} viewId="products" passProps={{ initialFilter: 'product' }} />} />
                        <Route path="/products/:id" element={<ViewWrapper Component={ProductList} viewId="products" passProps={{ initialFilter: 'product' }} />} />

                        <Route path="/services" element={<ViewWrapper Component={ProductList} viewId="products" passProps={{ initialFilter: 'service' }} />} />
                        <Route path="/services/:id" element={<ViewWrapper Component={ProductList} viewId="products" passProps={{ initialFilter: 'service' }} />} />

                        <Route path="/categories" element={<ViewWrapper Component={CategoryList} viewId="categories" />} />

                        <Route path="/inventory" element={<ViewWrapper Component={InventoryView} viewId="inventory" />} />

                        <Route path="/manufacturing" element={<ViewWrapper Component={ManufacturingView} viewId="manufacturing" />} />

                        <Route path="/interventions" element={<ViewWrapper Component={InterventionList} viewId="interventions" />} />

                        <Route path="/contracts" element={<ViewWrapper Component={ContractList} viewId="contracts" />} />

                        <Route path="/hr" element={<ViewWrapper Component={HRList} viewId="hr" />} />
                        <Route path="/hr/:id" element={<ViewWrapper Component={HRList} viewId="hr" />} />

                        <Route path="/agenda" element={<ViewWrapper Component={AgendaView} viewId="agenda" />} />
                        <Route path="/agenda/:id" element={<ViewWrapper Component={AgendaEntryDetail} viewId="agenda" />} />

                        <Route path="/payments" element={<ViewWrapper Component={PaymentList} viewId="payments" />} />
                        <Route path="/payments/:id" element={<ViewWrapper Component={PaymentList} viewId="payments" />} />
                        <Route path="/supplier_payments" element={<ViewWrapper Component={SupplierPaymentList} viewId="supplier_invoices" />} />
                        <Route path="/supplier_payments/:id" element={<ViewWrapper Component={SupplierPaymentList} viewId="supplier_invoices" />} />
                        <Route path="/tax_payments" element={<ViewWrapper Component={TaxPaymentList} viewId="tax_payments" />} />
                        <Route path="/tax_payments/:id" element={<ViewWrapper Component={TaxPaymentDetail} viewId="tax_payments" />} />
                        <Route path="/salary_payments" element={<ViewWrapper Component={SalaryPaymentList} viewId="salary_payments" />} />
                        <Route path="/salary_payments/:id" element={<ViewWrapper Component={SalaryPaymentList} viewId="salary_payments" />} />
                        <Route path="/expense_report_payments" element={<ViewWrapper Component={ExpenseReportPaymentList} viewId="expense_report_payments" />} />
                        <Route path="/expense_report_payments/:id" element={<ViewWrapper Component={ExpenseReportPaymentList} viewId="expense_report_payments" />} />

                        <Route path="/reports" element={<ViewWrapper Component={ReportsView} viewId="reports" />} />
                        <Route path="/monthly-report" element={<ViewWrapper Component={MonthlyReport} viewId="reports" />} />

                        <Route path="/activity" element={<ViewWrapper Component={ActivityView} viewId="activity" />} />

                        <Route path="/development" element={<ViewWrapper Component={DevelopmentView} viewId="development" />} />

                        <Route path="/settings" element={<ViewWrapper Component={SettingsView} viewId="settings" />} />

                        <Route path="/chat" element={<ViewWrapper Component={ChatPage} viewId="chat" />}>
                            <Route index element={<ChatConversation />} />
                            <Route path=":type/:id" element={<ChatConversation />} />
                        </Route>

                        <Route path="/simulator" element={<ViewWrapper Component={Simulator} viewId="simulator" />} />
                        <Route path="/centrovibe" element={<ViewWrapper Component={CentroVibeManager} viewId="centrovibe" />} />
                        <Route path="*" element={<NotFound />} />
                    </Route>
                </Routes>
                </Suspense>
                </ErrorBoundary>
            </BrowserRouter>
        </>
    );
};

export default App;