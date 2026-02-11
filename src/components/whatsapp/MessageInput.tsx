import React, { useRef, useState } from 'react';
import { Send, Loader2, Mic, Paperclip, Smile, Trash2, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { AiService } from '../../services/aiService';
import { WhatsAppMessage } from '../../types';
import { logger } from '../../utils/logger';

const log = logger.child('MessageInput');

interface MessageInputProps {
    onSendMessage: (text: string) => Promise<void>;
    onSendAudio: (blob: Blob) => Promise<void>;
    onSendFile: (file: File) => Promise<void>;
    isSending: boolean;
    messagesForSmartReply?: WhatsAppMessage[]; // Context for AI
    selectedConversation?: any; // To check if active
    crmContext?: any; // Passed from parent (useCRMContext result)
}

export const MessageInput: React.FC<MessageInputProps> = ({
    onSendMessage,
    onSendAudio,
    onSendFile,
    isSending,
    messagesForSmartReply,
    selectedConversation,
    crmContext
}) => {
    // ... existing state ...
    const [inputText, setInputText] = useState('');
    const [isRecording, setIsRecording] = useState(false);
    const [recordingSeconds, setRecordingSeconds] = useState(0);
    const [isGeneratingSmartReply, setIsGeneratingSmartReply] = useState(false);

    // Refs
    // ... existing refs ...
    const fileInputRef = useRef<HTMLInputElement>(null);
    const recordingIntervalRef = useRef<number | null>(null);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const audioChunksRef = useRef<Blob[]>([]);

    // ... existing handlers ...
    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    const handleSend = async () => {
        if (!inputText.trim() || isSending) return;
        try {
            await onSendMessage(inputText);
            setInputText('');
        } catch (error) {
            log.error("Failed to send message", error);
            // Don't clear input so user can retry
            toast.error("Erro ao enviar. Tente novamente.");
        }
    };

    // ... existing recording handlers ...
    const startRecording = async () => {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            toast.error("Navegador não suporta gravação de áudio.");
            return;
        }

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const recorder = new MediaRecorder(stream);
            mediaRecorderRef.current = recorder;
            audioChunksRef.current = [];

            recorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    audioChunksRef.current.push(event.data);
                }
            };

            recorder.start();
            setIsRecording(true);
            setRecordingSeconds(0);
            recordingIntervalRef.current = window.setInterval(() => {
                setRecordingSeconds(prev => prev + 1);
            }, 1000);
        } catch (err: any) {
            log.error("Error accessing microphone", err);
            toast.error("Erro ao acessar microfone.");
        }
    };

    // ... cancelRecording, finishRecording, handleFileUpload ... (omitted for brevity, keeping existing via partial replacement if possible or full replace if needed)
    const cancelRecording = () => {
        if (recordingIntervalRef.current) clearInterval(recordingIntervalRef.current);
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
            mediaRecorderRef.current.stop();
            mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
        }
        setIsRecording(false);
        setRecordingSeconds(0);
        mediaRecorderRef.current = null;
    };

    const finishRecording = async () => {
        if (!mediaRecorderRef.current) return;
        if (recordingIntervalRef.current) clearInterval(recordingIntervalRef.current);
        const recorder = mediaRecorderRef.current;
        recorder.onstop = async () => {
            const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
            setIsRecording(false);
            if (recordingSeconds === 0) return;
            await onSendAudio(audioBlob);
            setRecordingSeconds(0);
            recorder.stream.getTracks().forEach(track => track.stop());
            mediaRecorderRef.current = null;
        };
        recorder.stop();
    };

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        await onSendFile(file);
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    const handleSmartReply = async () => {
        if (!selectedConversation) return;

        setIsGeneratingSmartReply(true);
        try {
            // Contexto simplificado: últimas 10 mensagens
            const history = messagesForSmartReply?.slice(-10).map(m =>
                `${m.sender === 'agent' ? 'Eu' : 'Cliente'}: ${m.text}`
            ).join('\n');

            const suggestion = await AiService.generateTicketReply(
                "WhatsApp Conversation",
                "Generate a reply based on history",
                history ? [history] : []
            );

            if (suggestion) {
                setInputText(suggestion);
                // Trigger resize
                setTimeout(() => {
                    const textarea = document.querySelector('textarea');
                    if (textarea) {
                        textarea.style.height = 'auto';
                        textarea.style.height = textarea.scrollHeight + 'px';
                    }
                }, 100);
            } else {
                toast.error("Não foi possível gerar uma resposta inteligente. Verifique a configuração da IA.");
            }
        } catch (error) {
            log.error("Smart reply failed", error);
            toast.error("Erro ao conectar com a Inteligência Artificial.");
        } finally {
            setIsGeneratingSmartReply(false);
        }
    };

    const formatRecordingTime = (seconds: number) => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    };

    return (
        <div className="p-3 bg-slate-100 dark:bg-slate-800 border-t border-slate-200 dark:border-slate-700 flex items-center gap-2">
            {isRecording ? (
                <>
                    <button onClick={cancelRecording} className="p-2 text-red-500 hover:bg-red-100 dark:hover:bg-red-900/30 rounded-full transition-colors"><Trash2 size={24} /></button>
                    <div className="flex-1 flex items-center justify-center gap-3">
                        <div className="w-3 h-3 bg-red-500 rounded-full animate-pulse"></div>
                        <span className="text-slate-600 dark:text-slate-300 font-mono text-lg">{formatRecordingTime(recordingSeconds)}</span>
                    </div>
                    <button
                        onClick={finishRecording}
                        className="p-3 bg-green-600 hover:bg-green-700 text-white rounded-full shadow-md transition-all animate-in zoom-in"
                    >
                        <Send size={20} />
                    </button>
                </>
            ) : (
                <>
                    <button className="p-2 text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-full"><Smile size={24} /></button>

                    <input
                        type="file"
                        ref={fileInputRef}
                        className="hidden"
                        onChange={handleFileUpload}
                        accept="image/*,video/*,audio/*,application/pdf,.doc,.docx"
                    />
                    <button
                        onClick={() => fileInputRef.current?.click()}
                        className="p-2 text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-full"
                        title="Anexar arquivo"
                    >
                        <Paperclip size={24} />
                    </button>

                    <div className="flex-1 bg-white dark:bg-slate-900 rounded-lg border border-slate-300 dark:border-slate-700 focus-within:ring-2 focus-within:ring-green-500 flex flex-col">
                        <textarea
                            className="w-full p-3 max-h-32 bg-transparent outline-none resize-none text-sm dark:text-white"
                            rows={1}
                            placeholder="Digite uma mensagem"
                            value={inputText}
                            onChange={(e) => setInputText(e.target.value)}
                            onKeyDown={handleKeyDown}
                        />
                    </div>

                    {inputText.trim() ? (
                        <button
                            onClick={handleSend}
                            disabled={isSending}
                            className="p-3 bg-green-600 hover:bg-green-700 text-white rounded-full shadow-md disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                        >
                            {isSending ? <Loader2 className="animate-spin" size={20} /> : <Send size={20} />}
                        </button>
                    ) : (
                        <button
                            onClick={startRecording}
                            className="p-3 bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-600 rounded-full shadow-sm transition-all"
                        >
                            <Mic size={20} />
                        </button>
                    )}
                </>
            )}

            {/* Smart Reply FAB */}
            {!isRecording && !inputText.trim() && (
                <button
                    onClick={handleSmartReply}
                    disabled={isGeneratingSmartReply}
                    className="absolute bottom-20 right-6 bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 p-3 rounded-full shadow-lg border border-slate-100 dark:border-slate-700 hover:scale-105 transition-transform group z-20"
                    title="Sugerir resposta com IA"
                >
                    {isGeneratingSmartReply ? <Loader2 className="animate-spin" size={20} /> : <Sparkles size={20} />}
                </button>
            )}
        </div>
    );
};
