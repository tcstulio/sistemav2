import React from 'react';
import { Card } from '../ui';
import { LayoutDashboard } from 'lucide-react';

// #111 — Editor de widgets do painel (ordem + visibilidade).
// STUB da fundação: o agente do #111 substitui o corpo por:
//  - Seção ADMIN (se isAdmin): reordenar/ocultar widgets org-wide (updateUiConfig({ dashboard })).
//  - Seção USUÁRIO (sempre): override pessoal de ordem/visibilidade (localStorage).
// MANTENHA esta assinatura de props (Settings.tsx depende dela).
export interface DashboardConfigEditorProps {
    isAdmin: boolean;
    themeColor?: string;
}

export const DashboardConfigEditor: React.FC<DashboardConfigEditorProps> = ({ isAdmin }) => {
    return (
        <Card header={<h3 className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-slate-200 uppercase tracking-wider"><LayoutDashboard size={16} /> Painel Principal</h3>}>
            <p className="text-sm text-slate-500">
                {isAdmin
                    ? 'Configuração dos widgets do painel (ordem e visibilidade) — em construção.'
                    : 'Personalização do seu painel — em construção.'}
            </p>
        </Card>
    );
};

export default DashboardConfigEditor;
