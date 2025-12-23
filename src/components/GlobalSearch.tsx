import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Search, X, Users, FolderKanban, FileText, Package, Ticket as TicketIcon, ArrowRight, Command, ShoppingCart, FileSignature, Truck, UserCircle, TrendingUp } from 'lucide-react';
import { ThirdParty, Project, Invoice, Product, Ticket, AppView, Order, Contract, DolibarrUser, BankLine } from '../types';
import { useDolibarr } from '../context/DolibarrContext';
import { useCustomers, useSuppliers, useProjects, useInvoices, useOrders, useContracts, useTickets, useProducts, useUsers, useBankAccounts, useBankLines } from '../hooks/dolibarr';

interface GlobalSearchProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigate: (view: AppView, id: string) => void;
}

const GlobalSearch: React.FC<GlobalSearchProps> = ({ isOpen, onClose, onNavigate }) => {
  const { config } = useDolibarr();

  // Data Hooks
  const { data: customers = [] } = useCustomers(config);
  const { data: suppliers = [] } = useSuppliers(config);
  const { data: projects = [] } = useProjects(config);
  const { data: invoices = [] } = useInvoices(config);
  const { data: orders = [] } = useOrders(config);
  const { data: contracts = [] } = useContracts(config);
  const { data: tickets = [] } = useTickets(config);
  const { data: products = [] } = useProducts(config);
  const { data: users = [] } = useUsers(config);

  const { data: bankAccounts = [] } = useBankAccounts(config);
  const { data: bankLines = [] } = useBankLines(config, !!config && bankAccounts.length > 0);

  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
      setQuery('');
      setSelectedIndex(0);
    }
  }, [isOpen]);

  const results = useMemo(() => {
    if (!query.trim()) return [];

    const lowerQuery = query.toLowerCase();
    const limit = 4; // Max per category to keep list fast but diverse

    // Safety check for arrays (hooks might return undefined during loading if not handled)
    const safeCustomers = customers || [];
    const safeSuppliers = suppliers || [];
    const safeProjects = projects || [];
    const safeUsers = users || [];
    const safeInvoices = invoices || [];
    const safeOrders = orders || [];
    const safeContracts = contracts || [];
    const safeTickets = tickets || [];
    const safeProducts = products || [];
    const safeBankLines = bankLines || [];

    const matchedCustomers = safeCustomers
      .filter(c => c.name.toLowerCase().includes(lowerQuery) || c.email?.toLowerCase().includes(lowerQuery))
      .slice(0, limit)
      .map(c => ({ type: 'Cliente', id: c.id, label: c.name, subLabel: c.email || 'Sem email', icon: Users, view: 'customers' as AppView }));

    const matchedSuppliers = safeSuppliers
      .filter(s => s.name.toLowerCase().includes(lowerQuery) || s.email?.toLowerCase().includes(lowerQuery))
      .slice(0, limit)
      .map(s => ({ type: 'Fornecedor', id: s.id, label: s.name, subLabel: 'Fornecedor', icon: Truck, view: 'suppliers' as AppView }));

    const matchedProjects = safeProjects
      .filter(p => p.title.toLowerCase().includes(lowerQuery) || p.ref.toLowerCase().includes(lowerQuery))
      .slice(0, limit)
      .map(p => ({ type: 'Projeto', id: p.id, label: p.title, subLabel: p.ref, icon: FolderKanban, view: 'projects' as AppView }));

    const matchedUsers = safeUsers
      .filter(u => (u.firstname + ' ' + u.lastname + u.login).toLowerCase().includes(lowerQuery))
      .slice(0, limit)
      .map(u => ({ type: 'Usuário', id: u.id, label: `${u.firstname || ''} ${u.lastname || ''} (${u.login})`, subLabel: u.job || 'Funcionário', icon: UserCircle, view: 'hr' as AppView }));

    const matchedInvoices = safeInvoices
      .filter(i => i.ref.toLowerCase().includes(lowerQuery))
      .slice(0, limit)
      .map(i => ({ type: 'Fatura', id: i.id, label: i.ref, subLabel: `Total: $${i.total_ttc}`, icon: FileText, view: 'invoices' as AppView }));

    const matchedOrders = safeOrders
      .filter(o => o.ref.toLowerCase().includes(lowerQuery))
      .slice(0, limit)
      .map(o => ({ type: 'Pedido', id: o.id, label: o.ref, subLabel: `Pedido de Venda`, icon: ShoppingCart, view: 'orders' as AppView }));

    const matchedContracts = safeContracts
      .filter(c => c.ref.toLowerCase().includes(lowerQuery))
      .slice(0, limit)
      .map(c => ({ type: 'Contrato', id: c.id, label: c.ref, subLabel: `Contrato`, icon: FileSignature, view: 'contracts' as AppView }));

    const matchedTickets = safeTickets
      .filter(t => t.ref.toLowerCase().includes(lowerQuery) || t.subject.toLowerCase().includes(lowerQuery))
      .slice(0, limit)
      .map(t => ({ type: 'Chamado', id: t.id, label: t.subject, subLabel: t.ref, icon: TicketIcon, view: 'tickets' as AppView }));

    const matchedProducts = safeProducts
      .filter(p => p.label.toLowerCase().includes(lowerQuery) || p.ref.toLowerCase().includes(lowerQuery))
      .slice(0, limit)
      .map(p => ({ type: 'Produto', id: p.id, label: p.label, subLabel: p.ref, icon: Package, view: 'products' as AppView }));

    const matchedPayments = safeBankLines
      .filter(l => l.amount > 0 && (l.label.toLowerCase().includes(lowerQuery)))
      .slice(0, limit)
      .map(l => ({ type: 'Pagamento', id: '', label: l.label, subLabel: `$${l.amount}`, icon: TrendingUp, view: 'payments' as AppView }));

    return [
      ...matchedCustomers,
      ...matchedSuppliers,
      ...matchedProjects,
      ...matchedUsers,
      ...matchedInvoices,
      ...matchedOrders,
      ...matchedContracts,
      ...matchedTickets,
      ...matchedProducts,
      ...matchedPayments
    ];
  }, [query, customers, suppliers, projects, users, invoices, orders, contracts, products, tickets, bankLines]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => (prev + 1) % results.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => (prev - 1 + results.length) % results.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (results[selectedIndex]) {
        handleSelect(results[selectedIndex]);
      }
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  const handleSelect = (item: any) => {
    onNavigate(item.view, item.id);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh] px-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose}></div>

      <div className="relative w-full max-w-2xl bg-white dark:bg-slate-900 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        <div className="flex items-center gap-3 p-4 border-b border-slate-100 dark:border-slate-800">
          <Search className="text-slate-400" size={20} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setSelectedIndex(0); }}
            onKeyDown={handleKeyDown}
            placeholder="Buscar tudo (Pessoas, Pedidos, Faturas, Pagamentos...)"
            className="flex-1 bg-transparent outline-none text-lg text-slate-800 dark:text-white placeholder:text-slate-400"
          />
          <div className="flex items-center gap-2">
            <kbd className="hidden md:inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-slate-500 bg-slate-100 dark:bg-slate-800 rounded border border-slate-200 dark:border-slate-700">ESC</kbd>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={20} /></button>
          </div>
        </div>

        <div className="max-h-[60vh] overflow-y-auto p-2" ref={resultsRef}>
          {results.length === 0 ? (
            <div className="py-12 text-center text-slate-400">
              {query ? <p>Nenhum resultado para "{query}"</p> : <div className="flex flex-col items-center gap-2"><Command size={32} className="opacity-20" /><p>Digite para pesquisar no seu ERP...</p></div>}
            </div>
          ) : (
            results.map((item, idx) => (
              <div
                key={`${item.type}-${item.id || idx}`}
                onClick={() => handleSelect(item)}
                className={`flex items-center gap-4 p-3 rounded-lg cursor-pointer transition-colors ${idx === selectedIndex ? 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-900 dark:text-white' : 'hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300'}`}
              >
                <div className={`p-2 rounded-lg ${idx === selectedIndex ? 'bg-indigo-100 dark:bg-indigo-800 text-indigo-600 dark:text-indigo-300' : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400'}`}>
                  <item.icon size={18} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{item.label}</div>
                  <div className={`text-xs truncate ${idx === selectedIndex ? 'text-indigo-700/70 dark:text-indigo-300/70' : 'text-slate-500'}`}>{item.type.toUpperCase()} • {item.subLabel}</div>
                </div>
                {idx === selectedIndex && <ArrowRight size={16} className="text-indigo-500" />}
              </div>
            ))
          )}
        </div>

        {results.length > 0 && (
          <div className="bg-slate-50 dark:bg-slate-900 border-t border-slate-100 dark:border-slate-800 p-2 text-xs text-slate-400 flex justify-end px-4">
            Use <span className="font-bold mx-1">↑</span> <span className="font-bold mx-1">↓</span> para navegar, <span className="font-bold mx-1">Enter</span> para selecionar
          </div>
        )}
      </div>
    </div>
  );
};

export default GlobalSearch;
