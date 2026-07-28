import React from 'react';
import { useParams, useLocation, Navigate } from 'react-router-dom';
import NotFound from './NotFound';

// #1521 — deeplinks ANTIGOS do agente usavam rotas no SINGULAR (/task/new, /proposal/new…). O backend
// hoje gera no PLURAL (/tasks/new). Um link singular caía no catch-all 404 ("página não encontrada").
// A rota `/:entity/new` só é atingida pelos singulares (o React Router rankeia as rotas estáticas
// plurais ACIMA da dinâmica); este componente reencaminha para o plural PRESERVANDO o `?prefill=`
// (senão o token do rascunho se perderia). Singular desconhecido → NotFound normal.
export const SINGULAR_TO_PLURAL: Record<string, string> = {
    customer: 'customers', contact: 'contacts', supplier: 'suppliers', invoice: 'invoices',
    supplier_invoice: 'supplier_invoices', proposal: 'proposals', supplier_proposal: 'supplier_proposals',
    order: 'orders', project: 'projects', task: 'tasks', ticket: 'tickets', product: 'products',
    category: 'categories', intervention: 'interventions', contract: 'contracts',
};

export const LegacySingularNewRedirect: React.FC = () => {
    const { entity } = useParams();
    const { search } = useLocation();
    const plural = entity ? SINGULAR_TO_PLURAL[entity] : undefined;
    return plural ? <Navigate to={`/${plural}/new${search}`} replace /> : <NotFound />;
};

export default LegacySingularNewRedirect;
