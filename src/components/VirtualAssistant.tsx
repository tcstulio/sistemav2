import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { MessageSquare, X, Send, Sparkles, Loader2, Mic, Paperclip, Image as ImageIcon, FileText, Bot, User, Trash2, History, Plus, Zap } from 'lucide-react';
import { AiService, ChatMessage } from '../services/aiService';
import { ThirdParty, Invoice, Project, Ticket } from '../types';
import { useDolibarr } from '../context/DolibarrContext';
import { safeStorage } from '../utils/safeStorage';
import { logger } from '../utils/logger';
import { formatErrorsForAgent } from '../utils/errorStore';
import { useLocation } from 'react-router-dom';
import { formatViewContext } from '../config/viewRegistry';
import { getAgentBootstrapConfig, AgentBootstrapConfig } from '../services/agentBootstrapService';
// Hooks removidos: Backend processa dados via ferramentas IA

const log = logger.child('VirtualAssistant');

// Persistência do histórico do chat (antes era só estado React -> sumia no reload/navegação).
const VA_HISTORY_KEY = 'coolgroove_va_history';
const VA_SESSION_ID_KEY = 'coolgroove_va_session_id';
const MAX_STORED_MESSAGES = 50;
const WELCOME_MESSAGE: ChatMessage = { role: 'model', text: 'Olá! Sou seu Assistente Virtual. Posso analisar documentos e responder perguntas sobre seus dados.' };

// Default usado se a config não carregar (degradação graciosa): comportamento original.
const DEFAULT_BOOTSTRAP_CONFIG: AgentBootstrapConfig = {
  enabled: true, includeTasks: true, includeAgenda: true, includeFinancial: true, extraInstruction: '',
};

