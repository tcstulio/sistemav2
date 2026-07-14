// REGRA #1400: ZERO botões de envio externo. Adicionar botão de envio exige gate explícito em epic dedicado.
// Esta tela é uma "fila in-app": o humano lê, copia/edita o rascunho e dispara
// manualmente por qualquer canal que quiser (WhatsApp/email/telefone/...).
// Nenhum onClick desta página pode enviar nada (whatsapp/email/send/etc.).
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ClipboardCopy, Pencil, RefreshCw, ChevronDown, ChevronRight, FileText } from 'lucide-react';
import { toast } from 'sonner';
import { PageLayout, PageHeader, Card, EmptyState, Button, Spinner } from '../components/ui';
import { formatCurrency } from '../utils/formatUtils';
import { formatDateLocal } from '../utils/dateUtils';
import { getDunningDigest, DunningItem, DunningResponse } from '../services/dunningService';

const EMPTY_DIGEST = { totalItems: 0, totalReady: 0, totalIncomplete: 0 };

function parseTimestamp(value: string | number | undefined | null): string {
    if (value === undefined || value === null || value === '') return '—';
    if (typeof value === 'string') {
        const parsed = Date.parse(value);
        if (!Number.isNaN(parsed)) return formatDateLocal(parsed);
        return value;
    }
    return formatDateLocal(value);
}

