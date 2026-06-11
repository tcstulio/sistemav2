import React, { createContext, useContext, useState, useCallback, useRef } from 'react';

export interface PromptOptions {
    title?: string;
    message: string;
    placeholder?: string;
    defaultValue?: string;
    confirmText?: string;
    cancelText?: string;
}
type PromptFn = (opts: PromptOptions | string) => Promise<string | null>;

const PromptContext = createContext<PromptFn>(async () => null);

export const usePrompt = (): PromptFn => useContext(PromptContext);

export const PromptProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [opts, setOpts] = useState<PromptOptions | null>(null);
    const [value, setValue] = useState('');
    const resolver = useRef<((v: string | null) => void) | null>(null);

    const prompt = useCallback<PromptFn>((o) => {
        const norm = typeof o === 'string' ? { message: o } : o;
        setOpts(norm);
        setValue(norm.defaultValue || '');
        return new Promise<string | null>((resolve) => { resolver.current = resolve; });
    }, []);

    const finish = (v: string | null) => {
        resolver.current?.(v);
        resolver.current = null;
        setOpts(null);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            finish(value);
        } else if (e.key === 'Escape') {
            finish(null);
        }
    };

    return (
        <PromptContext.Provider value={prompt}>
            {children}
            {opts && (
                <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/40 p-4" onClick={() => finish(null)}>
                    <div
                        role="dialog"
                        aria-modal="true"
                        className="w-full max-w-sm bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 p-6"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {opts.title && <h3 className="text-base font-semibold text-slate-800 dark:text-white mb-1">{opts.title}</h3>}
                        <p className="text-sm text-slate-600 dark:text-slate-300 mb-3">{opts.message}</p>
                        <input
                            type="text"
                            autoFocus
                            className="w-full p-2 border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-slate-800 dark:text-white text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                            placeholder={opts.placeholder || ''}
                            value={value}
                            onChange={(e) => setValue(e.target.value)}
                            onKeyDown={handleKeyDown}
                        />
                        <div className="flex justify-end gap-2 mt-4">
                            <button
                                type="button"
                                onClick={() => finish(null)}
                                className="px-4 py-2 text-sm rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                            >
                                {opts.cancelText || 'Cancelar'}
                            </button>
                            <button
                                type="button"
                                onClick={() => finish(value)}
                                className="px-4 py-2 text-sm rounded-lg text-white bg-indigo-600 hover:bg-indigo-700 transition-colors"
                            >
                                {opts.confirmText || 'OK'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </PromptContext.Provider>
    );
};
