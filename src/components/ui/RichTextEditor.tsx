import React, { useEffect, useRef, useState } from 'react';
import { Bold, Italic, List, Link as LinkIcon } from 'lucide-react';
import { sanitizeHtml } from '../../utils/sanitizeHtml';
import { usePrompt } from '../../hooks/usePrompt';

interface RichTextEditorProps {
    /** Current HTML value (will be sanitized before being rendered into the editor). */
    value: string;
    /** Emits the editor's current HTML on every edit. */
    onChange: (html: string) => void;
    /** Placeholder shown when the editor is empty. */
    placeholder?: string;
    /** Extra classes applied to the outer wrapper. */
    className?: string;
}

/**
 * RichTextEditor - Lightweight WYSIWYG editor (contentEditable based).
 *
 * Minimal toolbar: bold, italic, bulleted list, link.
 * Emits HTML via `onChange`. The incoming `value` is sanitized with
 * `sanitizeHtml` (DOMPurify) before being written into the DOM, so untrusted
 * stored HTML never executes scripts when loaded into the editor.
 *
 * No extra dependency: uses native `document.execCommand` + `contentEditable`.
 *
 * @example
 * ```tsx
 * <RichTextEditor
 *   value={form.description}
 *   onChange={(html) => setForm({ ...form, description: html })}
 *   placeholder="Descreva o produto..."
 * />
 * ```
 */
export const RichTextEditor: React.FC<RichTextEditorProps> = ({
    value,
    onChange,
    placeholder,
    className = '',
}) => {
    const editorRef = useRef<HTMLDivElement>(null);
    const [isFocused, setIsFocused] = useState(false);
    const prompt = usePrompt();

    // Sync external value into the editor. We sanitize before assigning innerHTML
    // so stored/untrusted HTML can't run scripts. Skip while focused to avoid
    // moving the caret while the user types.
    useEffect(() => {
        const el = editorRef.current;
        if (!el || isFocused) return;
        const safe = sanitizeHtml(value || '');
        if (el.innerHTML !== safe) {
            el.innerHTML = safe;
        }
    }, [value, isFocused]);

    const handleInput = () => {
        if (!editorRef.current) return;
        const html = editorRef.current.innerHTML;
        onChange(html === '<br>' ? '' : html);
    };

    const execCmd = (command: string, arg?: string) => {
        document.execCommand(command, false, arg);
        handleInput();
        editorRef.current?.focus();
    };

    const insertLink = async () => {
        const url = await prompt({ message: 'URL do link:', defaultValue: 'https://' });
        if (!url) return;
        execCmd('createLink', url);
    };

    const ToolbarButton = ({
        icon: Icon,
        title,
        onClick,
    }: {
        icon: React.ComponentType<{ size?: number }>;
        title: string;
        onClick: () => void;
    }) => (
        <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={onClick}
            className="p-1.5 text-slate-500 hover:text-indigo-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-indigo-400 dark:hover:bg-slate-700 rounded transition-colors"
            title={title}
            aria-label={title}
        >
            <Icon size={14} />
        </button>
    );

    return (
        <div
            className={`border border-slate-300 dark:border-slate-700 rounded-lg overflow-hidden bg-white dark:bg-slate-800 focus-within:ring-2 focus-within:ring-indigo-500/20 focus-within:border-indigo-500 transition-colors ${className}`.trim()}
        >
            <div className="flex items-center gap-1 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 p-1">
                <ToolbarButton icon={Bold} title="Negrito" onClick={() => execCmd('bold')} />
                <ToolbarButton icon={Italic} title="Itálico" onClick={() => execCmd('italic')} />
                <ToolbarButton icon={List} title="Lista com marcadores" onClick={() => execCmd('insertUnorderedList')} />
                <ToolbarButton icon={LinkIcon} title="Inserir link" onClick={insertLink} />
            </div>
            <div
                ref={editorRef}
                className="p-2 min-h-[80px] max-h-60 outline-none text-sm text-slate-700 dark:text-slate-200 overflow-y-auto"
                style={{ whiteSpace: 'pre-wrap' }}
                contentEditable
                onInput={handleInput}
                onFocus={() => setIsFocused(true)}
                onBlur={() => setIsFocused(false)}
                data-placeholder={placeholder}
                suppressContentEditableWarning
            />
            <style>{`
                [contenteditable]:empty:before {
                    content: attr(data-placeholder);
                    color: #94a3b8;
                    cursor: text;
                    pointer-events: none;
                }
            `}</style>
        </div>
    );
};

export default RichTextEditor;
