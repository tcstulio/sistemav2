import React, { useState } from 'react';
import { ShieldCheck, Monitor, Bot, History } from 'lucide-react';
import { useDolibarr } from '../../context/DolibarrContext';
import { ScreenAccessMatrix } from './ScreenAccessMatrix';
import { RestrictedAccess } from '../RestrictedAccess';

type Tab = 'screens' | 'agent' | 'audit';

// Central Única de Permissões (#central-permissões). Reúne num só lugar o controle de
// "o que cada grupo/pessoa pode VER e FAZER". Fase 1: aba Telas (VER) com a matriz.
// Fase 2: Agente (permissões do agente por pessoa) e Auditoria.
const PermissionsCenter: React.FC<{ config?: any }> = () => {
    const { config, currentUser } = useDolibarr();
    const isAdmin = currentUser?.admin === 1 || currentUser?.admin === '1' || (currentUser?.admin as unknown) === true;
    const themeColor = config?.themeColor || 'indigo';
    const [tab, setTab] = useState<Tab>('screens');

    if (!isAdmin) return <RestrictedAccess view="central de permissões" />;

    const TabBtn: React.FC<{ id: Tab; icon: React.ReactNode; label: string }> = ({ id, icon, label }) => (
        <button onClick={() => setTab(id)}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${tab === id ? `border-${themeColor}-500 text-${themeColor}-600 dark:text-${themeColor}-400` : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'}`}>
            {icon} {label}
        </button>
    );

    return (
        <div className="p-4 md:p-6 max-w-[1400px] mx-auto">
            <div className="flex items-center gap-2 mb-1">
                <ShieldCheck size={22} className={`text-${themeColor}-600`} />
                <h1 className="text-xl font-bold text-slate-900 dark:text-white">Central de Permissões</h1>
            </div>
            <p className="text-sm text-slate-500 mb-4">Controle, num só lugar, o que cada grupo e pessoa pode ver e fazer no sistema.</p>

            <div className="flex gap-1 border-b dark:border-slate-800 mb-4 overflow-x-auto">
                <TabBtn id="screens" icon={<Monitor size={15} />} label="Telas (Ver)" />
                <TabBtn id="agent" icon={<Bot size={15} />} label="Agente" />
                <TabBtn id="audit" icon={<History size={15} />} label="Auditoria" />
            </div>

            {tab === 'screens' && <ScreenAccessMatrix isAdmin={isAdmin} themeColor={themeColor} />}
            {tab === 'agent' && (
                <div className="text-sm text-slate-500 py-10 text-center">
                    Permissões do <strong>agente</strong> por pessoa — em construção (Fase 2). Selecione uma pessoa para configurar o que o assistente pode criar/editar/excluir em nome dela.
                </div>
            )}
            {tab === 'audit' && (
                <div className="text-sm text-slate-500 py-10 text-center">
                    <strong>Auditoria</strong> de mudanças de permissão — em construção (Fase 2). Mostrará quem alterou o quê, com diff por entidade.
                </div>
            )}
        </div>
    );
};

export default PermissionsCenter;
