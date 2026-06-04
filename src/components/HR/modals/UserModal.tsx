import React, { useState, useEffect } from 'react';
import { DolibarrConfig, DolibarrUser } from '../../../types';
import { DolibarrService } from '../../../services/dolibarrService';
import { Loader2 } from 'lucide-react';
import { logger } from '../../../utils/logger';

const log = logger.child('UserModal');

interface UserModalProps {
    isOpen: boolean;
    onClose: () => void;
    config: DolibarrConfig;
    users?: DolibarrUser[]; // Added users list
    userToEdit?: DolibarrUser | null;
    prefillData?: Partial<DolibarrUser> | null;
    onRefresh?: () => void;
}

export const UserModal: React.FC<UserModalProps> = ({
    isOpen,
    onClose,
    config,
    users = [], // Default to empty array
    userToEdit,
    prefillData,
    onRefresh
}) => {
    const [userForm, setUserForm] = useState<Partial<DolibarrUser> & { supervisor_id?: string }>({ login: '', firstname: '', lastname: '', email: '', job: '', supervisor_id: '' });
    const [isSubmittingUser, setIsSubmittingUser] = useState(false);

    useEffect(() => {
        if (isOpen) {
            if (userToEdit) {
                setUserForm({
                    login: userToEdit.login,
                    firstname: userToEdit.firstname || '',
                    lastname: userToEdit.lastname || '',
                    email: userToEdit.email || '',
                    job: userToEdit.job || '',
                    supervisor_id: userToEdit.supervisor_id || '',
                    ...(prefillData || {}), // deeplink: sobrepõe as mudanças sugeridas pelo agente
                });
            } else if (prefillData) {
                setUserForm({ ...prefillData, supervisor_id: '' });
            } else {
                setUserForm({ login: '', firstname: '', lastname: '', email: '', job: '', supervisor_id: '' });
            }
        }
    }, [isOpen, userToEdit, prefillData]);

    const handleUserSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!userForm.login || !userForm.email) return;
        setIsSubmittingUser(true);

        // Map supervisor_id to fk_user for API
        const payload: any = { ...userForm };
        if (payload.supervisor_id) {
            payload.fk_user = payload.supervisor_id;
            // delete payload.supervisor_id; // Clean up? API usually ignores extra fields but safer to keep clean if mapped
        } else {
            payload.fk_user = null; // Or '0'? Dolibarr usually takes null or specific ID.
        }

        try {
            if (userToEdit && userToEdit.id) {
                await DolibarrService.updateUser(config, userToEdit.id, payload);
                alert("Usuário atualizado com sucesso");
            } else {
                await DolibarrService.createUser(config, payload);
                alert("Usuário criado com sucesso");
            }
            onClose();
            if (onRefresh) onRefresh();
        } catch (e) { log.error(e); } finally { setIsSubmittingUser(false); }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-white dark:bg-slate-900 rounded-xl p-6 w-full max-w-md shadow-2xl border border-slate-200 dark:border-slate-800 animate-in zoom-in-95">
                <h3 className="font-bold text-lg mb-4 dark:text-white">{userToEdit ? 'Editar Usuário' : 'Novo Usuário'}</h3>
                <div className="space-y-3">
                    <input className="w-full p-2 border rounded dark:bg-slate-800 dark:border-slate-700 dark:text-white" placeholder="Login" value={userForm.login} onChange={e => setUserForm({ ...userForm, login: e.target.value })} disabled={!!userToEdit} />
                    <div className="grid grid-cols-2 gap-3">
                        <input className="w-full p-2 border rounded dark:bg-slate-800 dark:border-slate-700 dark:text-white" placeholder="Nome" value={userForm.firstname} onChange={e => setUserForm({ ...userForm, firstname: e.target.value })} />
                        <input className="w-full p-2 border rounded dark:bg-slate-800 dark:border-slate-700 dark:text-white" placeholder="Sobrenome" value={userForm.lastname} onChange={e => setUserForm({ ...userForm, lastname: e.target.value })} />
                    </div>
                    <input className="w-full p-2 border rounded dark:bg-slate-800 dark:border-slate-700 dark:text-white" placeholder="Email" value={userForm.email} onChange={e => setUserForm({ ...userForm, email: e.target.value })} />
                    <input className="w-full p-2 border rounded dark:bg-slate-800 dark:border-slate-700 dark:text-white" placeholder="Cargo" value={userForm.job} onChange={e => setUserForm({ ...userForm, job: e.target.value })} />

                    {/* Supervisor Select */}
                    <div>
                        <label className="block text-xs font-medium text-slate-500 mb-1">Supervisor (Gestor)</label>
                        <select
                            className="w-full p-2 border rounded dark:bg-slate-800 dark:border-slate-700 dark:text-white"
                            value={userForm.supervisor_id || ''}
                            onChange={e => setUserForm({ ...userForm, supervisor_id: e.target.value })}
                        >
                            <option value="">Selecione um supervisor...</option>
                            {users
                                .filter(u => u.id !== userToEdit?.id) // Prevent selecting self
                                .sort((a, b) => (a.firstname || '').localeCompare(b.firstname || ''))
                                .map(u => (
                                    <option key={u.id} value={u.id}>
                                        {u.firstname} {u.lastname} ({u.login})
                                    </option>
                                ))
                            }
                        </select>
                    </div>

                </div>
                <div className="flex justify-end gap-2 mt-4">
                    <button onClick={onClose} className="px-4 py-2 text-slate-500 hover:text-slate-700">Cancelar</button>
                    <button onClick={handleUserSubmit} disabled={isSubmittingUser} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded shadow-sm">{isSubmittingUser ? 'Salvando...' : 'Salvar'}</button>
                </div>
            </div>
        </div>
    );
};
