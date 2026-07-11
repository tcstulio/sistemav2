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

const PREFILL_RE = /[?&]prefill=/;

function isInternalPath(href: string): boolean {
    return href.startsWith('/') && !href.startsWith('//');
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

export interface AgentMarkdownProps {
    text: string;
    /** Navegação in-app (React Router). Recebe o caminho relativo (ex.: "/proposals/303"). */
    navigate: (to: string) => void;
}

export const AgentMarkdown: React.FC<AgentMarkdownProps> = ({ text, navigate }) => {
    if (!text) return null;
    const normalized = htmlAnchorsToMarkdown(text);

    return (
        <div className="text-sm leading-relaxed break-words">
            <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                    a: ({ href, children }) => {
                        const to = String(href || '');
                        if (isInternalPath(to) && PREFILL_RE.test(to)) {
                            // Deeplink de criação → botão de ação (mesma semântica do #966).
                            return (
                                <button
                                    type="button"
                                    onClick={() => navigate(to)}
                                    className="inline-flex items-center gap-1 px-2 py-0.5 my-0.5 rounded-md bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 transition-colors"
                                >
                                    {children || 'Revisar e criar'} ↗
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
