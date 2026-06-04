import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { MessageSquare, X, Send, Sparkles, Loader2, Mic, Paperclip, Image as ImageIcon, FileText, Bot, User, Trash2 } from 'lucide-react';
import { AiService, ChatMessage } from '../services/aiService';
import { ThirdParty, Invoice, Project, Ticket } from '../types';
import { useDolibarr } from '../context/DolibarrContext';
import { safeStorage } from '../utils/safeStorage';
import { logger } from '../utils/logger';
// Hooks removidos: Backend processa dados via ferramentas IA

const log = logger.child('VirtualAssistant');

// Persistência do histórico do chat (antes era só estado React -> sumia no reload/navegação).
const VA_HISTORY_KEY = 'coolgroove_va_history';
const MAX_STORED_MESSAGES = 50;
const WELCOME_MESSAGE: ChatMessage = { role: 'model', text: 'Olá! Sou seu Assistente Virtual. Posso analisar documentos e responder perguntas sobre seus dados.' };

// Deeplinks internos do agente (ex.: /tickets/new?prefill=<token>) e URLs http(s).
const INTERNAL_DEEPLINK = /\/[A-Za-z0-9_\-/]+\?prefill=[A-Za-z0-9._-]+/g;
const ABSOLUTE_URL = /https?:\/\/[^\s)]+/g;

// Torna links clicáveis na resposta do agente: deeplink interno navega in-app (React Router);
// URL http(s) abre em nova aba. Caso contrário, renderiza texto puro.
const renderMessageContent = (text: string, navigate: (to: string) => void): React.ReactNode => {
    if (!text) return text;
    type Match = { start: number; end: number; value: string; kind: 'internal' | 'url' };
    const matches: Match[] = [];
    let m: RegExpExecArray | null;

    const internal = new RegExp(INTERNAL_DEEPLINK);
    while ((m = internal.exec(text)) !== null) {
        matches.push({ start: m.index, end: m.index + m[0].length, value: m[0], kind: 'internal' });
    }
    const url = new RegExp(ABSOLUTE_URL);
    while ((m = url.exec(text)) !== null) {
        const hit = m;
        const overlap = matches.some(x => hit.index < x.end && (hit.index + hit[0].length) > x.start);
        if (!overlap) matches.push({ start: hit.index, end: hit.index + hit[0].length, value: hit[0], kind: 'url' });
    }
    if (matches.length === 0) return text;
    matches.sort((a, b) => a.start - b.start);

    const nodes: React.ReactNode[] = [];
    let cursor = 0;
    matches.forEach((mt, i) => {
        if (mt.start > cursor) nodes.push(text.slice(cursor, mt.start));
        if (mt.kind === 'internal') {
            nodes.push(
                <button
                    key={`l${i}`}
                    type="button"
                    onClick={() => navigate(mt.value)}
                    className="inline-flex items-center gap-1 px-2 py-0.5 my-0.5 rounded-md bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 transition-colors"
                >
                    Revisar e criar ↗
                </button>
            );
        } else {
            nodes.push(
                <a key={`l${i}`} href={mt.value} target="_blank" rel="noopener noreferrer" className="text-indigo-600 dark:text-indigo-400 underline break-all">
                    {mt.value}
                </a>
            );
        }
        cursor = mt.end;
    });
    if (cursor < text.length) nodes.push(text.slice(cursor));
    return nodes;
};

interface VirtualAssistantProps {
  // No props needed
}

