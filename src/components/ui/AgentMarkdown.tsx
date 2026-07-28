import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * Renderiza a resposta do agente (markdown + tabelas GFM) com links CLICÁVEIS e
 * navegação in-app coerente. Substitui o `renderMessageContent` do VirtualAssistant,
 * que só transformava deeplink/URL em link e deixava TODO o resto (negrito, listas,
 * títulos, tabelas, e ate links markdown `[x](/rel)`) como texto puro.
 *
 * Três tipos de link, preservando o contrato do #966:
 *  - `?prefill=` (deeplink de CRIAÇÃO) → botão "Revisar e criar" que navega in-app;
 *  - caminho relativo interno (`/proposals/303`) → navega in-app via React Router (era o
 *    caso quebrado: o modelo emite `[Proposta 303](/proposals/303)` e nada era clicável);
 *  - `http(s)://…` externa → nova aba.
 *
 * Estilo via classes Tailwind explícitas nos `components` — o projeto NÃO tem o plugin
 * Tailwind Typography (`prose` não faz efeito), então cada elemento leva sua classe.
 */

// Deeplinks de AÇÃO (viram botão, não link cru): criação/edição (?prefill=) e confirmação HITL
// (/confirm-action?token=…). O token HMAC tem ~400 chars — se renderizado como texto do link,
// estoura o layout na horizontal (o modelo às vezes usa a própria URL como texto). Botão resolve.
const ACTION_DEEPLINK_RE = /[?&]prefill=|^\/confirm-action\?token=/;

function isInternalPath(href: string): boolean {
    return href.startsWith('/') && !href.startsWith('//');
}

/** Rótulo curto p/ o botão de ação — evita despejar a URL/token gigante como texto visível. */
function actionLabel(href: string, childText: string): string {
    // Se o modelo deu um texto DECENTE (não a própria URL, não vazio, curto), respeita-o.
    const clean = childText.trim();
    const looksLikeUrl = clean.startsWith('/') || clean.startsWith('http') || clean.length > 40;
    if (clean && !looksLikeUrl) return clean;
    return /confirm-action/.test(href) ? 'Revisar e confirmar' : 'Revisar e criar';
}

/**
 * Algumas respostas trazem HTML CRU vindo direto do resultado de uma tool (ex.:
 * `<a href="/proposals/303" class="...">Abrir proposta 303 →</a>`) — o modelo copia a tag
 * em vez de converter para markdown. O ReactMarkdown ESCAPA html por padrão (correto: evita
 * XSS, foi o motivo do #966 tirar o render de html cru), então essas âncoras apareceriam como
 * texto. Convertemos APENAS a tag `<a href="…">texto</a>` para o markdown `[texto](href)` —
 * que o componente de link abaixo trata com segurança. Nenhum outro html é interpretado.
 */
function htmlAnchorsToMarkdown(text: string): string {
    return text.replace(
        /<a\s+[^>]*?href=["']([^"']+)["'][^>]*>(.*?)<\/a>/gi,
        (_full, href, label) => `[${String(label).replace(/<[^>]+>/g, '').trim() || href}](${href})`,
    );
}

// Deeplink de ação SOLTO no texto (sem markdown): desde #1355 a resposta de um prepare_* é o
// texto da tool verbatim ("… na tela: /tasks/new?prefill=eyJ…"), e o remark-gfm NÃO autolinka
// caminho relativo — o deeplink virava texto morto (regressão do #1354, que trocou o render
// antigo por markdown puro). Só reconstruímos deeplinks de AÇÃO (prefill/confirm-action);
// precedido de espaço/":"/início p/ não tocar em alvos já dentro de markdown `](…)`.
const BARE_ACTION_DEEPLINK_RE = /(^|[\s:])(\/(?:[A-Za-z0-9_\-/.]*\?prefill=|confirm-action\?token=)[A-Za-z0-9_\-.~%]+)/g;

function normalizeBareDeeplinks(text: string): string {
    let out = text;
    // URL absoluta do PRÓPRIO app (ex.: o bot converte links p/ absoluto no WhatsApp e a mesma
    // mensagem aparece aqui) volta a ser caminho relativo — senão cai no branch "externa".
    if (typeof window !== 'undefined' && window.location?.origin) {
        out = out.split(`${window.location.origin}/`).join('/');
    }
    return out.replace(BARE_ACTION_DEEPLINK_RE, (_full, pre, path) => {
        const label = /confirm-action/.test(path) ? 'Revisar e confirmar' : 'Revisar e criar';
        return `${pre}[${label}](${path})`;
    });
}

