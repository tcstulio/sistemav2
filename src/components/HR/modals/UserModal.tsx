import React, { useState, useEffect } from 'react';
import { DolibarrConfig, DolibarrUser } from '../../../types';
import { DolibarrService } from '../../../services/dolibarrService';
import { Loader2 } from 'lucide-react';

interface UserModalProps {
    isOpen: boolean;
    onClose: () => void;
    config: DolibarrConfig;
    userToEdit?: DolibarrUser | null;
    prefillData?: Partial<DolibarrUser> | null;
    onRefresh?: () => void;
}

export const UserModal: React.FC<UserModalProps> = ({
    isOpen,
    onClose,
    config,
    userToEdit,
    prefillData,
    onRefresh
}) => {
    const [userForm, setUserForm] = useState<Partial<DolibarrUser>>({ login: '', firstname: '', lastname: '', email: '', job: '' });
    const [isSubmittingUser, setIsSubmittingUser] = useState(false);

    useEffect(() => {
        if (isOpen) {
            if (userToEdit) {
                setUserForm({
                    login: userToEdit.login,
                    firstname: userToEdit.firstname || '',
                    lastname: userToEdit.lastname || '',
                    email: userToEdit.email || '',
                    job: userToEdit.job || ''
                });
            } else if (prefillData) {
                setUserForm(prefillData);
            } else {
                setUserForm({ login: '', firstname: '', lastname: '', email: '', job: '' });
            }
        }
    }, [isOpen, userToEdit, prefillData]);

    const handleUserSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!userForm.login || !userForm.email) return;
        setIsSubmittingUser(true);
        try {
            if (userToEdit && userToEdit.id) {
                await DolibarrService.updateUser(config, userToEdit.id, userForm);
                alert("Usuário atualizado com sucesso");
            } else {
                await DolibarrService.createUser(config, userForm);
                alert("Usuário criado com sucesso");
            }
            onClose();
            if (onRefresh) onRefresh();
        } catch (e) { console.error(e); } finally { setIsSubmittingUser(false); }
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
                </div>
                <div className="flex justify-end gap-2 mt-4">
                    <button onClick={onClose} className="px-4 py-2 text-slate-500 hover:text-slate-700">Cancelar</button>
                    <button onClick={handleUserSubmit} disabled={isSubmittingUser} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded shadow-sm">{isSubmittingUser ? 'Salvando...' : 'Salvar'}</button>
                </div>
            </div>
        </div>
    );
};
