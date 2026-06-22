import React, { useState } from 'react';
import { toast } from 'sonner';
import { Contact, DolibarrConfig } from '../../types';
import { useContacts } from '../../hooks/dolibarr';
import { DolibarrService } from '../../services/dolibarrService';
import { logger } from '../../utils/logger';
import { Card, Button, Input, Modal, EmptyState, ConfirmDeleteButton } from '../ui';
import { Users, Plus, Mail, Phone, Briefcase, CheckCircle2, UserCircle, Pencil } from 'lucide-react';

const log = logger.child('ThirdPartyContacts');

interface ThirdPartyContactsProps {
    socid: string;
    config: DolibarrConfig;
}

const emptyForm = { firstname: '', lastname: '', email: '', phone_mobile: '', poste: '' };
type ContactForm = typeof emptyForm;

export const ThirdPartyContacts: React.FC<ThirdPartyContactsProps> = ({ socid, config }) => {
    const { data: allContacts = [], refetch } = useContacts(config);
    const contacts = allContacts.filter(c => String(c.socid) === String(socid));

    const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
    const [createForm, setCreateForm] = useState<ContactForm>({ ...emptyForm });
    const [isCreating, setIsCreating] = useState(false);

    const [isEditModalOpen, setIsEditModalOpen] = useState(false);
    const [editForm, setEditForm] = useState<ContactForm>({ ...emptyForm });
    const [editingContact, setEditingContact] = useState<Contact | null>(null);
    const [isSaving, setIsSaving] = useState(false);

    const handleCreate = async () => {
        if (!createForm.firstname || !createForm.lastname) {
            toast.error('Nome e sobrenome são obrigatórios.');
            return;
        }
        setIsCreating(true);
        try {
            await DolibarrService.createContact(config, { ...createForm, socid, fk_soc: socid });
            toast.success('Responsável criado.');
            setIsCreateModalOpen(false);
            setCreateForm({ ...emptyForm });
            refetch();
        } catch (e: any) {
            log.error(e);
            toast.error(`Falha ao criar: ${e.message}`);
        } finally {
            setIsCreating(false);
        }
    };

    const handleSave = async () => {
        if (!editingContact) return;
        setIsSaving(true);
        try {
            await DolibarrService.updateContact(config, editingContact.id, editForm);
            toast.success('Responsável atualizado.');
            setIsEditModalOpen(false);
            setEditingContact(null);
            refetch();
        } catch (e: any) {
            log.error(e);
            toast.error(`Falha ao salvar: ${e.message}`);
        } finally {
            setIsSaving(false);
        }
    };

    const openEdit = (c: Contact) => {
        setEditingContact(c);
        setEditForm({
            firstname: c.firstname || '',
            lastname: c.lastname || '',
            email: c.email || '',
            phone_mobile: c.phone_mobile || '',
            poste: c.poste || '',
        });
        setIsEditModalOpen(true);
    };

    const renderForm = (form: ContactForm, setForm: React.Dispatch<React.SetStateAction<ContactForm>>) => (
        <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
                <Input
                    label="Nome"
                    required
                    value={form.firstname}
                    onChange={e => setForm({ ...form, firstname: e.target.value })}
                    placeholder="João"
                />
                <Input
                    label="Sobrenome"
                    required
                    value={form.lastname}
                    onChange={e => setForm({ ...form, lastname: e.target.value })}
                    placeholder="Silva"
                />
            </div>
            <Input
                label="E-mail"
                value={form.email}
                onChange={e => setForm({ ...form, email: e.target.value })}
                placeholder="joao@empresa.com"
            />
            <div className="grid grid-cols-2 gap-3">
                <Input
                    label="Celular"
                    value={form.phone_mobile}
                    onChange={e => setForm({ ...form, phone_mobile: e.target.value })}
                    placeholder="11 99999-0000"
                />
                <Input
                    label="Cargo"
                    value={form.poste}
                    onChange={e => setForm({ ...form, poste: e.target.value })}
                    placeholder="Gerente"
                />
            </div>
        </div>
    );

    return (
        <div className="space-y-4">
            {/* Create Modal */}
            <Modal
                isOpen={isCreateModalOpen}
                onClose={() => setIsCreateModalOpen(false)}
                title="Novo Responsável"
                size="sm"
                footer={
                    <>
                        <Button variant="secondary" onClick={() => setIsCreateModalOpen(false)}>Cancelar</Button>
                        <Button loading={isCreating} icon={<CheckCircle2 size={16} />} onClick={handleCreate}>Criar</Button>
                    </>
                }
            >
                {renderForm(createForm, setCreateForm)}
            </Modal>

            {/* Edit Modal */}
            <Modal
                isOpen={isEditModalOpen}
                onClose={() => { setIsEditModalOpen(false); setEditingContact(null); }}
                title={`Editar: ${editingContact?.firstname || ''} ${editingContact?.lastname || ''}`}
                size="sm"
                footer={
                    <>
                        <Button variant="secondary" onClick={() => { setIsEditModalOpen(false); setEditingContact(null); }}>Cancelar</Button>
                        <Button loading={isSaving} icon={<CheckCircle2 size={16} />} onClick={handleSave}>Salvar</Button>
                    </>
                }
            >
                {renderForm(editForm, setEditForm)}
            </Modal>

            <div className="flex justify-between items-center">
                <h3 className="font-bold text-slate-800 dark:text-white flex items-center gap-2">
                    <Users size={18} className="text-indigo-500" />
                    Responsáveis / Contatos
                </h3>
                <Button
                    size="sm"
                    icon={<Plus size={16} />}
                    onClick={() => { setCreateForm({ ...emptyForm }); setIsCreateModalOpen(true); }}
                >
                    Adicionar
                </Button>
            </div>

            {contacts.length === 0 ? (
                <EmptyState
                    icon={UserCircle}
                    title="Nenhum responsável cadastrado"
                    description="Adicione um responsável para este cadastro."
                    action={
                        <Button size="sm" icon={<Plus size={16} />} onClick={() => { setCreateForm({ ...emptyForm }); setIsCreateModalOpen(true); }}>
                            Adicionar Responsável
                        </Button>
                    }
                />
            ) : (
                <div className="space-y-3">
                    {contacts.map(c => (
                        <Card key={c.id} padding="md">
                            <div className="flex justify-between items-start">
                                <div className="flex items-start gap-3 flex-1 min-w-0">
                                    <UserCircle size={32} className="text-indigo-400 shrink-0 mt-0.5" />
                                    <div className="min-w-0">
                                        <div className="font-semibold text-slate-800 dark:text-white text-sm">
                                            {c.firstname} {c.lastname}
                                        </div>
                                        {c.poste && (
                                            <div className="flex items-center gap-1.5 text-xs text-slate-500 mt-0.5">
                                                <Briefcase size={11} className="opacity-60" />
                                                {c.poste}
                                            </div>
                                        )}
                                        {c.email && (
                                            <div className="flex items-center gap-1.5 text-xs text-slate-500 mt-0.5">
                                                <Mail size={11} className="opacity-60" />
                                                {c.email}
                                            </div>
                                        )}
                                        {c.phone_mobile && (
                                            <div className="flex items-center gap-1.5 text-xs text-slate-500 mt-0.5">
                                                <Phone size={11} className="opacity-60" />
                                                {c.phone_mobile}
                                            </div>
                                        )}
                                    </div>
                                </div>
                                <div className="flex items-center gap-1 shrink-0 ml-2">
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        icon={<Pencil size={14} />}
                                        onClick={() => openEdit(c)}
                                        title="Editar responsável"
                                    />
                                    <ConfirmDeleteButton
                                        onDelete={() => DolibarrService.deleteContact(config, c.id)}
                                        onDeleted={() => refetch()}
                                        itemLabel={`${c.firstname} ${c.lastname}`}
                                    />
                                </div>
                            </div>
                        </Card>
                    ))}
                </div>
            )}
        </div>
    );
};
