import React, { useEffect, useRef, useState } from 'react';
import { Bold, Italic, Underline, List, ListOrdered } from 'lucide-react';

interface RichTextEditorProps {
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    className?: string;
}

export const RichTextEditor: React.FC<RichTextEditorProps> = ({ value, onChange, placeholder, className = '' }) => {
    const editorRef = useRef<HTMLDivElement>(null);
    const [isFocused, setIsFocused] = useState(false);

    // Sync external value changes to editor (only if not focused to avoid cursor jumping)
    useEffect(() => {
        if (editorRef.current && !isFocused && editorRef.current.innerHTML !== value) {
            editorRef.current.innerHTML = value || '';
        }
    }, [value, isFocused]);

    const handleInput = () => {
        if (editorRef.current) {
            const html = editorRef.current.innerHTML;
            onChange(html === '<br>' ? '' : html);
        }
    };

    const execCmd = (command: string, value: string | undefined = undefined) => {
        document.execCommand(command, false, value);
        handleInput();
        editorRef.current?.focus();
    };

    const ToolbarButton = ({ icon: Icon, command, title }: { icon: any, command: string, title: string }) => (
        <button
            type="button"
            onClick={(e) => { e.preventDefault(); execCmd(command); }}
            className="p-1.5 text-slate-500 hover:text-indigo-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700 rounded transition-colors"
            title={title}
        >
            <Icon size={14} />
        </button>
    );

    return (
        <div className={`border border-slate-300 dark:border-slate-700 rounded-md overflow-hidden bg-white dark:bg-slate-800 focus-within:ring-1 focus-within:ring-indigo-500 focus-within:border-indigo-500 ${className}`}>
            <div className="flex items-center gap-1 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 p-1">
                <ToolbarButton icon={Bold} command="bold" title="Negrito" />
                <ToolbarButton icon={Italic} command="italic" title="Itálico" />
                <ToolbarButton icon={Underline} command="underline" title="Sublinhado" />
                <div className="w-px h-4 bg-slate-300 dark:bg-slate-600 mx-1"></div>
                <ToolbarButton icon={List} command="insertUnorderedList" title="Lista com Marcadores" />
                <ToolbarButton icon={ListOrdered} command="insertOrderedList" title="Lista Numerada" />
            </div>
            <div
                ref={editorRef}
                className="p-3 text-xs min-h-[80px] outline-none max-h-60 overflow-y-auto dark:text-white"
                contentEditable
                onInput={handleInput}
                onFocus={() => setIsFocused(true)}
                onBlur={() => setIsFocused(false)}
                data-placeholder={placeholder}
                style={{ whiteSpace: 'pre-wrap' }}
            />
            <style>{`
                [contenteditable]:empty:before {
                    content: attr(data-placeholder);
                    color: #94a3b8;
                    cursor: text;
                }
            `}</style>
        </div>
    );
};
