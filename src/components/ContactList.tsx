import React, { useState, useMemo, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { Contact, AppView } from '../types';
import { Users, Search, Plus, Mail, Phone, Briefcase, Pencil, Trash2, CheckCircle2, UserCircle, Building2 } from 'lucide-react';
import { DolibarrService } from '../services/dolibarrService';
import { useDolibarr } from '../context/DolibarrContext';
import { useContacts, useCustomers } from '../hooks/dolibarr';
import { usePrefill, PrefillResult } from '../hooks/usePrefill';
import { useListControls } from '../hooks/useListControls';
import { logger } from '../utils/logger';
import { PageHeader, MasterDetailLayout, Card, Button, Input, Modal, EmptyState, ListToolbar, ConfirmDeleteButton } from './ui';

const log = logger.child('ContactList');

interface ContactListProps {
    onNavigate?: (view: AppView, id: string) => void;
    onRefresh?: () => void;
    initialItemId?: string;
}

const emptyForm = { firstname: '', lastname: '', email: '', phone_mobile: '', poste: '', socid: '' };
type ContactForm = typeof emptyForm;

const ContactList: React.FC<ContactListProps> = ({ onNavigate, onRefresh, initialItemId }) => {
    const { config, refreshData, canDo } = useDolibarr();
    const { data: contactsData, refetch: refetchContacts } = useContacts(config);
    const contacts = contactsData || [];
    const { data: customersData } = useCustomers(config);
    const customers = customersData || [];

    const [selectedContact, setSelectedContact] = useState<Contact | null>(null);

    const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
    const [createForm, setCreateForm] = useState<ContactForm>({ ...emptyForm });
    const [isCreating, setIsCreating] = useState(false);

    const [isEditModalOpen, setIsEditModalOpen] = useState(false);
    const [editForm, setEditForm] = useState<ContactForm>({ ...emptyForm });
    const [isSaving, setIsSaving] = useState(false);

    // Deeplink HITL do agente (#57): create_contact / edit_contact (aplica 1x por token).
    const prefill = usePrefill();
    const appliedPrefillRef = useRef<PrefillResult | null>(null);

    const refresh = () => { if (onRefresh) onRefresh(); else if (refreshData) refreshData(); };
    const customerName = (socid: string) => customers.find(c => String(c.id) === String(socid))?.name || (socid ? `#${socid}` : '—');

    // abrir detalhe quando navegado via rota /contacts/:id
    useEffect(() => {
        if (initialItemId && contacts.length > 0) {
            const t = contacts.find(c => String(c.id) === String(initialItemId));
            if (t) setSelectedContact(t);
        }
    }, [initialItemId, contacts]);

    useEffect(() => {
        if (!prefill || appliedPrefillRef.current === prefill) return;
        if (prefill.kind === 'create_contact') {
            appliedPrefillRef.current = prefill;
            setCreateForm({ ...emptyForm, ...prefill.data });
            setIsCreateModalOpen(true);
            toast.info('Revise os dados e confirme o cadastro do contato.');
        } else if (prefill.kind === 'edit_contact') {
            if (contacts.length === 0) return; // aguarda carregar
            appliedPrefillRef.current = prefill;
            const { id, ...changes } = prefill.data;
            const current = contacts.find(c => String(c.id) === String(id));
            if (!current) { toast.error('Contato não encontrado para edição.'); return; }
            setSelectedContact(current);
            setEditForm({
                firstname: changes.firstname ?? current.firstname ?? '',
                lastname: changes.lastname ?? current.lastname ?? '',
                email: changes.email ?? current.email ?? '',
                phone_mobile: changes.phone_mobile ?? current.phone_mobile ?? '',
                poste: changes.poste ?? current.poste ?? '',
                socid: current.socid ?? '',
            });
            setIsEditModalOpen(true);
            toast.info('Revise as mudanças sugeridas e salve.');
        }
    }, [prefill, contacts]);

    // Busca + ordenação padronizadas (#121).
    const controls = useListControls(contacts, {
        searchText: (c) => `${c.firstname || ''} ${c.lastname || ''} ${c.email || ''} ${customerName(c.socid)}`,
        sorts: [
            { key: 'name', label: 'Nome', get: (c) => `${c.firstname || ''} ${c.lastname || ''}`.trim() },
            { key: 'company', label: 'Cliente', get: (c) => customerName(c.socid) },
        ],
        initialSortKey: 'name',
    });
    const filtered = controls.result;

    if (!config) return <div className="p-8 text-center text-slate-500">Carregando configuração...</div>;

    const handleCreate = async () => {
        if (!createForm.firstname || !createForm.lastname || !createForm.socid) {
            toast.error('Nome, sobrenome e cliente são obrigatórios.');
            return;
        }
        setIsCreating(true);
        try {
            await DolibarrService.createContact(config, createForm);
            toast.success('Contato criado.');
            setIsCreateModalOpen(false);
            setCreateForm({ ...emptyForm });
            refresh();
        } catch (e: any) { log.error(e); toast.error(`Falha: ${e.message}`); } finally { setIsCreating(false); }
    };

    const handleSave = async () => {
        if (!selectedContact) return;
        setIsSaving(true);
        try {
            const { socid, ...rest } = editForm; // socid (cliente) não muda na edição
            await DolibarrService.updateContact(config, selectedContact.id, rest);
            toast.success('Contato atualizado.');
            setIsEditModalOpen(false);
            refresh();
        } catch (e: any) { log.error(e); toast.error(`Falha: ${e.message}`); } finally { setIsSaving(false); }
    };

    const openEdit = (c: Contact) => {
        setSelectedContact(c);
        setEditForm({
            firstname: c.firstname || '', lastname: c.lastname || '', email: c.email || '',
            phone_mobile: c.phone_mobile || '', poste: c.poste || '', socid: c.socid || ''
        });
        setIsEditModalOpen(true);
    };

    const renderForm = (form: ContactForm, setForm: React.Dispatch<React.SetStateAction<ContactForm>>, withCustomer: boolean) => (
        <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
                <Input label="Nome" required value={form.firstname} onChange={e => setForm({ ...form, firstname: e.target.value })} placeholder="João" />
                <Input label="Sobrenome" required value={form.lastname} onChange={e => setForm({ ...form, lastname: e.target.value })} placeholder="Silva" />
            </div>
            <Input label="E-mail" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="joao@empresa.com" />
            <div className="grid grid-cols-2 gap-3">
                <Input label="Celular" value={form.phone_mobile} onChange={e => setForm({ ...form, phone_mobile: e.target.value })} placeholder="11 99999-0000" />
                <Input label="Cargo" value={form.poste} onChange={e => setForm({ ...form, poste: e.target.value })} placeholder="Gerente" />
            </div>
            {withCustomer && (
                <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Cliente</label>
                    <select
                        className="w-full p-2 border border-slate-300 dark:border-slate-700 rounded-lg dark:bg-slate-800 dark:text-white text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                        value={form.socid}
                        onChange={e => setForm({ ...form, socid: e.target.value })}
                        required
                    >
                        <option value="">Selecione o cliente...</option>
                        {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                </div>
            )}
        </div>
    );

    return (
        <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-950 transition-colors">
            {/* Create Modal */}
            <Modal
                isOpen={isCreateModalOpen}
                onClose={() => setIsCreateModalOpen(false)}
                title="Novo Contato"
                size="sm"
                footer={
                    <>
                        <Button variant="secondary" onClick={() => setIsCreateModalOpen(false)}>Cancelar</Button>
                        <Button loading={isCreating} icon={<CheckCircle2 size={16} />} onClick={handleCreate}>Criar</Button>
                    </>
                }
            >
                {renderForm(createForm, setCreateForm, true)}
            </Modal>

            {/* Edit Modal */}
            <Modal
                isOpen={isEditModalOpen}
                onClose={() => setIsEditModalOpen(false)}
                title={`Editar: ${selectedContact?.firstname || ''} ${selectedContact?.lastname || ''}`}
                size="sm"
                footer={
                    <>
                        <Button variant="secondary" onClick={() => setIsEditModalOpen(false)}>Cancelar</Button>
                        <Button loading={isSaving} icon={<CheckCircle2 size={16} />} onClick={handleSave}>Salvar</Button>
                    </>
                }
            >
                {renderForm(editForm, setEditForm, false)}
            </Modal>

            <div className={selectedContact ? 'hidden lg:block' : 'block'}>
                <PageHeader
                    title="Contatos"
                    subtitle="Pessoas de contato dos clientes"
                    actions={
                        <div className="flex items-center gap-2">
                            <ListToolbar controls={controls} searchPlaceholder="Buscar contato..." />
                            {canDo('create', 'contacts') && (
                            <Button icon={<Plus size={18} />} onClick={() => { setCreateForm({ ...emptyForm }); setIsCreateModalOpen(true); }}>Novo</Button>
                            )}
                        </div>
                    }
                />
            </div>

            <MasterDetailLayout
                showDetail={!!selectedContact}
                onCloseDetail={() => setSelectedContact(null)}
                listWidth="1/3"
                list={
                    filtered.length === 0 ? (
                        <EmptyState icon={Users} title="Nenhum contato encontrado" description="Crie um novo contato ou ajuste a busca." />
                    ) : (
                        <div className="p-2 space-y-2 overflow-y-auto h-full">
                            {filtered.map(c => (
                                <Card key={c.id} onClick={() => setSelectedContact(c)} selected={selectedContact?.id === c.id} hoverable padding="md">
                                    <div className="flex items-center gap-2 mb-1">
                                        <UserCircle size={16} className="text-indigo-400 shrink-0" />
                                        <h4 className="font-bold text-slate-800 dark:text-white truncate text-sm flex-1">{c.firstname} {c.lastname}</h4>
                                        {canDo('delete', 'contacts') && (
                                        <ConfirmDeleteButton
                                            onDelete={() => DolibarrService.deleteContact(config, c.id)}
                                            onDeleted={() => { if (selectedContact?.id === c.id) setSelectedContact(null); refetchContacts(); }}
                                            itemLabel={`${c.firstname} ${c.lastname}`.trim()}
                                        />
                                        )}
                                    </div>
                                    <div className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-2 ml-6 truncate">
                                        <Mail size={12} className="opacity-50" /> {c.email || 'Sem e-mail'}
                                    </div>
                                    <div className="text-[11px] text-slate-500 flex items-center gap-2 ml-6 truncate">
                                        <Building2 size={12} className="opacity-50" /> {customerName(c.socid)}
                                    </div>
                                </Card>
                            ))}
                        </div>
                    )
                }
                detail={
                    selectedContact && (
                        <div className="flex flex-col h-full">
                            <PageHeader
                                title={`${selectedContact.firstname} ${selectedContact.lastname}`}
                                subtitle={selectedContact.poste || 'Contato'}
                                onBack={() => setSelectedContact(null)}
                                actions={
                                    <>
                                        {canDo('edit', 'contacts') && (
                                        <Button variant="ghost" size="sm" icon={<Pencil size={18} />} onClick={() => openEdit(selectedContact)} title="Editar" />
                                        )}
                                        {canDo('delete', 'contacts') && (
                                        <ConfirmDeleteButton
                                            onDelete={() => DolibarrService.deleteContact(config, selectedContact.id)}
                                            onDeleted={() => { setSelectedContact(null); refetchContacts(); }}
                                            itemLabel={`${selectedContact.firstname} ${selectedContact.lastname}`.trim()}
                                            iconSize={18}
                                        />
                                        )}
                                    </>
                                }
                            />
                            <div className="flex-1 overflow-y-auto p-6 bg-slate-50 dark:bg-slate-950/50">
                                <Card padding="lg" className="max-w-xl mx-auto space-y-3">
                                    <div className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200"><Mail size={16} className="text-indigo-500" /> {selectedContact.email || '—'}</div>
                                    <div className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200"><Phone size={16} className="text-indigo-500" /> {selectedContact.phone_mobile || '—'}</div>
                                    <div className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200"><Briefcase size={16} className="text-indigo-500" /> {selectedContact.poste || '—'}</div>
                                    <div
                                        className="flex items-center gap-2 text-sm text-indigo-600 dark:text-indigo-400 cursor-pointer hover:underline"
                                        onClick={() => onNavigate && onNavigate('customers', selectedContact.socid)}
                                    >
                                        <Building2 size={16} /> {customerName(selectedContact.socid)}
                                    </div>
                                </Card>
                            </div>
                        </div>
                    )
                }
            />
        </div>
    );
};

export default ContactList;
