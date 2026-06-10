import React, { createContext, useContext, useState, useCallback, useRef } from 'react';
import { AlertTriangle } from 'lucide-react';

// Substitui o confirm() nativo do navegador por um modal in-app, mantendo o fluxo booleano:
//   const confirm = useConfirm();
//   if (await confirm('Excluir?')) { ... }
// O confirm() nativo bloqueia a thread e some em alguns contextos (iframe/modal); este não.

export interface ConfirmOptions {
    title?: string;
    message: string;
    confirmText?: string;
    cancelText?: string;
    danger?: boolean;
}
type ConfirmFn = (opts: ConfirmOptions | string) => Promise<boolean>;

// Fallback seguro se o provider não estiver montado: nega a ação (não executa nada destrutivo).
const ConfirmContext = createContext<ConfirmFn>(async () => false);

export const useConfirm = (): ConfirmFn => useContext(ConfirmContext);

export const ConfirmProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [opts, setOpts] = useState<ConfirmOptions | null>(null);
    const resolver = useRef<((v: boolean) => void) | null>(null);

    const confirm = useCallback<ConfirmFn>((o) => {
        const norm = typeof o === 'string' ? { message: o } : o;
        setOpts(norm);
        return new Promise<boolean>((resolve) => { resolver.current = resolve; });
    }, []);

    const finish = (v: boolean) => {
        resolver.current?.(v);
        resolver.current = null;
        setOpts(null);
    };

    return (
        <ConfirmContext.Provider value={confirm}>
            {children}
            {opts && (
                <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/40 p-4" onClick={() => finish(false)}>
                    <div
                        role="dialog"
                        aria-modal="true"
                        className="w-full max-w-sm bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 p-6"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex items-start gap-3 mb-5">
                            {opts.danger && <AlertTriangle className="text-rose-500 shrink-0 mt-0.5" size={20} />}
                            <div className="min-w-0">
                                {opts.title && <h3 className="text-base font-semibold text-slate-800 dark:text-white mb-1">{opts.title}</h3>}
                                <p className="text-sm text-slate-600 dark:text-slate-300 whitespace-pre-wrap">{opts.message}</p>
                            </div>
                        </div>
                        <div className="flex justify-end gap-2">
                            <button
                                type="button"
                                onClick={() => finish(false)}
                                className="px-4 py-2 text-sm rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                            >
                                {opts.cancelText || 'Cancelar'}
                            </button>
                            <button
                                type="button"
                                onClick={() => finish(true)}
                                className={`px-4 py-2 text-sm rounded-lg text-white transition-colors ${opts.danger ? 'bg-rose-600 hover:bg-rose-700' : 'bg-indigo-600 hover:bg-indigo-700'}`}
                            >
                                {opts.confirmText || 'Confirmar'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </ConfirmContext.Provider>
    );
};