// Sessão automática (#300): ao abrir uma conversa nova, o agente reúne proativamente um resumo
// do dia. O QUE ele reúne é configurável pelo admin (#300 item 3 — agentBootstrapService).
const buildBootstrapPrompt = (cfg: AgentBootstrapConfig): string => {
  const items: string[] = [];
  if (cfg.includeTasks) items.push('minhas tarefas pendentes (list_user_tasks)');
  if (cfg.includeAgenda) items.push('meus próximos compromissos/agenda (list_events)');
  if (cfg.includeFinancial) items.push('um resumo financeiro rápido (get_financial_summary)');

  const lines = ['[INÍCIO DE SESSÃO] Gere um resumo proativo e curto para abrir a conversa, em pt-BR e cordial.'];
  if (items.length > 0) {
    lines.push('Reúna, usando as ferramentas disponíveis:');
    items.forEach((it, i) => lines.push(`${i + 1}) ${it},`));
    lines.push('Use bullets curtos. NÃO invente dados: se uma ferramenta não retornar ou eu não tiver acesso, apenas omita aquele item.');
  }
  if (cfg.extraInstruction?.trim()) lines.push(cfg.extraInstruction.trim());
  lines.push('Encerre perguntando como pode ajudar hoje.');
  return lines.join('\n');
};

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
  const location = useLocation();

  // Data fetching removed - Backend now handles this via ReAct tools

  const [isOpen, setIsOpen] = useState(false);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(() => {
    return safeStorage.getItem(VA_SESSION_ID_KEY);
  });
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    const saved = safeStorage.getJSON<ChatMessage[]>(VA_HISTORY_KEY, []);
    return Array.isArray(saved) && saved.length > 0 ? saved : [WELCOME_MESSAGE];
  });
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [attachedImage, setAttachedImage] = useState<{ data: string, mimeType: string } | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [sessions, setSessions] = useState<Array<{ id: string; title: string; updatedAt: number; messageCount: number }>>([]);
  const [attachedPdf, setAttachedPdf] = useState<{ name: string; data: string } | null>(null);
  const [contextWindow, setContextWindow] = useState<number>(200000);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const bootstrapAttemptedRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isOpen]);

  useEffect(() => {
    safeStorage.setJSON(VA_HISTORY_KEY, messages.slice(-MAX_STORED_MESSAGES));
  }, [messages]);

  useEffect(() => {
    if (currentSessionId && messages.length <= 1) {
      AiService.getChatSession(currentSessionId).then(session => {
        if (session?.messages?.length) {
          const restored: ChatMessage[] = session.messages
            .filter((m: any) => m.role === 'user' || m.role === 'model')
            .map((m: any) => ({ role: m.role, text: m.content }));
          if (restored.length > 0) setMessages(restored);
        }
      }).catch(() => { /* fallback to localStorage */ });
    }
  }, []);

  const loadSessions = async () => {
    const list = await AiService.getChatSessions(20);
    setSessions(list.map((s: any) => ({ id: s.id, title: s.title, updatedAt: s.updatedAt, messageCount: s.messageCount })));
    setShowHistory(true);
  };

  const switchSession = async (sessionId: string) => {
    const session = await AiService.getChatSession(sessionId);
    if (session?.messages?.length) {
      const restored: ChatMessage[] = session.messages
        .filter((m: any) => m.role === 'user' || m.role === 'model')
        .map((m: any) => ({ role: m.role, text: m.content }));
      setMessages(restored.length > 0 ? restored : [WELCOME_MESSAGE]);
    } else {
      setMessages([WELCOME_MESSAGE]);
    }
    setCurrentSessionId(sessionId);
    safeStorage.setItem(VA_SESSION_ID_KEY, sessionId);
    setShowHistory(false);
  };

  const startNewSession = () => {
    setMessages([WELCOME_MESSAGE]);
    setCurrentSessionId(null);
    safeStorage.removeItem(VA_SESSION_ID_KEY);
    safeStorage.removeItem(VA_HISTORY_KEY);
    setShowHistory(false);
  };

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.message) {
        setIsOpen(true);
        setInput(detail.message);
      }
    };
    window.addEventListener('open-virtual-assistant', handler);
    return () => window.removeEventListener('open-virtual-assistant', handler);
  }, []);

  const clearHistory = async () => {
    if (currentSessionId) {
      await AiService.deleteChatSession(currentSessionId);
    }
    setMessages([WELCOME_MESSAGE]);
    safeStorage.removeItem(VA_HISTORY_KEY);
    safeStorage.removeItem(VA_SESSION_ID_KEY);
    setCurrentSessionId(null);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onloadend = () => {
      const base64String = reader.result as string;
      const base64Data = base64String.split(',')[1];
      setAttachedImage({
        data: base64Data,
        mimeType: file.type
      });
    };
    reader.readAsDataURL(file);
  };

  const handlePdfSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64Data = (reader.result as string).split(',')[1];
      setAttachedPdf({ name: file.name, data: base64Data });
    };
    reader.readAsDataURL(file);
  };

  // Sessão automática (#300): reúne o resumo do dia via agente e exibe como abertura.
  const handleBootstrap = async () => {
    // Config do admin (#300 item 3): se desligada, mantém a saudação estática.
    const cfg = (await getAgentBootstrapConfig()) || DEFAULT_BOOTSTRAP_CONFIG;
    if (!cfg.enabled) return;

    setIsLoading(true);
    try {
      let sid = currentSessionId;
      if (!sid) {
        const session = await AiService.createChatSession('Resumo inicial');
        if (session) {
          sid = session.id;
          setCurrentSessionId(sid);
          safeStorage.setItem(VA_SESSION_ID_KEY, sid);
        }
      }
      const pageContext = formatViewContext(location.pathname, location.search || undefined);
      const result = await AiService.chatWithData(buildBootstrapPrompt(cfg), [], undefined, sid || undefined, pageContext);
      if ((result as any)?.contextWindow) setContextWindow((result as any).contextWindow);
      if (result?.reply) {
        setMessages([{ role: 'model', text: result.reply, usage: (result as any).usage, model: (result as any).model, fellBack: (result as any).fellBack }]);
      }
    } catch {
      // Mantém a saudação estática em caso de erro (degradação graciosa).
    } finally {
      setIsLoading(false);
    }
  };

  // Dispara o bootstrap só na 1ª abertura de uma conversa NOVA (sem sessão/histórico) e sem input
  // pendente (ex.: aberturas vindas de "Reportar ao Assistente" já trazem um texto e são puladas).
  useEffect(() => {
    const isFreshWelcome = messages.length === 1 && messages[0]?.role === 'model' && messages[0]?.text === WELCOME_MESSAGE.text;
    if (isOpen && !bootstrapAttemptedRef.current && !currentSessionId && isFreshWelcome && !input.trim()) {
      bootstrapAttemptedRef.current = true;
      void handleBootstrap();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const handleSend = async () => {
    if ((!input.trim() && !attachedImage && !attachedPdf) || isLoading) return;

    const userMsg = input;
    const userImage = attachedImage;
    const userPdf = attachedPdf;

    setInput('');
    setAttachedImage(null);
    setAttachedPdf(null);

    setMessages(prev => [
      ...prev,
      {
        role: 'user',
        text: userMsg + (userImage ? ' [Imagem Anexada]' : '') + (userPdf ? ` [PDF: ${userPdf.name}]` : '')
      }
    ]);

    setIsLoading(true);

    try {
      const relevantHistory = messages.filter((m, index) => {
        if (index === 0 && m.role === 'model' && m.text.includes('Olá! Sou seu Assistente Virtual')) {
          return false;
        }
        return true;
      });

      let pdfContext = '';
      if (userPdf) {
        const pdfAnalysis = await AiService.analyzePdf(userPdf.data, userMsg || undefined);
        pdfContext = `\n\n[CONTEXTO DO PDF "${userPdf.name}"]: ${pdfAnalysis}`;
      }

      let sid = currentSessionId;
      if (!sid) {
        const session = await AiService.createChatSession(userMsg);
        if (session) {
          sid = session.id;
          setCurrentSessionId(sid);
          safeStorage.setItem(VA_SESSION_ID_KEY, sid);
        }
      }

      const pageContext = `${formatViewContext(location.pathname, location.search || undefined)}\n${formatErrorsForAgent()}${pdfContext}`;

      const result = await AiService.chatWithData(userMsg, relevantHistory, userImage?.data, sid || undefined, pageContext);
      const responseText = result.reply;
      if ((result as any).contextWindow) setContextWindow((result as any).contextWindow);
      if (result.sessionId && !sid) {
        setCurrentSessionId(result.sessionId);
        safeStorage.setItem(VA_SESSION_ID_KEY, result.sessionId);
      }
      if (responseText) {
        const newUsage = (result as any).usage;
        const newModel = (result as any).model as string | undefined;
        const newFellBack = (result as any).fellBack as boolean | undefined;
        setMessages(prev => {
          const updated: ChatMessage[] = [...prev, { role: 'model' as const, text: responseText, usage: newUsage, model: newModel, fellBack: newFellBack }];
          const total = updated.reduce((sum, m) => sum + (m.usage?.totalTokens || 0), 0);
          const pct = contextWindow > 0 ? (total / contextWindow) * 100 : 0;
          if (pct > 90) {
            return [...updated, { role: 'model' as const, text: '⚠️ Contexto acima de 90%. Considere iniciar uma nova conversa para manter a qualidade das respostas.', isError: true }];
          }
          if (pct > 70) {
            return [...updated, { role: 'model' as const, text: '💡 O contexto está ficando grande (>70%). Se as respostas perderem qualidade, comece uma nova conversa.' }];
          }
          return updated;
        });
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

  const toggleVoice = async () => {
    if (isListening && mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
      setIsListening(false);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
      mediaRecorderRef.current = recorder;
      audioChunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const reader = new FileReader();
        reader.onloadend = async () => {
          const base64 = (reader.result as string).split(',')[1];
          setIsLoading(true);
          setMessages(prev => [...prev, { role: 'user', text: '🎤 Mensagem de voz...' }]);
          try {
            const transcription = await AiService.transcribeAudio(base64, 'audio/webm');
            setMessages(prev => {
              const updated = [...prev];
              updated[updated.length - 1] = { role: 'user', text: transcription };
              return updated;
            });
            setInput(transcription);
          } catch {
            setMessages(prev => {
              const updated = [...prev];
              updated[updated.length - 1] = { role: 'user', text: '🎤 [Erro na transcrição]', isError: true };
              return updated;
            });
          } finally {
            setIsLoading(false);
          }
        };
        reader.readAsDataURL(blob);
      };

      recorder.start();
      setIsListening(true);
    } catch {
      setMessages(prev => [...prev, { role: 'model', text: 'Não consegui acessar o microfone. Verifique as permissões.', isError: true }]);
    }
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
              {messages.length > 0 && (() => {
                const total = messages.reduce((sum, m) => sum + (m.usage?.totalTokens || 0), 0);
                const pct = contextWindow > 0 ? Math.min(100, Math.round((total / contextWindow) * 100)) : 0;
                const barColor = pct > 90 ? 'bg-red-400' : pct > 70 ? 'bg-yellow-400' : 'bg-emerald-400';
                return total > 0 ? (
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] text-white/70" title={`${total.toLocaleString()} / ${contextWindow.toLocaleString()} tokens`}>
                      {total.toLocaleString()} ({pct}%)
                    </span>
                    <div className="w-12 h-1.5 bg-white/20 rounded-full overflow-hidden">
                      <div className={`h-full ${barColor} rounded-full transition-all`} style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                ) : null;
              })()}
            </div>
            <div className="flex items-center gap-1">
              <button onClick={startNewSession} title="Nova conversa" className="hover:bg-white/20 p-1 rounded-full transition-colors">
                <Plus size={16} />
              </button>
              <button onClick={loadSessions} title="Histórico de conversas" className="hover:bg-white/20 p-1 rounded-full transition-colors">
                <History size={16} />
              </button>
              <button onClick={clearHistory} title="Limpar conversa" className="hover:bg-white/20 p-1 rounded-full transition-colors">
                <Trash2 size={16} />
              </button>
              <button onClick={() => setIsOpen(false)} title="Fechar" className="hover:bg-white/20 p-1 rounded-full transition-colors">
                <X size={18} />
              </button>
            </div>
          </div>

          {/* History Panel */}
          {showHistory && (
            <div className="flex-1 overflow-y-auto p-3 bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 space-y-1">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase">Conversas anteriores</span>
                <button onClick={() => setShowHistory(false)} className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline">Fechar</button>
              </div>
              {sessions.length === 0 && (
                <p className="text-xs text-slate-400 text-center py-4">Nenhuma conversa anterior</p>
              )}
              {sessions.map(s => (
                <div key={s.id} className="flex items-center gap-1 group">
                  <button
                    onClick={() => switchSession(s.id)}
                    className={`flex-1 text-left p-2.5 rounded-lg transition-colors text-sm ${s.id === currentSessionId ? 'bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800' : 'hover:bg-slate-100 dark:hover:bg-slate-800'}`}
                  >
                    <div className="font-medium text-slate-700 dark:text-slate-300 truncate">{s.title}</div>
                    <div className="text-[10px] text-slate-400 mt-0.5">
                      {new Date(s.updatedAt).toLocaleString('pt-BR')} · {s.messageCount} msgs
                    </div>
                  </button>
                  <button
                    onClick={async (e) => {
                      e.stopPropagation();
                      const ok = await AiService.deleteChatSession(s.id);
                      if (ok) {
                        setSessions(prev => prev.filter(x => x.id !== s.id));
                        if (s.id === currentSessionId) {
                          setMessages([WELCOME_MESSAGE]);
                          setCurrentSessionId(null);
                          safeStorage.removeItem(VA_SESSION_ID_KEY);
                          safeStorage.removeItem(VA_HISTORY_KEY);
                        }
                      }
                    }}
                    className="p-1.5 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-red-50 dark:hover:bg-red-900/20 text-slate-300 hover:text-red-500 transition-opacity shrink-0"
                    title="Excluir sessão"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Messages */}
          <div className={`flex-1 overflow-y-auto p-4 space-y-4 bg-slate-50 dark:bg-slate-950 ${showHistory ? 'hidden' : ''}`} ref={scrollRef}>
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
                    {msg.role === 'model' && (msg.usage || msg.model) && (
                      <div className="flex items-center gap-2 mt-1 pt-1 border-t border-slate-100 dark:border-slate-700/50 flex-wrap">
                        {msg.usage && (
                          <span className="text-[10px] text-slate-400 dark:text-slate-500" title="Tokens enviados / recebidos / total">
                            ↑{msg.usage.promptTokens?.toLocaleString()} ↓{msg.usage.completionTokens?.toLocaleString()} · {msg.usage.totalTokens?.toLocaleString()} tokens
                          </span>
                        )}
                        {msg.model && (
                          msg.fellBack
                            ? <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 font-medium" title="Modelo primário indisponível; respondido pelo fallback">
                                {msg.model} (fallback)
                              </span>
                            : <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-700/50 text-slate-500 dark:text-slate-400">
                                {msg.model}
                              </span>
                        )}
                      </div>
                    )}
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

          {/* PDF Preview */}
          {attachedPdf && (
            <div className="p-2 bg-slate-100 dark:bg-slate-800 border-t border-slate-200 dark:border-slate-700 flex items-center gap-2">
              <div className="text-xs bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 px-2 py-1 rounded flex items-center gap-1">
                <FileText size={12} /> {attachedPdf.name}
                <button onClick={() => setAttachedPdf(null)} className="ml-1 hover:text-red-500"><X size={12} /></button>
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
                <button
                  onClick={() => pdfInputRef.current?.click()}
                  className={`p-2 rounded-full transition-all hover:bg-slate-100 dark:hover:bg-slate-800 ${attachedPdf ? 'text-red-600' : 'text-slate-400'}`}
                  title="Anexar PDF"
                >
                  <FileText size={20} />
                </button>
                <input
                  type="file"
                  ref={fileInputRef}
                  className="hidden"
                  accept="image/*"
                  onChange={handleFileSelect}
                />
                <input
                  type="file"
                  ref={pdfInputRef}
                  className="hidden"
                  accept=".pdf"
                  onChange={handlePdfSelect}
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
                disabled={!input.trim() && !attachedImage && !attachedPdf}
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
