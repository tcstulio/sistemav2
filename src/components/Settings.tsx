import React, { useState } from 'react';
import { DolibarrConfig } from '../types';
import { Save, CheckCircle, Palette, Moon, Sun, User, ShieldCheck, LogOut, RefreshCw } from 'lucide-react';
import { useDolibarr } from '../context/DolibarrContext';
import { DolibarrService } from '../services/dolibarrService';

interface SettingsProps {
    config: DolibarrConfig;
    onSave: (config: DolibarrConfig) => void;
}

const Settings: React.FC<SettingsProps> = ({ config, onSave }) => {
    const { logout } = useDolibarr();
    const [localConfig, setLocalConfig] = useState<DolibarrConfig>(config);
    const [isSaved, setIsSaved] = useState(false);

    const colors = [
        { name: 'Índigo', value: 'indigo', class: 'bg-indigo-600' },
        { name: 'Azul', value: 'blue', class: 'bg-blue-600' },
        { name: 'Esmeralda', value: 'emerald', class: 'bg-emerald-600' },
        { name: 'Rosa', value: 'rose', class: 'bg-rose-600' },
        { name: 'Ardósia', value: 'slate', class: 'bg-slate-600' },
    ];

    // Edit Profile State
    const [isEditingProfile, setIsEditingProfile] = useState(false);
    const [isSavingProfile, setIsSavingProfile] = useState(false);
    const [editForm, setEditForm] = useState({
        email: '',
        phone: '',
        password: ''
    });

    const handleSaveProfile = async () => {
        setIsSavingProfile(true);
        try {
            if (!localConfig.currentUser) return;

            const updates: any = {};
            if (editForm.email) updates.email = editForm.email;
            if (editForm.phone) updates.phone_mobile = editForm.phone; // Map to correct field
            if (editForm.password) updates.password = editForm.password;

            if (Object.keys(updates).length > 0) {
                await DolibarrService.updateUser(localConfig, localConfig.currentUser.id, updates);

                // Deep update local state
                const updatedUser = {
                    ...localConfig.currentUser,
                    ...updates
                };
                // Ensure we update correctly
                if (updates.phone_mobile) updatedUser.phone_mobile = updates.phone_mobile;

                const updatedConfig = { ...localConfig, currentUser: updatedUser };
                setLocalConfig(updatedConfig);
                onSave(updatedConfig); // Persist to storage

                alert("Perfil atualizado com sucesso!");
                setIsEditingProfile(false);
            }
        } catch (e: any) {
            console.error(e);
            alert(`Falha ao atualizar perfil: ${e.message}`);
        } finally {
            setIsSavingProfile(false);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        onSave(localConfig);
        setIsSaved(true);
        setTimeout(() => setIsSaved(false), 3000);
    };

    return (
        <div className="h-full overflow-y-auto bg-slate-50/50 dark:bg-slate-950">
            <div className="max-w-3xl mx-auto p-4 md:p-6 pb-32">
                <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800 overflow-hidden transition-colors">

                    {/* Header */}
                    <div className="p-6 border-b border-slate-100 dark:border-slate-800 flex items-center gap-3 bg-slate-50/50 dark:bg-slate-900/50 sticky top-0 z-10 backdrop-blur-sm">
                        <div className={`bg-${localConfig.themeColor}-100 dark:bg-${localConfig.themeColor}-900/30 p-2 rounded-lg`}>
                            <User className={`text-${localConfig.themeColor}-600 dark:text-${localConfig.themeColor}-400`} size={24} />
                        </div>
                        <div>
                            <h2 className="text-xl font-bold text-slate-800 dark:text-white">Meu Perfil</h2>
                            <p className="text-sm text-slate-500 dark:text-slate-400">Gerencie suas preferências de usuário.</p>
                        </div>
                    </div>


                    <form onSubmit={handleSubmit} className="p-6 space-y-8">

                        {/* User Profile Card */}
                        <section>
                            <div className={`bg-gradient-to-r from-${localConfig.themeColor}-600 to-${localConfig.themeColor}-800 rounded-2xl p-6 text-white shadow-lg relative overflow-hidden`}>
                                {/* Background decoration */}
                                <div className="absolute top-0 right-0 p-4 opacity-10">
                                    <User size={120} />
                                </div>

                                <div className="flex flex-col md:flex-row gap-6 items-center md:items-start relative z-10">
                                    {/* Avatar */}
                                    <div className="w-20 h-20 rounded-full bg-white/20 backdrop-blur-sm border-2 border-white/30 flex items-center justify-center text-3xl font-bold shadow-xl">
                                        {localConfig.currentUser?.firstname?.[0] || localConfig.currentUser?.login?.[0]?.toUpperCase() || 'U'}
                                        {localConfig.currentUser?.lastname?.[0]}
                                    </div>

                                    {/* Info / Edit Form */}
                                    <div className="flex-1 w-full">
                                        {isEditingProfile ? (
                                            <div className="bg-white/10 backdrop-blur-md p-4 rounded-xl border border-white/20 animate-in fade-in zoom-in-95">
                                                <h3 className="font-bold text-lg mb-3 flex items-center gap-2"><User size={18} /> Editar Perfil</h3>
                                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
                                                    <div>
                                                        <label className="text-xs text-white/70 block mb-1">Email</label>
                                                        <input
                                                            type="email"
                                                            value={editForm.email}
                                                            onChange={e => setEditForm({ ...editForm, email: e.target.value })}
                                                            className="w-full bg-black/20 border border-white/10 rounded px-2 py-1.5 text-sm text-white placeholder-white/40 focus:outline-none focus:border-white/40"
                                                        />
                                                    </div>
                                                    <div>
                                                        <label className="text-xs text-white/70 block mb-1">Celular</label>
                                                        <input
                                                            type="text"
                                                            value={editForm.phone}
                                                            onChange={e => setEditForm({ ...editForm, phone: e.target.value })}
                                                            className="w-full bg-black/20 border border-white/10 rounded px-2 py-1.5 text-sm text-white placeholder-white/40 focus:outline-none focus:border-white/40"
                                                        />
                                                    </div>
                                                    <div>
                                                        <label className="text-xs text-white/70 block mb-1">Nova Senha (Opcional)</label>
                                                        <input
                                                            type="password"
                                                            value={editForm.password}
                                                            onChange={e => setEditForm({ ...editForm, password: e.target.value })}
                                                            placeholder="Deixe em branco para manter"
                                                            className="w-full bg-black/20 border border-white/10 rounded px-2 py-1.5 text-sm text-white placeholder-white/40 focus:outline-none focus:border-white/40"
                                                        />
                                                    </div>
                                                </div>
                                                <div className="flex justify-end gap-2 mt-2">
                                                    <button
                                                        type="button"
                                                        onClick={() => setIsEditingProfile(false)}
                                                        className="px-3 py-1.5 text-xs font-medium text-white/70 hover:bg-white/10 rounded-lg transition-colors"
                                                    >
                                                        Cancelar
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={handleSaveProfile}
                                                        className="px-3 py-1.5 text-xs font-medium bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg transition-colors flex items-center gap-1"
                                                    >
                                                        {isSavingProfile ? <RefreshCw className="animate-spin" size={12} /> : <Save size={12} />}
                                                        Salvar
                                                    </button>
                                                </div>
                                            </div>
                                        ) : (
                                            <>
                                                <h2 className="text-center md:text-left text-2xl font-bold mb-1">
                                                    {localConfig.currentUser ?
                                                        `${localConfig.currentUser.firstname || ''} ${localConfig.currentUser.lastname || ''}`.trim() || localConfig.currentUser.login
                                                        : 'Administrador'}
                                                </h2>
                                                <p className="text-center md:text-left text-white/80 mb-4 flex items-center justify-center md:justify-start gap-2">
                                                    <span className="bg-black/20 px-2 py-0.5 rounded text-xs font-mono">
                                                        {localConfig.currentUser?.login || 'admin'}
                                                    </span>
                                                    {localConfig.currentUser?.email && <span>• {localConfig.currentUser.email}</span>}
                                                </p>

                                                <div className="flex gap-2 justify-center md:justify-start">
                                                    {(localConfig.currentUser?.admin === 1 || localConfig.currentUser?.admin === '1' || localConfig.currentUser?.admin === true) && (
                                                        <span className="px-3 py-1 bg-white/20 rounded-full text-xs font-medium flex items-center gap-1">
                                                            <ShieldCheck size={12} /> Admin
                                                        </span>
                                                    )}
                                                    <span className="px-3 py-1 bg-emerald-500/30 rounded-full text-xs font-medium flex items-center gap-1 border border-emerald-400/30">
                                                        <div className="w-1.5 h-1.5 rounded-full bg-emerald-400"></div> Ativo
                                                    </span>
                                                </div>
                                            </>
                                        )}
                                    </div>

                                    {/* Actions */}
                                    <div className="flex-shrink-0 flex flex-col gap-2">
                                        {!isEditingProfile && (
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setEditForm({
                                                        email: localConfig.currentUser?.email || '',
                                                        phone: (localConfig.currentUser?.phone_mobile || '') as string, // Correct mapping
                                                        password: ''
                                                    });
                                                    setIsEditingProfile(true);
                                                }}
                                                className="w-full px-4 py-2 bg-white/10 hover:bg-white/20 border border-white/20 rounded-xl transition-all flex items-center gap-2 text-sm font-medium backdrop-blur-sm"
                                            >
                                                <User size={16} /> Editar Dados
                                            </button>
                                        )}
                                        <button
                                            type="button"
                                            onClick={() => {
                                                if (confirm("Tem certeza que deseja sair?")) {
                                                    logout();
                                                }
                                            }}
                                            className="w-full px-4 py-2 bg-red-500/20 hover:bg-red-500/30 border border-red-400/20 text-red-100 rounded-xl transition-all flex items-center gap-2 text-sm font-medium backdrop-blur-sm"
                                        >
                                            <LogOut size={16} /> Sair
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </section>



                        {/* Customization Section */}
                        <section>
                            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-200 uppercase tracking-wider mb-4 flex items-center gap-2">
                                <Palette size={16} /> Personalização
                            </h3>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {/* Color Picker */}
                                <div className="bg-slate-50 dark:bg-slate-800/50 p-5 rounded-xl border border-slate-100 dark:border-slate-700">
                                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-3">Cor de Destaque</label>
                                    <div className="flex gap-4 flex-wrap">
                                        {colors.map((c) => (
                                            <button
                                                key={c.value}
                                                type="button"
                                                onClick={() => setLocalConfig({ ...localConfig, themeColor: c.value })}
                                                className={`w-10 h-10 rounded-full ${c.class} transition-all hover:scale-110 flex items-center justify-center ring-offset-2 dark:ring-offset-slate-800 ${localConfig.themeColor === c.value ? 'ring-2 ring-slate-400 scale-110 shadow-md' : ''}`}
                                                title={c.name}
                                            >
                                                {localConfig.themeColor === c.value && <CheckCircle size={16} className="text-white" />}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {/* Dark Mode Toggle */}
                                <div className="bg-slate-50 dark:bg-slate-800/50 p-5 rounded-xl border border-slate-100 dark:border-slate-700 flex flex-col justify-center gap-4">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2 text-slate-600 dark:text-slate-400">
                                            {localConfig.darkMode ? <Moon size={20} className="text-indigo-400" /> : <Sun size={20} className="text-amber-500" />}
                                            <span className="text-sm font-medium">Modo Escuro</span>
                                        </div>
                                        <label className="relative inline-flex items-center cursor-pointer">
                                            <input
                                                type="checkbox"
                                                checked={localConfig.darkMode}
                                                onChange={(e) => setLocalConfig({ ...localConfig, darkMode: e.target.checked })}
                                                className="sr-only peer"
                                            />
                                            <div className={`w-12 h-6 bg-slate-200 dark:bg-slate-600 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-${localConfig.themeColor}-600`}></div>
                                        </label>
                                    </div>
                                </div>
                            </div>
                        </section>

                        {/* Debug / Maintenance */}
                        <section>
                            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-200 uppercase tracking-wider mb-4 flex items-center gap-2">
                                <ShieldCheck size={16} /> Manutenção
                            </h3>
                            <button
                                type="button"
                                onClick={async () => {
                                    if (confirm('Isso irá apagar todas as tarefas locais e baixar novamente. Continuar?')) {
                                        await dbService.table('tasks').clear();
                                        alert('Tarefas limpas. O sistema irá sincronizar novamente em instantes.');
                                        window.location.reload();
                                    }
                                }}
                                className="px-4 py-2 bg-red-100 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-lg hover:bg-red-200 transition-colors text-sm font-medium"
                            >
                                Forçar Ressincronização de Tarefas
                            </button>
                        </section>

                        <div className="sticky bottom-0 bg-white dark:bg-slate-900 p-4 -mx-6 -mb-6 border-t border-slate-100 dark:border-slate-800 flex justify-end">
                            <button
                                type="submit"
                                className={`flex items-center gap-2 px-6 py-2.5 bg-${localConfig.themeColor}-600 hover:bg-${localConfig.themeColor}-700 text-white rounded-xl font-bold shadow-lg shadow-${localConfig.themeColor}-200 dark:shadow-none transition-all active:scale-95`}
                            >
                                {isSaved ? <CheckCircle size={18} /> : <Save size={18} />}
                                {isSaved ? 'Preferências Salvas' : 'Salvar Preferências'}
                            </button>
                        </div>

                    </form>
                </div>
            </div>
        </div >
    );
};

export default Settings;
