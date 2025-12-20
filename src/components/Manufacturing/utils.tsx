import React from 'react';
import { Product, Project } from '../../types';

export const getProductName = (id: string | undefined, products: Product[]) => {
    if (!id) return 'Produto Desconhecido';
    const p = products.find(prod => String(prod.id) === String(id));
    return p ? p.label : `Produto #${id}`;
};

export const getProductPrice = (id: string | undefined, products: Product[]): number => {
    const p = products.find(prod => String(prod.id) === String(id));
    return p ? p.price : 0;
};

export const getProjectName = (id: string | undefined, projects: Project[]) => {
    if (!id) return null;
    const p = projects.find(proj => String(proj.id) === String(id));
    return p ? p.title : null;
};

export const getStatusBadge = (status: string) => {
    switch (status) {
        case '0': return <span className="px-2 py-0.5 rounded text-xs bg-slate-100 text-slate-600" > Rascunho </span>;
        case '1': return <span className="px-2 py-0.5 rounded text-xs bg-blue-100 text-blue-700" > Validado </span>;
        case '2': return <span className="px-2 py-0.5 rounded text-xs bg-orange-100 text-orange-700" > Em Progresso </span>;
        case '3': return <span className="px-2 py-0.5 rounded text-xs bg-emerald-100 text-emerald-700" > Produzido </span>;
        default: return <span className="px-2 py-0.5 rounded text-xs bg-slate-100 text-slate-500" > Desconhecido </span>;
    }
};
