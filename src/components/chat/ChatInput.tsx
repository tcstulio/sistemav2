import React, { useRef, useState } from 'react';
import { Loader2, Paperclip, Send } from 'lucide-react';
import { CHAT_ATTACHMENT_ACCEPT } from '../../lib/constants';
import { RichTextEditor } from '../common/RichTextEditor';
import { AttachmentPreview } from './AttachmentPreview';

export interface ChatAttachment {
    id: string;
    file: File;
    fileLink?: string;
}

interface ChatInputProps {
    value: string;
    onChange: (value: string) => void;
    onKeyDown: (event: React.KeyboardEvent) => void;
    onSend: () => void;
    onFilesSelected: (files: File[]) => void;
    onRemoveAttachment: (id: string) => void;
    attachments: ChatAttachment[];
    attachmentError: string | null;
    isSending: boolean;
    isUploading: boolean;
}

export const ChatInput: React.FC<ChatInputProps> = ({
    value,
    onChange,
    onKeyDown,
    onSend,
    onFilesSelected,
    onRemoveAttachment,
    attachments,
    attachmentError,
    isSending,
    isUploading,
}) => {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [isDragging, setIsDragging] = useState(false);

    const selectFiles = (files: FileList | null) => {
        if (!files?.length) return;
        onFilesSelected(Array.from(files));
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        setIsDragging(false);
        selectFiles(event.dataTransfer.files);
    };

    return (
        <div
            onDragEnter={(event) => {
                event.preventDefault();
                setIsDragging(true);
            }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node)) setIsDragging(false);
            }}
            onDrop={handleDrop}
            className={`rounded-lg border border-dashed p-2 transition-colors ${isDragging ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20' : 'border-transparent'}`}
            data-testid="chat-dropzone"
        >
            {attachments.length > 0 && (
                <div className="mb-2 grid gap-2 sm:grid-cols-2" data-testid="attachment-list">
                    {attachments.map((attachment) => (
                        <AttachmentPreview
                            key={attachment.id}
                            file={attachment.file}
                            onRemove={() => onRemoveAttachment(attachment.id)}
                            disabled={isSending || isUploading}
                        />
                    ))}
                </div>
            )}

            {attachmentError && (
                <div role="alert" data-testid="attachment-error" className="mb-2 rounded border-l-4 border-red-500 bg-red-50 p-2 text-xs text-red-700 dark:bg-red-900/30 dark:text-red-300">
                    {attachmentError}
                </div>
            )}

            <RichTextEditor
                value={value}
                onChange={onChange}
                placeholder="Digite sua mensagem..."
                className="flex-1"
                minHeight="60px"
                maxHeight="200px"
                onKeyDown={onKeyDown}
            />

            <input
                type="file"
                ref={fileInputRef}
                className="hidden"
                accept={CHAT_ATTACHMENT_ACCEPT}
                multiple
                aria-label="Selecionar anexos"
                onChange={(event) => selectFiles(event.target.files)}
            />

            <div className="mt-2 flex items-center justify-between gap-2">
                <span className="text-xs text-gray-400">Arraste imagens, PDFs ou vídeos MP4/WebM</span>
                <div className="flex gap-2">
                    <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={isSending || isUploading}
                        className="rounded-full bg-gray-100 p-3 text-gray-600 transition-colors hover:bg-gray-200 disabled:opacity-50 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600 sm:p-2"
                        title="Anexar arquivo"
                        aria-label="Anexar arquivo"
                    >
                        {isUploading ? <Loader2 size={20} className="animate-spin" /> : <Paperclip size={20} />}
                    </button>
                    <button
                        type="button"
                        onClick={onSend}
                        disabled={isSending || isUploading || (!value.trim() && attachments.length === 0)}
                        aria-label="Enviar mensagem"
                        className="rounded-full bg-blue-600 p-3 text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50 sm:p-2"
                    >
                        {isSending ? <Loader2 size={20} className="animate-spin" /> : <Send size={20} />}
                    </button>
                </div>
            </div>
        </div>
    );
};