export const Dunning: React.FC = () => {
    const [data, setData] = useState<DunningResponse>({ digest: EMPTY_DIGEST, items: [] });
    const [loading, setLoading] = useState<boolean>(true);
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [draftText, setDraftText] = useState<Record<string, string>>({});

    const loadDigest = useCallback(async () => {
        setLoading(true);
        try {
            const resp = await getDunningDigest();
            setData(resp);
        } catch {
            setData({ digest: EMPTY_DIGEST, items: [] });
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadDigest();
    }, [loadDigest]);

    const items = data.items ?? [];
    const digest = data.digest ?? EMPTY_DIGEST;

    const sortedItems = useMemo(() => items, [items]);

    const handleToggleExpand = (id: string) => {
        setExpandedId((prev) => (prev === id ? null : id));
    };

    const handleCopy = async (id: string, rascunho: string) => {
        const text = draftText[id] ?? rascunho ?? '';
        try {
            await navigator.clipboard.writeText(text);
            toast.success('Rascunho copiado para a área de transferência.');
        } catch {
            toast.error('Não foi possível copiar para o clipboard.');
        }
    };

    const handleStartEdit = (id: string, rascunho: string) => {
        setEditingId(id);
        setDraftText((prev) => ({ ...prev, [id]: rascunho ?? '' }));
    };

    const handleCancelEdit = () => {
        setEditingId(null);
    };

    const handleChangeDraft = (id: string, value: string) => {
        setDraftText((prev) => ({ ...prev, [id]: value }));
    };

    const handleSaveDraftLocal = (id: string) => {
        // Edição LOCAL — não dispara request HTTP. O usuário pode revisar o
        // texto e copiar. Nada é persistido no backend neste momento.
        setEditingId(null);
        toast.success('Edição local aplicada (não persistida no backend).');
    };

    return (
        <PageLayout title="Cobranças (digest)" maxWidth="lg">
            <PageHeader
                title="Cobranças (digest)"
                subtitle="Fila priorizada de clientes com recebíveis em aberto. Copie/edite o rascunho e envie manualmente pelo canal desejado."
                actions={
                    <Button
                        variant="outline"
                        icon={<RefreshCw size={16} />}
                        onClick={loadDigest}
                        disabled={loading}
                    >
                        Atualizar
                    </Button>
                }
            />

            <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
                <DigestTile label="Itens na fila" value={digest.totalItems} accent="slate" />
                <DigestTile label="Prontos p/ copiar" value={digest.totalReady} accent="emerald" />
                <DigestTile label="Dado indisponível" value={digest.totalIncomplete} accent="amber" />
            </div>

            <div className="mt-6">
                {loading ? (
                    <div className="flex items-center justify-center py-16 text-slate-500">
                        <Spinner size="lg" />
                        <span className="ml-3 text-sm">Carregando digest…</span>
                    </div>
                ) : sortedItems.length === 0 ? (
                    <Card padding="lg">
                        <EmptyState
                            icon={FileText}
                            title="Nenhum recebível em aberto 🎉"
                            description="Não há clientes com faturas em atraso no momento. Atualize mais tarde se necessário."
                        />
                    </Card>
                ) : (
                    <ul className="space-y-3">
                        {sortedItems.map((item) => (
                            <DunningCard
                                key={item.id}
                                item={item}
                                expanded={expandedId === item.id}
                                editing={editingId === item.id}
                                draftValue={draftText[item.id] ?? item.rascunho}
                                onToggle={() => handleToggleExpand(item.id)}
                                onCopy={() => handleCopy(item.id, item.rascunho)}
                                onStartEdit={() => handleStartEdit(item.id, item.rascunho)}
                                onCancelEdit={handleCancelEdit}
                                onSave={() => handleSaveDraftLocal(item.id)}
                                onChangeDraft={(value) => handleChangeDraft(item.id, value)}
                            />
                        ))}
                    </ul>
                )}
            </div>

            <p className="mt-6 text-xs text-slate-500 dark:text-slate-400">
                Esta tela não envia mensagens. Por design (regra #1400), apenas leitura + clipboard.
            </p>
        </PageLayout>
    );
};

export default Dunning;

interface DigestTileProps {
    label: string;
    value: number;
    accent: 'slate' | 'emerald' | 'amber';
}

const DigestTile: React.FC<DigestTileProps> = ({ label, value, accent }) => {
    const accentClasses = {
        slate: 'border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-200',
        emerald: 'border-emerald-200 dark:border-emerald-900 text-emerald-700 dark:text-emerald-300',
        amber: 'border-amber-200 dark:border-amber-900 text-amber-700 dark:text-amber-300',
    } as const;
    return (
        <div className={`rounded-xl border bg-white dark:bg-slate-900 px-4 py-3 shadow-sm ${accentClasses[accent]}`}>
            <div className="text-xs uppercase tracking-wide opacity-70">{label}</div>
            <div className="mt-1 text-2xl font-bold">{value}</div>
        </div>
    );
};

interface DunningCardProps {
    item: DunningItem;
    expanded: boolean;
    editing: boolean;
    draftValue: string;
    onToggle: () => void;
    onCopy: () => void;
    onStartEdit: () => void;
    onCancelEdit: () => void;
    onSave: () => void;
    onChangeDraft: (value: string) => void;
}

const DunningCard: React.FC<DunningCardProps> = ({
    item,
    expanded,
    editing,
    draftValue,
    onToggle,
    onCopy,
    onStartEdit,
    onCancelEdit,
    onSave,
    onChangeDraft,
}) => {
    const isIncomplete = item.status === 'incomplete';

    return (
        <li className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm">
            <button
                type="button"
                onClick={onToggle}
                className="w-full text-left px-4 py-3 flex items-start gap-3"
                aria-expanded={expanded}
            >
                <div className="mt-0.5 text-slate-400">
                    {expanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                </div>
                <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-slate-800 dark:text-slate-100 truncate">
                            {item.socname || `Cliente #${item.id}`}
                        </span>
                        {isIncomplete && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                                <AlertTriangle size={12} /> Dado indisponível
                            </span>
                        )}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-600 dark:text-slate-400">
                        <span>
                            Em aberto: <strong className="text-slate-800 dark:text-slate-200">{formatCurrency(item.totalAberto)}</strong>
                        </span>
                        <span>
                            Maior atraso: <strong className="text-slate-800 dark:text-slate-200">{item.diasAtrasoMax} dia(s)</strong>
                        </span>
                        <span>{item.faturas?.length ?? 0} fatura(s)</span>
                    </div>
                </div>
            </button>

            {expanded && (
                <div className="px-4 pb-4 pt-1 border-t border-slate-100 dark:border-slate-800 space-y-3">
                    <div>
                        <div className="text-xs uppercase tracking-wide text-slate-500 mb-1">Faturas</div>
                        {item.faturas && item.faturas.length > 0 ? (
                            <ul className="text-sm text-slate-700 dark:text-slate-300 space-y-1">
                                {item.faturas.map((f, idx) => (
                                    <li key={`${item.id}-${idx}`} className="flex justify-between gap-2 border-b border-dashed border-slate-100 dark:border-slate-800 pb-1">
                                        <span className="truncate">{f.ref || '—'}</span>
                                        <span className="text-slate-500 whitespace-nowrap">
                                            venc. {parseTimestamp(f.vencimento)}
                                            {typeof f.valor === 'number' ? ` · ${formatCurrency(f.valor)}` : ''}
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        ) : (
                            <div className="text-sm text-slate-500">Sem faturas vinculadas.</div>
                        )}
                    </div>

                    <div>
                        <div className="flex items-center justify-between mb-1">
                            <span className="text-xs uppercase tracking-wide text-slate-500">Rascunho</span>
                        </div>
                        <textarea
                            className="w-full min-h-[120px] rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 px-3 py-2 text-sm text-slate-800 dark:text-slate-100 disabled:opacity-60 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-indigo-500"
                            value={isIncomplete ? '' : draftValue}
                            onChange={(e) => onChangeDraft(e.target.value)}
                            disabled={isIncomplete || !editing}
                            readOnly={!editing || isIncomplete}
                            placeholder={isIncomplete ? '—' : 'Sem rascunho disponível.'}
                            aria-label={`Rascunho de mensagem para ${item.socname}`}
                        />
                        {isIncomplete && (
                            <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                                Rascunho bloqueado: dados insuficientes para este cliente.
                            </p>
                        )}

                        <div className="mt-3 flex flex-wrap gap-2">
                            <Button
                                variant="primary"
                                size="sm"
                                icon={<ClipboardCopy size={14} />}
                                onClick={onCopy}
                                disabled={isIncomplete}
                            >
                                Copiar
                            </Button>
                            {!editing ? (
                                <Button
                                    variant="outline"
                                    size="sm"
                                    icon={<Pencil size={14} />}
                                    onClick={onStartEdit}
                                    disabled={isIncomplete}
                                >
                                    Editar
                                </Button>
                            ) : (
                                <>
                                    <Button
                                        variant="primary"
                                        size="sm"
                                        onClick={onSave}
                                    >
                                        Salvar (local)
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={onCancelEdit}
                                    >
                                        Cancelar
                                    </Button>
                                </>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </li>
    );
};