const VirtualAssistant: React.FC<VirtualAssistantProps> = () => {
  const { config } = useDolibarr();
  const navigate = useNavigate();

  // Data fetching removed - Backend now handles this via ReAct tools

  const [isOpen, setIsOpen] = useState(false);
  // carrega o histórico persistido (sobrevive a reload/navegação); cai no welcome se vazio.
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    const saved = safeStorage.getJSON<ChatMessage[]>(VA_HISTORY_KEY, []);
    return Array.isArray(saved) && saved.length > 0 ? saved : [WELCOME_MESSAGE];
  });
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [attachedImage, setAttachedImage] = useState<{ data: string, mimeType: string } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isOpen]);

  // persiste o histórico (últimas N mensagens) a cada mudança.
  useEffect(() => {
    safeStorage.setJSON(VA_HISTORY_KEY, messages.slice(-MAX_STORED_MESSAGES));
  }, [messages]);

  const clearHistory = () => {
    setMessages([WELCOME_MESSAGE]);
    safeStorage.removeItem(VA_HISTORY_KEY);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onloadend = () => {
      const base64String = reader.result as string;
      // Extract the base64 data part (remove "data:image/png;base64,")
      const base64Data = base64String.split(',')[1];
      setAttachedImage({
        data: base64Data,
        mimeType: file.type
      });
    };
    reader.readAsDataURL(file);
  };

  const handleSend = async () => {
    if ((!input.trim() && !attachedImage) || isLoading) return;

    const userMsg = input;
    const userImage = attachedImage;

    setInput('');
    setAttachedImage(null);

    // Optimistic UI update
    setMessages(prev => [
      ...prev,
      {
        role: 'user',
        text: userMsg + (userImage ? ' [Imagem Anexada]' : '')
      }
    ]);

    setIsLoading(true);

    try {
      // Passar apenas a mensagem e imagem. O backend buscará os dados (Ferramentas).
      // Mantendo historico? O backend pede historico, mas o frontend service original nao passava o state 'messages'.
      // Vamos verificar o frontend aiService.
      // Filter out the initial welcome message if it exists (usually the first message)
      // We only want to send relevant conversation history
      const relevantHistory = messages.filter((m, index) => {
        if (index === 0 && m.role === 'model' && m.text.includes('Olá! Sou seu Assistente Virtual')) {
          return false;
        }
        return true;
      });

      const responseText = await AiService.chatWithData(userMsg, relevantHistory, userImage?.data);
      if (responseText) {
        setMessages(prev => [...prev, { role: 'model', text: responseText }]);
      } else {
        setMessages(prev => [...prev, { role: 'model', text: "Não consegui gerar uma resposta." }]);
      }
    } catch (error) {
      setMessages(prev => [...prev, { role: 'model', text: "Desculpe, encontrei um erro ao processar sua solicitação.", isError: true }]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const toggleVoice = () => {
    if (!('webkitSpeechRecognition' in window)) {
      alert("Reconhecimento de voz não suportado neste navegador.");
      return;
    }

    if (isListening) {
      setIsListening(false);
      return;
    }

    const recognition = new (window as any).webkitSpeechRecognition();
    recognition.lang = 'pt-BR'; // Portuguese
    recognition.continuous = false;
    recognition.interimResults = false;

    recognition.onstart = () => setIsListening(true);
    recognition.onend = () => setIsListening(false);
    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      setInput(prev => prev + (prev ? ' ' : '') + transcript);
    };
    recognition.onerror = (event: any) => {
      log.error("Erro de fala", event);
      setIsListening(false);
    };

    recognition.start();
  };

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end pointer-events-none">
      {/* Chat Window */}
      {isOpen && (
        <div className="bg-white dark:bg-slate-900 pointer-events-auto rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 w-[calc(100vw-3rem)] sm:w-96 h-[550px] max-h-[75vh] flex flex-col mb-4 overflow-hidden transition-all animate-in slide-in-from-bottom-10 fade-in duration-200">

          {/* Header */}
          <div className="bg-gradient-to-r from-indigo-600 to-violet-600 p-4 flex justify-between items-center text-white shrink-0">
            <div className="flex items-center gap-2">
              <Sparkles size={18} className="text-yellow-300" />
              <h3 className="font-semibold text-sm">Assistente Virtual</h3>
            </div>
            <div className="flex items-center gap-1">
              <button onClick={clearHistory} title="Limpar conversa" className="hover:bg-white/20 p-1 rounded-full transition-colors">
                <Trash2 size={16} />
              </button>
              <button onClick={() => setIsOpen(false)} title="Fechar" className="hover:bg-white/20 p-1 rounded-full transition-colors">
                <X size={18} />
              </button>
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-50 dark:bg-slate-950" ref={scrollRef}>
            {messages.map((msg, idx) => (
              <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`flex gap-2 max-w-[85%] ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 shadow-sm mt-auto ${msg.role === 'user' ? 'bg-indigo-600 text-white' : 'bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 border border-slate-200 dark:border-slate-700'}`}>
                    {msg.role === 'user' ? <User size={14} /> : <Bot size={16} />}
                  </div>
                  <div className={`p-3 rounded-2xl text-sm shadow-sm whitespace-pre-wrap leading-relaxed ${msg.role === 'user'
                    ? 'bg-indigo-600 text-white rounded-br-none'
                    : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 rounded-bl-none'
                    }`}>
                    {msg.role === 'model' ? renderMessageContent(msg.text, navigate) : msg.text}
                  </div>
                </div>
              </div>
            ))}
            {isLoading && (
              <div className="flex justify-start">
                <div className="flex gap-2 max-w-[85%]">
                  <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 bg-white dark:bg-slate-800 text-indigo-600 border border-slate-200 dark:border-slate-700 mt-auto">
                    <Bot size={16} />
                  </div>
                  <div className="bg-white dark:bg-slate-800 p-3 rounded-2xl rounded-bl-none border border-slate-200 dark:border-slate-700">
                    <div className="flex gap-1">
                      <div className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce"></div>
                      <div className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce delay-75"></div>
                      <div className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce delay-150"></div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Image Preview */}
          {attachedImage && (
            <div className="p-2 bg-slate-100 dark:bg-slate-800 border-t border-slate-200 dark:border-slate-700 flex items-center gap-2">
              <div className="text-xs bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 px-2 py-1 rounded flex items-center gap-1">
                <ImageIcon size={12} /> Imagem Anexada
                <button onClick={() => setAttachedImage(null)} className="ml-1 hover:text-red-500"><X size={12} /></button>
              </div>
            </div>
          )}

          {/* Input Area */}
          <div className="p-3 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 shrink-0">
            <div className="flex items-end gap-2">
              <div className="flex gap-1">
                <button
                  onClick={toggleVoice}
                  className={`p-2 rounded-full transition-all ${isListening ? 'bg-red-100 text-red-600 animate-pulse' : 'hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400'}`}
                  title="Entrada de Voz"
                >
                  <Mic size={20} />
                </button>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className={`p-2 rounded-full transition-all hover:bg-slate-100 dark:hover:bg-slate-800 ${attachedImage ? 'text-indigo-600' : 'text-slate-400'}`}
                  title="Anexar Imagem"
                >
                  <Paperclip size={20} />
                </button>
                <input
                  type="file"
                  ref={fileInputRef}
                  className="hidden"
                  accept="image/*"
                  onChange={handleFileSelect}
                />
              </div>

              <div className="flex-1 bg-slate-100 dark:bg-slate-800 rounded-xl p-2 focus-within:ring-2 focus-within:ring-indigo-500/50 transition-all border border-transparent focus-within:border-indigo-500">
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyPress}
                  placeholder="Pergunte ao Assistente..."
                  rows={1}
                  className="w-full bg-transparent border-none outline-none text-sm resize-none max-h-24 text-slate-800 dark:text-slate-200 placeholder:text-slate-400"
                  style={{ minHeight: '24px' }}
                />
              </div>

              <button
                onClick={handleSend}
                disabled={!input.trim() && !attachedImage}
                className="p-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
              >
                <Send size={20} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Floating Action Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="pointer-events-auto bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 text-white p-4 rounded-full shadow-lg hover:shadow-xl hover:scale-105 transition-all duration-200 group relative"
      >
        {isOpen ? <X size={24} /> : <Sparkles size={24} />}
        {!isOpen && (
          <span className="absolute right-full mr-3 top-1/2 -translate-y-1/2 bg-slate-800 text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
            Pergunte ao Assistente
          </span>
        )}
      </button>
    </div>
  );
};

export default VirtualAssistant;
