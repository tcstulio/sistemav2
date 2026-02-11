
import React, { useState, useMemo } from 'react';
import { Shipment, AppView } from '../types';
import { Truck, Search, ExternalLink, Calendar, Package, Loader2, FilePlus, CheckCircle2 } from 'lucide-react';
import { DolibarrService } from '../services/dolibarrService';
import { useDolibarr } from '../context/DolibarrContext';
import { useShipments, useCustomers, useOrders, useUsers } from '../hooks/dolibarr';
import { LinkedObjects } from './common/LinkedObjects';
import { formatDateOnly, formatDateTime } from '../utils/dateUtils';
import { logger } from '../utils/logger';

const log = logger.child('ShipmentList');

// Design System
import { PageHeader, MasterDetailLayout, Card, Button, Input, Tabs, Tab, EmptyState, StatusBadge } from './ui';
import type { StatusConfig } from './ui';

const shipmentStatuses: Record<string, StatusConfig> = {
    '0': { label: 'Rascunho', variant: 'slate' },
    '1': { label: 'Validado', variant: 'blue', icon: <CheckCircle2 size={12} /> },
    '2': { label: 'Entregue', variant: 'emerald', icon: <Truck size={12} /> },
};

interface ShipmentListProps {
    onNavigate?: (view: AppView, id: string) => void;
    onRefresh?: () => void;
}

