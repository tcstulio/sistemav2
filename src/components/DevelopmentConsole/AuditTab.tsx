
import React, { useState, useEffect } from 'react';
import { CheckCircle2, AlertOctagon, AlertTriangle, Info, RefreshCw } from 'lucide-react';
import { useDolibarr } from '../../context/DolibarrContext';
import { useCustomers } from '../../hooks/dolibarr/useCustomers';
import { useInvoices } from '../../hooks/dolibarr/useInvoices';
import { useProjects } from '../../hooks/dolibarr/useProjects';
import { useTasks } from '../../hooks/dolibarr/useTasks';
import { useProducts } from '../../hooks/dolibarr/useProducts';

interface AuditIssue {
    type: 'error' | 'warning' | 'info';
    entity: string;
    id?: string;
    message: string;
    action?: string;
}

interface AuditTabProps {
    // No props needed
}

export const AuditTab: React.FC<AuditTabProps> = () => {
    const { config } = useDolibarr();

    // Data Hooks
    const { data: customers = [] } = useCustomers(config);
    const { data: invoices = [] } = useInvoices(config);
    const { data: projects = [] } = useProjects(config);
    const { data: tasks = [] } = useTasks(config);
    const { data: products = [] } = useProducts(config);

    const [auditIssues, setAuditIssues] = useState<AuditIssue[]>([]);
    const [healthScore, setHealthScore] = useState(100);

    const runAudit = () => {
        const issues: AuditIssue[] = [];
        let score = 100;

        // 1. Check Orphans (Invoices without Customers)
        invoices.forEach(inv => {
            if (!customers.find(c => String(c.id) === String(inv.socid))) {
                issues.push({ type: 'error', entity: 'Fatura', id: inv.ref, message: `Cliente órfão (ID: ${inv.socid})`, action: 'Verifique ID' });
                score -= 2;
            }
        });

        // 2. Check Orphans (Projects without Customers)
        projects.forEach(prj => {
            if (!customers.find(c => String(c.id) === String(prj.socid))) {
                issues.push({ type: 'warning', entity: 'Projeto', id: prj.ref, message: `Cliente órfão (ID: ${prj.socid})`, action: 'Vincular Cliente' });
                score -= 1;
            }
        });

        // 3. Data Quality (Customers without Email)
        const customersNoEmail = customers.filter(c => !c.email);
        if (customersNoEmail.length > 0) {
            issues.push({ type: 'info', entity: 'Clientes', message: `${customersNoEmail.length} clientes sem e-mail cadastrado.`, action: 'Enriquecer Dados' });
            score -= (customersNoEmail.length * 0.1);
        }

        // 4. Stale Data (Open Tasks in Closed Projects)
        tasks.forEach(t => {
            const project = projects.find(p => String(p.id) === String(t.project_id));
            if (project && project.statut === '2' && t.progress < 100) {
                issues.push({ type: 'warning', entity: 'Tarefa', id: t.ref, message: 'Tarefa aberta em projeto fechado.', action: 'Fechar Tarefa' });
                score -= 1;
            }
        });

        // 5. Products without Price
        const productsNoPrice = products.filter(p => !p.price || p.price <= 0);
        if (productsNoPrice.length > 0) {
            issues.push({ type: 'warning', entity: 'Produtos', message: `${productsNoPrice.length} produtos com preço zero.`, action: 'Revisar Catálogo' });
            score -= (productsNoPrice.length * 0.5);
        }

        setAuditIssues(issues);
        setHealthScore(Math.max(0, Math.round(score)));
    };

    useEffect(() => {
        runAudit();
    }, [customers, invoices, projects, tasks, products]);

    const getScoreColor = (score: number) => {
        if (score >= 90) return 'text-emerald-500';
        if (score >= 70) return 'text-yellow-500';
        return 'text-red-500';
    };

    return (
        <div className="p-6 h-full overflow-y-auto bg-slate-50 dark:bg-slate-950/50">
            <div className="max-w-5xl mx-auto space-y-6">
                {/* Score Card */}
                <div className="bg-white dark:bg-slate-900 rounded-xl p-6 border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col md:flex-row items-center gap-8">
                    <div className="relative w-32 h-32 flex items-center justify-center">
                        <svg className="w-full h-full transform -rotate-90">
                            <circle cx="64" cy="64" r="56" stroke="currentColor" strokeWidth="12" fill="transparent" className="text-slate-100 dark:text-slate-800" />
                            <circle cx="64" cy="64" r="56" stroke="currentColor" strokeWidth="12" fill="transparent" strokeDasharray={351} strokeDashoffset={351 - (351 * healthScore) / 100} className={`${getScoreColor(healthScore)} transition-all duration-1000 ease-out`} />
                        </svg>
                        <div className="absolute flex flex-col items-center">
                            <span className={`text-3xl font-bold ${getScoreColor(healthScore)}`}>{healthScore}</span>
                            <span className="text-xs text-slate-400 uppercase font-bold">Score</span>
                        </div>
                    </div>
                    <div className="flex-1">
                        <h3 className="text-xl font-bold text-slate-800 dark:text-white mb-2">Saúde do Sistema</h3>
                        <p className="text-slate-500 dark:text-slate-400 text-sm mb-4">
                            Análise baseada na integridade referencial, qualidade dos dados e consistência dos registros carregados.
                        </p>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
                            <div className="bg-slate-50 dark:bg-slate-800 p-2 rounded-lg border border-slate-100 dark:border-slate-700">
                                <div className="text-lg font-bold text-indigo-600 dark:text-indigo-400">{invoices.length}</div>
                                <div className="text-xs text-slate-500">Faturas</div>
                            </div>
                            <div className="bg-slate-50 dark:bg-slate-800 p-2 rounded-lg border border-slate-100 dark:border-slate-700">
                                <div className="text-lg font-bold text-blue-600 dark:text-blue-400">{customers.length}</div>
                                <div className="text-xs text-slate-500">Clientes</div>
                            </div>
                            <div className="bg-slate-50 dark:bg-slate-800 p-2 rounded-lg border border-slate-100 dark:border-slate-700">
                                <div className="text-lg font-bold text-violet-600 dark:text-violet-400">{projects.length}</div>
                                <div className="text-xs text-slate-500">Projetos</div>
                            </div>
                            <div className="bg-slate-50 dark:bg-slate-800 p-2 rounded-lg border border-slate-100 dark:border-slate-700">
                                <div className="text-lg font-bold text-orange-600 dark:text-orange-400">{products.length}</div>
                                <div className="text-xs text-slate-500">Produtos</div>
                            </div>
                        </div>
                    </div>
                    <button onClick={runAudit} className="p-3 bg-indigo-50 text-indigo-600 dark:bg-indigo-900/20 dark:text-indigo-400 rounded-full hover:bg-indigo-100 dark:hover:bg-indigo-900/40 transition-colors">
                        <RefreshCw size={24} />
                    </button>
                </div>

                {/* Issues List */}
                <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
                    <div className="p-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/50 flex justify-between items-center">
                        <h4 className="font-bold text-slate-800 dark:text-white flex items-center gap-2">
                            <AlertOctagon size={18} className="text-orange-500" /> Problemas Detectados ({auditIssues.length})
                        </h4>
                    </div>
                    {auditIssues.length === 0 ? (
                        <div className="p-12 text-center text-slate-400">
                            <CheckCircle2 size={48} className="mx-auto mb-4 text-emerald-500 opacity-50" />
                            <p>Nenhum problema crítico detectado. Bom trabalho!</p>
                        </div>
                    ) : (
                        <div className="divide-y divide-slate-100 dark:divide-slate-800">
                            {auditIssues.map((issue, idx) => (
                                <div key={idx} className="p-4 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                                    <div className="flex items-start gap-3">
                                        <div className={`mt-1 p-1.5 rounded-full ${issue.type === 'error' ? 'bg-red-100 text-red-600' : issue.type === 'warning' ? 'bg-orange-100 text-orange-600' : 'bg-blue-100 text-blue-600'}`}>
                                            {issue.type === 'error' ? <AlertOctagon size={16} /> : issue.type === 'warning' ? <AlertTriangle size={16} /> : <Info size={16} />}
                                        </div>
                                        <div>
                                            <div className="font-medium text-slate-800 dark:text-white text-sm">
                                                {issue.entity} {issue.id ? `• ${issue.id}` : ''}
                                            </div>
                                            <div className="text-sm text-slate-600 dark:text-slate-400">{issue.message}</div>
                                        </div>
                                    </div>
                                    {issue.action && (
                                        <button className="text-xs font-medium px-3 py-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg text-slate-600 dark:text-slate-300 transition-colors">
                                            {issue.action}
                                        </button>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
