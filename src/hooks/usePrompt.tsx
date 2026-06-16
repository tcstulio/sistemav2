import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';

// Substitui o prompt() nativo do navegador por um modal in-app com input de texto,
// mantendo o fluxo de valor:
//   const prompt = usePrompt();
//   const nome = await prompt('Nome do template:');
//   if (!nome) return; // cancelado (null) ou vazio
// O prompt() nativo bloqueia a thread e some em alguns contextos (iframe/modal); este não.

export interface PromptOptions {
    title?: string;
    message: string;
    defaultValue?: string;
    placeholder?: string;
    confirmText?: string;
    cancelText?: string;
}
type PromptFn = (opts: PromptOptions | string) => Promise<string | null>;

// Fallback seguro se o provider não estiver montado: cancela (retorna null).
const PromptContext = createContext<PromptFn>(async () => null);

export const usePrompt = (): PromptFn => useContext(PromptContext);

export const PromptProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [opts, setOpts] = useState<PromptOptions | null>(null);
    const [value, setValue] = useState('');
    const resolver = useRef<((v: string | null) => void) | null>(null);
    const inputRef = useRef<HTMLInputElement | null>(null);

    const prompt = useCallback<PromptFn>((o) => {
        const norm = typeof o === 'string' ? { message: o } : o;
        setValue(norm.defaultValue ?? '');
        setOpts(norm);
        return new Promise<string | null>((resolve) => { resolver.current = resolve; });
    }, []);

    const finish = (v: string | null) => {
        resolver.current?.(v);
        resolver.current = null;
        setOpts(null);
        setValue('');
    };

    // foca o input ao abrir
    useEffect(() => {
        if (opts) {
            const t = setTimeout(() => inputRef.current?.focus(), 0);
            return () => clearTimeout(t);
        }
    }, [opts]);

    return (
        <PromptContext.Provider value={prompt}>
            {children}
            {opts && (
                <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/40 p-4" onClick={() => finish(null)}>
                    <form
                        role="dialog"
                        aria-modal="true"
                        className="w-full max-w-sm bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 p-6"
                        onClick={(e) => e.stopPropagation()}
                        onSubmit={(e) => { e.preventDefault(); finish(value); }}
                    >
                        <div className="mb-4">
                            {opts.title && <h3 className="text-base font-semibold text-slate-800 dark:text-white mb-1">{opts.title}</h3>}
                            <p className="text-sm text-slate-600 dark:text-slate-300 whitespace-pre-wrap">{opts.message}</p>
                        </div>
                        <input
                            ref={inputRef}
                            type="text"
                            value={value}
                            onChange={(e) => setValue(e.target.value)}
                            placeholder={opts.placeholder}
                            onKeyDown={(e) => { if (e.key === 'Escape') finish(null); }}
                            className="w-full px-3 py-2 mb-5 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        />
                        <div className="flex justify-end gap-2">
                            <button
                                type="button"
                                onClick={() => finish(null)}
                                className="px-4 py-2 text-sm rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                            >
                                {opts.cancelText || 'Cancelar'}
                            </button>
                            <button
                                type="submit"
                                className="px-4 py-2 text-sm rounded-lg text-white bg-indigo-600 hover:bg-indigo-700 transition-colors"
                            >
                                {opts.confirmText || 'Confirmar'}
                            </button>
                        </div>
                    </form>
                </div>
            )}
        </PromptContext.Provider>
    );
};