const ShipmentList: React.FC<ShipmentListProps> = ({ onNavigate, onRefresh }) => {
    const { config } = useDolibarr();
    const { data: shipmentsData } = useShipments(config);
    const shipments = shipmentsData || [];
    const { data: customersData } = useCustomers(config);
    const customers = customersData || [];
    const { data: ordersData } = useOrders(config);
    const orders = ordersData || [];
    const { data: usersData } = useUsers(config);
    const users = usersData || [];

    if (!config) return null;

    const [searchTerm, setSearchTerm] = useState('');
    const [selectedShipment, setSelectedShipment] = useState<Shipment | null>(null);
    const [isProcessing, setIsProcessing] = useState(false);

    const getCustomerName = (socid: string) => {
        const customer = customers.find(c => String(c.id) === String(socid));
        return customer ? customer.name : 'Cliente Desconhecido';
    };

    const getOrderRef = (orderId?: string) => {
        if (!orderId) return null;
        const order = orders.find(o => String(o.id) === String(orderId));
        return order ? order.ref : `Pedido #${orderId}`;
    };

    const resolveUserName = (authorId?: string) => {
        if (!authorId || authorId === 'System') return 'Sistema';
        const user = users.find(u => String(u.id) === String(authorId));
        if (user) return `${user.firstname || ''} ${user.lastname || ''}`.trim() || user.login;
        if (!isNaN(Number(authorId))) return `Usuário ${authorId}`;
        return authorId;
    };

    const filteredShipments = useMemo(() => {
        return shipments.filter(s => {
            const customerName = getCustomerName(s.socid).toLowerCase();
            const orderRef = getOrderRef(s.fk_commande)?.toLowerCase() || '';
            const matchesSearch =
                s.ref.toLowerCase().includes(searchTerm.toLowerCase()) ||
                customerName.includes(searchTerm.toLowerCase()) ||
                orderRef.includes(searchTerm.toLowerCase()) ||
                (s.tracking_number && s.tracking_number.toLowerCase().includes(searchTerm.toLowerCase()));

            return matchesSearch;
        }).sort((a, b) => b.date_creation - a.date_creation);
    }, [shipments, customers, orders, searchTerm]);

    const handleDownloadPdf = (e: React.MouseEvent, ref: string) => {
        e.stopPropagation();
        DolibarrService.downloadDocument(config, 'shipment', ref);
    };

    const handleCreateInvoice = async () => {
        if (!selectedShipment || !selectedShipment.fk_commande) return;
        setIsProcessing(true);
        try {
            await new Promise(r => setTimeout(r, 1000));
            alert("Fatura criada a partir do Envio (Ação Mock)!");
            if (onNavigate) onNavigate('orders', selectedShipment.fk_commande);
        } catch (e) {
            log.error(e);
            alert("Falha ao criar fatura");
        } finally {
            setIsProcessing(false);
        }
    };

    const renderHeader = (
        <div className={selectedShipment ? 'hidden lg:block' : 'block'}>
            <PageHeader
                title={
                    <span className="flex items-center gap-2">
                        <Truck className="text-indigo-500" size={24} /> Envios/Expedições
                    </span>
                }
                subtitle="Rastreie entregas e despachos"
                actions={
                    <Input
                        placeholder="Buscar envio, rastreio..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        icon={<Search size={16} />}
                        className="w-48 md:w-64"
                        fullWidth={false}
                    />
                }
            />
        </div>
    );

    const renderList = (
        <div className="p-4 md:p-6">
            {filteredShipments.length === 0 ? (
                <EmptyState icon={Truck} title="Nenhum envio encontrado" description="Tente ajustar a busca." />
            ) : (
                <div className="space-y-3">
                    {filteredShipments.map(ship => (
                        <Card
                            key={ship.id}
                            onClick={() => setSelectedShipment(ship)}
                            selected={selectedShipment?.id === ship.id}
                            className="cursor-pointer"
                        >
                            <div className="flex justify-between items-start mb-2">
                                <div className="flex items-center gap-2">
                                    <Truck size={16} className="text-slate-400" />
                                    <h4 className="font-bold text-slate-800 dark:text-white text-sm">{ship.ref}</h4>
                                </div>
                                <StatusBadge status={ship.status} config={shipmentStatuses} size="sm" />
                            </div>
                            <div className="text-sm text-slate-600 dark:text-slate-300 font-medium mb-1">
                                {getCustomerName(ship.socid)}
                            </div>
                            <div className="flex justify-between items-center mt-2 text-xs text-slate-500">
                                <span>{formatDateTime(ship.date_creation)}</span>
                                {ship.fk_commande && <span className="bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded text-slate-600 dark:text-slate-400">{getOrderRef(ship.fk_commande)}</span>}
                            </div>
                        </Card>
                    ))}
                </div>
            )}
        </div>
    );

    const renderDetail = selectedShipment ? (
        <>
            <PageHeader
                onBack={() => setSelectedShipment(null)}
                title={
                    <span className="flex items-center gap-2">
                        {selectedShipment.ref}
                        <StatusBadge status={selectedShipment.status} config={shipmentStatuses} />
                    </span>
                }
                subtitle="Detalhes de Logística"
                actions={
                    <div className="flex items-center gap-2">
                        {selectedShipment.status === '2' && (
                            <Button
                                size="sm"
                                icon={isProcessing ? <Loader2 size={14} className="animate-spin" /> : <FilePlus size={14} />}
                                onClick={handleCreateInvoice}
                                disabled={isProcessing}
                            >
                                Faturar
                            </Button>
                        )}
                        <Button variant="ghost" size="sm" icon={<ExternalLink size={16} />} onClick={(e) => handleDownloadPdf(e, selectedShipment.ref)} title="Baixar PDF" />
                    </div>
                }
            />

            <div className="flex-1 overflow-y-auto p-6 bg-slate-50 dark:bg-slate-950/50">
                <div className="max-w-3xl mx-auto space-y-6">
                    <div className="bg-white dark:bg-slate-900 p-6 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
                        <h3 className="font-bold text-slate-800 dark:text-white mb-4 border-b border-slate-100 dark:border-slate-800 pb-2">Informações</h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div>
                                <label className="text-xs text-slate-500 uppercase font-bold">Cliente</label>
                                <div
                                    className="flex items-center gap-2 mt-1 text-slate-800 dark:text-white font-medium cursor-pointer hover:underline hover:text-indigo-600 dark:hover:text-indigo-400"
                                    onClick={() => onNavigate && onNavigate('customers', selectedShipment.socid)}
                                >
                                    {getCustomerName(selectedShipment.socid)}
                                </div>
                            </div>
                            <div>
                                <label className="text-xs text-slate-500 uppercase font-bold">Data Criação</label>
                                <div className="flex items-center gap-2 mt-1 text-slate-800 dark:text-white font-medium">
                                    <Calendar size={16} className="text-indigo-500" />
                                    {formatDateTime(selectedShipment.date_creation)}
                                </div>
                            </div>
                            {selectedShipment.date_delivery && (
                                <div>
                                    <label className="text-xs text-slate-500 uppercase font-bold">Data Entrega</label>
                                    <div className="flex items-center gap-2 mt-1 text-slate-800 dark:text-white font-medium">
                                        <Calendar size={16} className="text-emerald-500" />
                                        {formatDateOnly(selectedShipment.date_delivery)}
                                    </div>
                                </div>
                            )}
                            {selectedShipment.fk_commande && (
                                <div>
                                    <label className="text-xs text-slate-500 uppercase font-bold">Pedido Origem</label>
                                    <div
                                        className="flex items-center gap-2 mt-1 text-indigo-600 dark:text-indigo-400 font-medium cursor-pointer hover:underline"
                                        onClick={() => onNavigate && onNavigate('orders', selectedShipment.fk_commande!)}
                                    >
                                        <Package size={16} /> {getOrderRef(selectedShipment.fk_commande)}
                                    </div>
                                </div>
                            )}
                            {selectedShipment.tracking_number && (
                                <div className="col-span-2">
                                    <label className="text-xs text-slate-500 uppercase font-bold">Número de Rastreio</label>
                                    <div className="mt-1 p-2 bg-slate-100 dark:bg-slate-800 rounded font-mono text-slate-800 dark:text-white select-all">
                                        {selectedShipment.tracking_number}
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-800 grid grid-cols-2 gap-4">
                            {selectedShipment.fk_user_author && (
                                <div>
                                    <label className="text-xs text-slate-500 uppercase font-bold">Autor</label>
                                    <div className="text-sm font-medium text-slate-800 dark:text-white">{resolveUserName(selectedShipment.fk_user_author)}</div>
                                </div>
                            )}
                            {selectedShipment.fk_user_valid && (
                                <div>
                                    <label className="text-xs text-slate-500 uppercase font-bold">Validado por</label>
                                    <div className="text-sm font-medium text-slate-800 dark:text-white">{resolveUserName(selectedShipment.fk_user_valid)}</div>
                                </div>
                            )}
                        </div>
                    </div>

                    <LinkedObjects
                        id={selectedShipment.id}
                        type="shipping"
                        onNavigate={onNavigate}
                    />
                </div>
            </div>
        </>
    ) : null;

    return (
        <div className="flex flex-col h-full">
            {renderHeader}
            <MasterDetailLayout
                list={renderList}
                detail={renderDetail}
                showDetail={!!selectedShipment}
                onCloseDetail={() => setSelectedShipment(null)}
            />
        </div>
    );
};

export default ShipmentList;
