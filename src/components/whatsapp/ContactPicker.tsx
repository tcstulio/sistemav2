import React, { useMemo, useState } from 'react';
import { Search, Building2, Users, UserCircle, Truck } from 'lucide-react';
import { ThirdParty, Contact } from '../../types/crm';

export interface CRMContactEntry {
    name: string;
    phone: string;
    type: 'customer' | 'contact' | 'supplier' | 'user';
    id: string;
    company?: string;
}

interface ContactPickerProps {
    customers: ThirdParty[];
    contacts: Contact[];
    suppliers: ThirdParty[];
    users: any[];
    onSelect: (entry: CRMContactEntry) => void;
}

const typeConfig: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
    customer: { label: 'Cliente', icon: <Building2 size={12} />, color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' },
    contact: { label: 'Contato', icon: <UserCircle size={12} />, color: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300' },
    supplier: { label: 'Fornecedor', icon: <Truck size={12} />, color: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300' },
    user: { label: 'Equipe', icon: <Users size={12} />, color: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300' },
};

export const ContactPicker: React.FC<ContactPickerProps> = ({
    customers,
    contacts,
    suppliers,
    users,
    onSelect
}) => {
    const [search, setSearch] = useState('');
    const [filterType, setFilterType] = useState<'all' | 'customer' | 'contact' | 'supplier' | 'user'>('all');

    const allEntries = useMemo(() => {
        const entries: CRMContactEntry[] = [];

        customers.forEach(c => {
            if (c.status !== '1') return;
            const phones = [c.phone, c.phone_mobile].filter(Boolean) as string[];
            phones.forEach(phone => {
                entries.push({ name: c.name, phone, type: 'customer', id: c.id, company: c.name });
            });
        });

        contacts.forEach(c => {
            if (c.statut !== '1') return;
            if (c.phone_mobile) {
                entries.push({
                    name: `${c.firstname || ''} ${c.lastname || ''}`.trim(),
                    phone: c.phone_mobile,
                    type: 'contact',
                    id: c.id,
                });
            }
        });

        suppliers.forEach(s => {
            if (s.status !== '1') return;
            const phones = [s.phone, s.phone_mobile].filter(Boolean) as string[];
            phones.forEach(phone => {
                entries.push({ name: s.name, phone, type: 'supplier', id: s.id, company: s.name });
            });
        });

        users.forEach(u => {
            if (u.statut === '0') return;
            if (u.phone_mobile) {
                entries.push({
                    name: `${u.firstname || ''} ${u.lastname || ''}`.trim() || u.login,
                    phone: u.phone_mobile,
                    type: 'user',
                    id: u.id,
                    company: 'Equipe',
                });
            }
        });

        return entries;
    }, [customers, contacts, suppliers, users]);

    const filtered = useMemo(() => {
        const searchLower = search.toLowerCase();
        return allEntries
            .filter(e => {
                if (filterType !== 'all' && e.type !== filterType) return false;
                if (!searchLower) return true;
                return e.name.toLowerCase().includes(searchLower)
                    || e.phone.includes(searchLower)
                    || (e.company || '').toLowerCase().includes(searchLower);
            })
            .slice(0, 50);
    }, [allEntries, search, filterType]);

    const getAvatarColor = (name: string) => {
        const colors = ['bg-red-500', 'bg-blue-500', 'bg-green-500', 'bg-yellow-500', 'bg-purple-500', 'bg-pink-500'];
        return colors[(name.length || 0) % colors.length];
    };

    return (
        <div className="flex flex-col gap-3">
            {/* Search */}
            <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                <input
                    type="text"
                    placeholder="Buscar por nome ou telefone..."
                    className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 dark:text-white"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    autoFocus
                />
            </div>

            {/* Filter tabs */}
            <div className="flex gap-1 flex-wrap">
                {(['all', 'customer', 'contact', 'supplier', 'user'] as const).map(type => (
                    <button
                        key={type}
                        onClick={() => setFilterType(type)}
                        className={`px-3 py-1 text-xs font-medium rounded-full transition-colors ${filterType === type
                            ? 'bg-green-600 text-white'
                            : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'
                        }`}
                    >
                        {type === 'all' ? 'Todos' : typeConfig[type].label}
                    </button>
                ))}
            </div>

            {/* Results */}
            <div className="max-h-[300px] overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-700">
                {filtered.length === 0 ? (
                    <div className="p-6 text-center text-sm text-slate-400">
                        {search ? 'Nenhum contato encontrado' : 'Nenhum contato com telefone cadastrado'}
                    </div>
                ) : (
                    filtered.map((entry, i) => {
                        const tc = typeConfig[entry.type];
                        return (
                            <button
                                key={`${entry.type}_${entry.id}_${entry.phone}_${i}`}
                                onClick={() => onSelect(entry)}
                                className="w-full flex items-center gap-3 p-3 hover:bg-slate-50 dark:hover:bg-slate-800/50 border-b border-slate-100 dark:border-slate-800 last:border-b-0 text-left transition-colors"
                            >
                                <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm shrink-0 ${getAvatarColor(entry.name)}`}>
                                    {entry.name ? entry.name[0].toUpperCase() : '?'}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                        <span className="font-medium text-sm text-slate-800 dark:text-white truncate">{entry.name}</span>
                                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded flex items-center gap-1 shrink-0 ${tc.color}`}>
                                            {tc.icon} {tc.label}
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-2 mt-0.5">
                                        <span className="text-xs text-slate-500 dark:text-slate-400">{entry.phone}</span>
                                        {entry.company && entry.type !== 'customer' && entry.type !== 'supplier' && (
                                            <span className="text-xs text-slate-400">- {entry.company}</span>
                                        )}
                                    </div>
                                </div>
                            </button>
                        );
                    })
                )}
            </div>

            <p className="text-xs text-slate-400 text-center">
                {allEntries.length} contatos com telefone{filtered.length < allEntries.length ? ` (mostrando ${filtered.length})` : ''}
            </p>
        </div>
    );
};