export interface AgentMarkdownProps {
    text: string;
    /** Navegação in-app (React Router). Recebe o caminho relativo (ex.: "/proposals/303"). */
    navigate: (to: string) => void;
}

export const AgentMarkdown: React.FC<AgentMarkdownProps> = ({ text, navigate }) => {
    if (!text) return null;
    const normalized = normalizeBareDeeplinks(htmlAnchorsToMarkdown(text));

    return (
        <div className="text-sm leading-relaxed break-words">
            <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                    a: ({ href, children }) => {
                        const to = String(href || '');
                        if (isInternalPath(to) && ACTION_DEEPLINK_RE.test(to)) {
                            // Deeplink de ação (criação/edição/confirmação HITL) → botão com rótulo
                            // curto (o token pode ter 400 chars; nunca renderizar como texto cru).
                            const childText = React.Children.toArray(children).filter(c => typeof c === 'string').join('');
                            return (
                                <button
                                    type="button"
                                    onClick={() => navigate(to)}
                                    className="inline-flex items-center gap-1 px-2 py-0.5 my-0.5 rounded-md bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 transition-colors"
                                >
                                    {actionLabel(to, childText)} ↗
                                </button>
                            );
                        }
                        if (isInternalPath(to)) {
                            // Navegação interna (ver entidade existente) → React Router, sem reload.
                            return (
                                <a
                                    href={to}
                                    onClick={(e) => { e.preventDefault(); navigate(to); }}
                                    className="text-indigo-600 dark:text-indigo-400 underline font-medium hover:text-indigo-700 dark:hover:text-indigo-300 cursor-pointer"
                                >
                                    {children}
                                </a>
                            );
                        }
                        // Externa → nova aba.
                        return (
                            <a href={to} target="_blank" rel="noopener noreferrer" className="text-indigo-600 dark:text-indigo-400 underline break-all">
                                {children}
                            </a>
                        );
                    },
                    p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
                    strong: ({ children }) => <strong className="font-semibold text-slate-900 dark:text-white">{children}</strong>,
                    em: ({ children }) => <em className="italic">{children}</em>,
                    ul: ({ children }) => <ul className="list-disc pl-5 mb-2 space-y-0.5">{children}</ul>,
                    ol: ({ children }) => <ol className="list-decimal pl-5 mb-2 space-y-0.5">{children}</ol>,
                    li: ({ children }) => <li className="marker:text-slate-400">{children}</li>,
                    h1: ({ children }) => <h3 className="text-base font-bold mt-2 mb-1 text-slate-900 dark:text-white">{children}</h3>,
                    h2: ({ children }) => <h3 className="text-sm font-bold mt-2 mb-1 text-slate-900 dark:text-white">{children}</h3>,
                    h3: ({ children }) => <h4 className="text-sm font-semibold mt-2 mb-1 text-slate-800 dark:text-slate-100">{children}</h4>,
                    code: ({ children }) => <code className="px-1 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-[0.85em] font-mono">{children}</code>,
                    pre: ({ children }) => <pre className="p-2 my-2 rounded-lg bg-slate-100 dark:bg-slate-800 overflow-x-auto text-xs font-mono">{children}</pre>,
                    blockquote: ({ children }) => <blockquote className="border-l-2 border-slate-300 dark:border-slate-600 pl-3 my-2 text-slate-600 dark:text-slate-400">{children}</blockquote>,
                    table: ({ children }) => <div className="overflow-x-auto my-2"><table className="min-w-full text-xs border-collapse">{children}</table></div>,
                    thead: ({ children }) => <thead className="border-b border-slate-300 dark:border-slate-600">{children}</thead>,
                    th: ({ children }) => <th className="text-left font-semibold px-2 py-1">{children}</th>,
                    td: ({ children }) => <td className="px-2 py-1 border-b border-slate-100 dark:border-slate-800">{children}</td>,
                    hr: () => <hr className="my-2 border-slate-200 dark:border-slate-700" />,
                }}
            >
                {normalized}
            </ReactMarkdown>
        </div>
    );
};

export default AgentMarkdown;
