import React from 'react';
import { DolibarrUser, Project } from '../../types';
import { FileEdit, Send, CheckCircle, Banknote, X, Thermometer, Sun, Plane } from 'lucide-react';

export const getUserName = (id: string, users: DolibarrUser[]): string => {
    const user = users.find(u => String(u.id) === String(id));
    return user ? `${user.firstname || ''} ${user.lastname || ''}`.trim() || user.login : 'Usuário Desconhecido';
};

export const getProjectName = (id: string, projects: Project[]): string => {
    const p = projects.find(proj => String(proj.id) === String(id));
    return p ? p.title : 'Sem Projeto';
};

export const formatDuration = (seconds: number): string => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return `${h}h ${m}m`;
};

export const getExpenseStatusBadge = (status: string) => {
    switch (status) {
        case '0': return <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 bg-slate-100 text-slate-600 rounded-full font-bold border border-slate-200" > <FileEdit size={ 10 } /> Rascunho</span >;
        case '1': return <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full font-bold border border-blue-200" > <Send size={ 10 } /> Submetido</span >;
        case '2': return <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 bg-indigo-100 text-indigo-700 rounded-full font-bold border border-indigo-200" > <CheckCircle size={ 10 } /> Aprovado</span >;
        case '4': return <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 bg-indigo-100 text-indigo-700 rounded-full font-bold border border-indigo-200" > <CheckCircle size={ 10 } /> Aprovado</span >;
        case '5': return <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded-full font-bold border border-emerald-200" > <Banknote size={ 10 } /> Pago</span >;
        case '6': return <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded-full font-bold border border-emerald-200" > <Banknote size={ 10 } /> Pago</span >;
        case '9': return <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 bg-red-100 text-red-700 rounded-full font-bold border border-red-200" > <X size={ 10 } /> Recusado</span >;
        default: return <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 bg-red-100 text-red-700 rounded-full font-bold border border-red-200" > <X size={ 10 } /> Recusado</span >;
    }
};

export const getLeaveStatusBadge = (status: string) => {
    switch (status) {
        case '1': return <span className="px-2 py-0.5 rounded text-xs bg-slate-100 text-slate-600 border border-slate-200" > Rascunho </span>;
        case '2': return <span className="px-2 py-0.5 rounded text-xs bg-orange-100 text-orange-700 border border-orange-200" > Aguardando </span>;
        case '3': return <span className="px-2 py-0.5 rounded text-xs bg-emerald-100 text-emerald-700 border border-emerald-200" > Aprovado </span>;
        case '4': return <span className="px-2 py-0.5 rounded text-xs bg-red-50 text-red-600 border border-red-100" > Cancelado </span>;
        case '5': return <span className="px-2 py-0.5 rounded text-xs bg-red-100 text-red-700 border border-red-200" > Recusado </span>;
        default: return <span className="px-2 py-0.5 rounded text-xs bg-slate-100 text-slate-500" > Desconhecido </span>;
    }
};

export const getLeaveIcon = (type: string) => {
    const t = (type || '').toLowerCase();
    if (t.includes('sick')) return <Thermometer size={ 16 } className = "text-red-500" />;
    if (t.includes('vacation') || t.includes('holiday')) return <Sun size={ 16 } className = "text-orange-500" />;
    return <Plane size={ 16 } className = "text-blue-500" />;
};
