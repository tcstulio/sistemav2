import React from 'react';
import { Card } from '../ui';
import { Menu } from 'lucide-react';

// #110 — Editor de menu lateral configurável (ordem + visibilidade).
// STUB da fundação: o agente do #110 substitui o corpo por:
//  - Seção ADMIN (se isAdmin): reordenar/ocultar itens do menu org-wide (updateUiConfig({ menu })).
//  - Seção USUÁRIO (sempre): override pessoal de ordem/visibilidade (localStorage).
// MANTENHA esta assinatura de props (Settings.tsx depende dela).
export interface MenuConfigEditorProps {
    isAdmin: boolean;
    themeColor?: string;
}

export const MenuConfigEditor: React.FC<MenuConfigEditorProps> = ({ isAdmin }) => {
    return (
        <Card header={<h3 className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-slate-200 uppercase tracking-wider"><Menu size={16} /> Menu Lateral</h3>}>
            <p className="text-sm text-slate-500">
                {isAdmin
                    ? 'Configuração do menu (ordem e visibilidade) — em construção.'
                    : 'Personalização do seu menu — em construção.'}
            </p>
        </Card>
    );
};

export default MenuConfigEditor;
