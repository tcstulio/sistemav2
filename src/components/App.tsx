import React, { useMemo } from 'react';
import { BrowserRouter, Routes, Route, useParams, useNavigate } from 'react-router-dom';
import { useDolibarr } from '../context/DolibarrContext';
import { MainLayout } from './Layout/MainLayout';
import { RestrictedAccess } from './RestrictedAccess';
import { Toaster } from 'sonner';

// Components
import Dashboard from './Dashboard';
import { CustomerList } from './CustomerList';
import InvoiceList from './InvoiceList';
import ProductList from './ProductList';
import ProposalList from './ProposalList';
import OrderList from './OrderList';
import ProjectList from './ProjectList';
import TicketList from './TicketList';
import BankAccountList from './BankAccountList';
import { SupplierList } from './SupplierList';
import SupplierInvoiceList from './SupplierInvoiceList';
import SettingsView from './Settings';
import SetupWizard from './SetupWizard';
import HRList from './HRList';
import { InventoryView } from './InventoryView';
import ReportsView from './ReportsView';
import DevelopmentView from './DevelopmentView';
import ManufacturingView from './ManufacturingView';
import InterventionList from './InterventionList';
import ContractList from './ContractList';
import AgendaView from './AgendaView';
import AgendaEntryDetail from './AgendaEntryDetail';
import ShipmentList from './ShipmentList';
import PaymentList from './PaymentList';
import CategoryList from './CategoryList';
import WhatsAppView from './WhatsAppView';
import EmailView from './Email/EmailView';
import SchedulerAdmin from './SchedulerAdmin';
import ActivityView from './ActivityView';
import TaskDetail from './TaskDetail';
import { PendingPayments } from './PendingPayments';


// Wrapper to adapt Router Params/Navigate to Legacy Component Props
const ViewWrapper = ({ Component, viewId, passProps = {} }: any) => {
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

const App: React.FC = () => {
    const { config, setConfig } = useDolibarr();

    if (!config) {
        return <SetupWizard onComplete={setConfig} />;
    }

    return (
        <>
            <Toaster richColors position="top-right" />
            <BrowserRouter>
                <Routes>
                    <Route element={<MainLayout />}>
                        <Route path="/" element={<ViewWrapper Component={Dashboard} viewId="dashboard" />} />

                        <Route path="/whatsapp" element={<ViewWrapper Component={WhatsAppView} viewId="whatsapp" />} />
                        <Route path="/email" element={<ViewWrapper Component={EmailView} viewId="email" />} />
                        <Route path="/automation" element={<ViewWrapper Component={SchedulerAdmin} viewId="whatsapp" />} />

                        <Route path="/customers" element={<ViewWrapper Component={CustomerList} viewId="customers" />} />
                        <Route path="/customers/:id" element={<ViewWrapper Component={CustomerList} viewId="customers" />} />

                        <Route path="/suppliers" element={<ViewWrapper Component={SupplierList} viewId="suppliers" />} />
                        <Route path="/suppliers/:id" element={<ViewWrapper Component={SupplierList} viewId="suppliers" />} />

                        <Route path="/invoices" element={<ViewWrapper Component={InvoiceList} viewId="invoices" />} />
                        <Route path="/invoices/:id" element={<ViewWrapper Component={InvoiceList} viewId="invoices" />} />

                        <Route path="/supplier_invoices" element={<ViewWrapper Component={SupplierInvoiceList} viewId="supplier_invoices" />} />
                        <Route path="/supplier_invoices/:id" element={<ViewWrapper Component={SupplierInvoiceList} viewId="supplier_invoices" />} />

                        <Route path="/pending_payments" element={<ViewWrapper Component={PendingPayments} viewId="invoices" />} />

                        <Route path="/proposals" element={<ViewWrapper Component={ProposalList} viewId="proposals" />} />
                        <Route path="/proposals/:id" element={<ViewWrapper Component={ProposalList} viewId="proposals" />} />

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

                        <Route path="/reports" element={<ViewWrapper Component={ReportsView} viewId="reports" />} />

                        <Route path="/activity" element={<ViewWrapper Component={ActivityView} viewId="activity" />} />

                        <Route path="/development" element={<ViewWrapper Component={DevelopmentView} viewId="development" />} />



                        <Route path="/perfil" element={<SettingsView config={config} onSave={setConfig} />} />
                    </Route>
                </Routes>
            </BrowserRouter>
        </>
    );
};


export default App;