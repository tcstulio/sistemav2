import React, { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { DolibarrConfig } from '../types';
import { Save, CheckCircle, Palette, Moon, Sun, User, ShieldCheck, LogOut, RefreshCw, Smartphone, Key, Mail, Building2 } from 'lucide-react';
import { useDolibarr } from '../context/DolibarrContext';
import { DolibarrService } from '../services/dolibarrService';
import { dbService } from '../services/dbService';
import { getUiConfig, updateUiConfig } from '../services/uiConfigService';
import { setOrgBranding } from '../hooks/useOrgBranding';
import { MenuConfigEditor } from './admin/MenuConfigEditor';
import { DashboardConfigEditor } from './admin/DashboardConfigEditor';
import { PageLayout, PageHeader, Card, Button, Input, Modal } from './ui';
import { logger } from '../utils/logger';

const log = logger.child('Settings');

interface SettingsProps {
    config: DolibarrConfig | null;
    onSave?: (config: DolibarrConfig) => void;
    onNavigate?: (view: string, id?: string) => void;
    onRefresh?: (options?: { forceFull?: boolean; limit?: number; page?: number; query?: string }) => Promise<void>;
    initialItemId?: string;
}

const Settings: React.FC<SettingsProps> = ({ config, onSave }) => {
    const { logout, setConfig } = useDolibarr();
    const [localConfig, setLocalConfig] = useState<DolibarrConfig | null>(config);

    // Handle null config
    if (!config || !localConfig) {
        return (
            <PageLayout>
                <PageHeader title="Configurações" />
                <Card className="p-6 text-center">
                    <p className="text-slate-500">Configuração não disponível</p>
                </Card>
            </PageLayout>
        );
    }
    const [isSaved, setIsSaved] = useState(false);

    // --- Identidade da empresa (org-wide, só admin) ---
    const isAdmin = localConfig.currentUser?.admin === 1 || localConfig.currentUser?.admin === '1' || localConfig.currentUser?.admin === true;
    const [orgForm, setOrgForm] = useState({ companyName: '', logoText: '' });
    const [savingOrg, setSavingOrg] = useState(false);
    useEffect(() => {
        if (!isAdmin) return;
        getUiConfig().then((c) => { if (c) setOrgForm({ companyName: c.companyName, logoText: c.logoText }); });
    }, [isAdmin]);
    const handleSaveOrg = async () => {
        setSavingOrg(true);
        try {
            const updated = await updateUiConfig({ companyName: orgForm.companyName, logoText: orgForm.logoText });
            setOrgBranding(updated); // atualiza o branding (ex.: Sidebar) na hora, p/ todos os consumidores
            toast.success('Identidade da empresa atualizada para todos os usuários.');
        } catch (e: any) {
            toast.error('Falha ao salvar (requer permissão de admin).');
        } finally {
            setSavingOrg(false);
        }
    };

    const colors = [
        { name: 'Índigo', value: 'indigo', hex: '#4f46e5' },
        { name: 'Azul', value: 'blue', hex: '#2563eb' },
        { name: 'Celeste', value: 'sky', hex: '#0284c7' },
        { name: 'Ciano', value: 'cyan', hex: '#0891b2' },
        { name: 'Cerceta', value: 'teal', hex: '#0d9488' },
        { name: 'Esmeralda', value: 'emerald', hex: '#059669' },
        { name: 'Verde', value: 'green', hex: '#16a34a' },
        { name: 'Lima', value: 'lime', hex: '#65a30d' },
        { name: 'Amarelo', value: 'yellow', hex: '#ca8a04' },
        { name: 'Âmbar', value: 'amber', hex: '#d97706' },
        { name: 'Laranja', value: 'orange', hex: '#ea580c' },
        { name: 'Vermelho', value: 'red', hex: '#dc2626' },
        { name: 'Rosa', value: 'rose', hex: '#e11d48' },
        { name: 'Pink', value: 'pink', hex: '#db2777' },
        { name: 'Fúcsia', value: 'fuchsia', hex: '#c026d3' },
        { name: 'Roxo', value: 'purple', hex: '#9333ea' },
        { name: 'Violeta', value: 'violet', hex: '#7c3aed' },
        { name: 'Ardósia', value: 'slate', hex: '#475569' },
        { name: 'Cinza', value: 'gray', hex: '#4b5563' },
        { name: 'Zinco', value: 'zinc', hex: '#52525b' },
        { name: 'Neutro', value: 'neutral', hex: '#525252' },
        { name: 'Pedra', value: 'stone', hex: '#57534e' },
    ];

    // Edit Profile State
    const [isEditModalOpen, setIsEditModalOpen] = useState(false);
    const [isSavingProfile, setIsSavingProfile] = useState(false);
    const [editForm, setEditForm] = useState({
        email: '',
        phone: '',
        password: ''
    });

    const handleOpenEdit = () => {
        setEditForm({
            email: localConfig.currentUser?.email || '',
            phone: (localConfig.currentUser?.phone_mobile || '') as string,
            password: ''
        });
        setIsEditModalOpen(true);
    };

    const handleSaveProfile = async () => {
        setIsSavingProfile(true);
        try {
            if (!localConfig.currentUser) return;

            const updates: any = {};
            if (editForm.email) updates.email = editForm.email;
            if (editForm.phone) updates.phone_mobile = editForm.phone;
            if (editForm.password) updates.password = editForm.password;

            if (Object.keys(updates).length > 0) {
                await DolibarrService.updateUser(localConfig, localConfig.currentUser.id, updates);

                // Deep update local state
                const updatedUser = {
                    ...localConfig.currentUser,
                    ...updates
                };
                if (updates.phone_mobile) updatedUser.phone_mobile = updates.phone_mobile;

                const updatedConfig = { ...localConfig, currentUser: updatedUser };
                setLocalConfig(updatedConfig);
                onSave?.(updatedConfig); // Persist to storage

                setIsEditModalOpen(false);
                alert("Perfil atualizado com sucesso!");
            }
        } catch (e: any) {
            log.error(e);
            alert(`Falha ao atualizar perfil: ${e.message}`);
        } finally {
            setIsSavingProfile(false);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        onSave?.(localConfig);
        setIsSaved(true);
        setTimeout(() => setIsSaved(false), 3000);
    };

    return (
        <PageLayout title="Meu Perfil" maxWidth="md">
            <PageHeader
                title="Meu Perfil"
                subtitle="Gerencie suas preferências de usuário."
            />

            <form onSubmit={handleSubmit} className="space-y-6 mt-6">

                {/* User Profile Card */}
                <div className={`bg-gradient-to-r from-${localConfig.themeColor}-600 to-${localConfig.themeColor}-800 rounded-2xl p-6 text-white shadow-lg relative overflow-hidden transition-colors`}>
                    {/* Background decoration */}
                    <div className="absolute top-0 right-0 p-4 opacity-10 pointer-events-none">
                        <User size={120} />
                    </div>

                    <div className="flex flex-col md:flex-row gap-6 items-center md:items-start relative z-10">
                        {/* Avatar */}
                        <div className="flex-shrink-0 w-20 h-20 rounded-full bg-white/20 backdrop-blur-sm border-2 border-white/30 flex items-center justify-center text-3xl font-bold shadow-xl">
                            {localConfig.currentUser?.firstname?.[0] || localConfig.currentUser?.login?.[0]?.toUpperCase() || 'U'}
                            {localConfig.currentUser?.lastname?.[0]}
                        </div>

                        {/* Info */}
                        <div className="flex-1 w-full text-center md:text-left">
                            <h2 className="text-2xl font-bold mb-1">
                                {localConfig.currentUser ?
                                    `${localConfig.currentUser.firstname || ''} ${localConfig.currentUser.lastname || ''}`.trim() || localConfig.currentUser.login
                                    : 'Administrador'}
                            </h2>
                            <p className="text-white/80 mb-4 flex items-center justify-center md:justify-start gap-2 flex-wrap">
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
                        </div>

                        {/* Actions */}
                        <div className="flex-shrink-0 flex flex-col gap-2 w-full md:w-auto">
                            <Button
                                type="button"
                                variant="secondary"
                                onClick={handleOpenEdit}
                                className="bg-white/10 hover:bg-white/20 border border-white/20 text-white shadow-none backdrop-blur-sm w-full md:w-auto justify-start md:justify-center"
                                icon={<User size={16} />}
                            >
                                Editar Dados
                            </Button>
                            <Button
                                type="button"
                                variant="danger"
                                onClick={() => {
                                    if (confirm("Tem certeza que deseja sair?")) {
                                        logout();
                                    }
                                }}
                                className="bg-red-500/20 hover:bg-red-500/30 border border-red-400/20 text-red-100 shadow-none backdrop-blur-sm w-full md:w-auto justify-start md:justify-center"
                                icon={<LogOut size={16} />}
                            >
                                Sair
                            </Button>
                        </div>
                    </div>
                </div>

                {/* Customization Section */}
                <Card header={<h3 className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-slate-200 uppercase tracking-wider"><Palette size={16} /> Personalização</h3>}>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {/* Color Picker */}
                        <div className="space-y-3 md:col-span-2">
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Cor de Destaque</label>
                            <div className="flex gap-2 flex-wrap">
                                {colors.map((c) => (
                                    <button
                                        key={c.value}
                                        type="button"
                                        onClick={() => setLocalConfig({ ...localConfig, themeColor: c.value })}
                                        className={`w-9 h-9 rounded-full transition-all flex items-center justify-center ring-offset-2 dark:ring-offset-slate-800 ${localConfig.themeColor === c.value ? 'ring-2 ring-slate-400 scale-110 shadow-md' : 'hover:scale-105'}`}
                                        style={{ backgroundColor: c.hex }}
                                        title={c.name}
                                        aria-label={`Selecionar cor ${c.name}`}
                                    >
                                        {localConfig.themeColor === c.value && <CheckCircle size={14} className="text-white" />}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Dark Mode Toggle */}
                        <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-xl border border-slate-100 dark:border-slate-700 flex items-center justify-between">
                            <div className="flex items-center gap-3 text-slate-600 dark:text-slate-400">
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
                                <div className={`w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-${localConfig.themeColor}-600`}></div>
                            </label>
                        </div>
                    </div>
                </Card>

                {/* Identidade da Empresa (org-wide, só admin) */}
                {isAdmin && (
                    <Card header={<h3 className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-slate-200 uppercase tracking-wider"><Building2 size={16} /> Identidade da Empresa (Admin)</h3>}>
                        <p className="text-sm text-slate-500 mb-4">Define o nome e o logo exibidos para <strong>todos</strong> os usuários do sistema.</p>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Nome da empresa</label>
                                <Input value={orgForm.companyName} onChange={(e) => setOrgForm({ ...orgForm, companyName: e.target.value })} placeholder="CoolGroove" />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Logo (texto/inicial, até 8 chars)</label>
                                <Input value={orgForm.logoText} onChange={(e) => setOrgForm({ ...orgForm, logoText: e.target.value.slice(0, 8) })} placeholder="D" />
                            </div>
                        </div>
                        <div className="flex justify-end mt-4">
                            <Button type="button" variant="primary" loading={savingOrg} icon={<Save size={16} />} onClick={handleSaveOrg}>Salvar identidade</Button>
                        </div>
                    </Card>
                )}

                {/* Menu lateral configurável (#110) — admin define padrão; usuário personaliza */}
                <MenuConfigEditor isAdmin={isAdmin} themeColor={localConfig.themeColor} />

                {/* Painel configurável (#111) — admin define padrão; usuário personaliza */}
                <DashboardConfigEditor isAdmin={isAdmin} themeColor={localConfig.themeColor} />

                {/* Maintenance Section */}
                <Card header={<h3 className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-slate-200 uppercase tracking-wider"><ShieldCheck size={16} /> Manutenção</h3>}>
                    <p className="text-sm text-slate-500 mb-4">
                        Ferramentas para diagnosticar e corrigir problemas com o aplicativo local.
                    </p>
                    <Button
                        type="button"
                        variant="secondary"
                        onClick={async () => {
                            if (confirm('Isso irá apagar todas as tarefas locais e baixar novamente. Continuar?')) {
                                const allTasks = await dbService.getAll('tasks');
                                await dbService.saveAll('tasks', []);
                                alert('Tarefas limpas. O sistema irá sincronizar novamente em instantes.');
                                window.location.reload();
                            }
                        }}
                        className="bg-red-50 text-red-600 hover:bg-red-100 dark:bg-red-900/20 dark:text-red-400 dark:hover:bg-red-900/30 border border-transparent"
                        icon={<RefreshCw size={16} />}
                        fullWidth
                    >
                        Forçar Ressincronização de Tarefas
                    </Button>
                </Card>

                {/* Sticky Save Action */}
                <div className="sticky bottom-0 bg-slate-50 dark:bg-slate-950 p-4 border-t border-slate-200 dark:border-slate-800 flex justify-end z-20 backdrop-blur-sm bg-opacity-90 -mx-4 -mb-4 md:rounded-t-xl">
                    <Button
                        type="submit"
                        variant="primary"
                        loading={false}
                        disabled={isSaved}
                        className={`bg-${localConfig.themeColor}-600 hover:bg-${localConfig.themeColor}-700 shadow-lg shadow-${localConfig.themeColor}-200/50 dark:shadow-none`}
                        icon={isSaved ? <CheckCircle size={18} /> : <Save size={18} />}
                    >
                        {isSaved ? 'Preferências Salvas' : 'Salvar Preferências'}
                    </Button>
                </div>
            </form>

            <Modal
                isOpen={isEditModalOpen}
                onClose={() => setIsEditModalOpen(false)}
                title="Editar Perfil"
                footer={
                    <>
                        <Button variant="ghost" onClick={() => setIsEditModalOpen(false)}>
                            Cancelar
                        </Button>
                        <Button
                            onClick={handleSaveProfile}
                            loading={isSavingProfile}
                            icon={<Save size={16} />}
                            className={`bg-${localConfig.themeColor}-600 hover:bg-${localConfig.themeColor}-700`}
                        >
                            Salvar
                        </Button>
                    </>
                }
            >
                <div className="space-y-4">
                    <Input
                        label="Email"
                        type="email"
                        icon={<Mail size={16} />}
                        value={editForm.email}
                        onChange={e => setEditForm({ ...editForm, email: e.target.value })}
                        placeholder="seu@email.com"
                    />
                    <Input
                        label="Celular"
                        type="tel"
                        icon={<Smartphone size={16} />}
                        value={editForm.phone}
                        onChange={e => setEditForm({ ...editForm, phone: e.target.value })}
                        placeholder="+55 11 99999-9999"
                    />
                    <Input
                        label="Nova Senha"
                        type="password"
                        icon={<Key size={16} />}
                        value={editForm.password}
                        onChange={e => setEditForm({ ...editForm, password: e.target.value })}
                        placeholder="Deixe em branco para manter a senha atual"
                        hint="Mínimo de 6 caracteres recomendados"
                    />
                </div>
            </Modal>
        </PageLayout>
    );
};

export default Settings;
