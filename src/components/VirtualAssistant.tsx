import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { MessageSquare, X, Send, Sparkles, Loader2, Mic, Paperclip, Image as ImageIcon, FileText, Bot, User, Trash2, History, Plus, Zap, Volume2, Square } from 'lucide-react';
import { AiService, ChatMessage, ChatJobProgress } from '../services/aiService';
import { toast } from 'sonner';
import { ThirdParty, Invoice, Project, Ticket } from '../types';
import { useDolibarr } from '../context/DolibarrContext';
import { safeStorage } from '../utils/safeStorage';
import { logger } from '../utils/logger';
import { formatErrorsForAgent } from '../utils/errorStore';
import { useLocation } from 'react-router-dom';
import { formatViewContext } from '../config/viewRegistry';
import { getAgentBootstrapConfig, AgentBootstrapConfig } from '../services/agentBootstrapService';
import { getContextUsage } from '../utils/contextUsage';
import { AgentMarkdown } from './ui/AgentMarkdown';
import { ChatMessages } from './chat/ChatMessages';
// Hooks removidos: Backend processa dados via ferramentas IA

const log = logger.child('VirtualAssistant');

// Persistência do histórico do chat (antes era só estado React -> sumia no reload/navegação).
const VA_HISTORY_KEY = 'coolgroove_va_history';
const VA_SESSION_ID_KEY = 'coolgroove_va_session_id';
const VA_PENDING_JOB_KEY = 'coolgroove_va_pending_job'; // #953: job em andamento (sobrevive ao F5)
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

// A renderização da resposta do agente (markdown + links clicáveis + tabelas) foi extraída
// para o componente compartilhado ./ui/AgentMarkdown. O renderMessageContent antigo (regex de
// deeplink/URL, com TODO o resto em texto puro) deixava markdown e links `[x](/rel)` sem render.

// #947: normaliza QUALQUER imagem para um JPEG pequeno e exibível.
// - HEIC/HEIF (padrão do iPhone): o navegador não decodifica no <img>/canvas (exceto Safari)
//   -> converte via heic2any (import dinâmico, só quando necessário).
// - Redimensiona p/ máx 1600px e comprime (jpeg q0.85): foto de 8-12MB -> ~300-800KB,
//   evitando o HTTP 413 do servidor; a visão (glm-4.6v) lê igual.
// Retorna null se o formato não puder ser lido (o chamador avisa o usuário).
async function processImageFile(file: File): Promise<{ data: string; mimeType: string; preview: string } | null> {
  let blob: Blob = file;
  const isHeic = /heic|heif/i.test(file.type) || /\.hei[cf]$/i.test(file.name);
  if (isHeic) {
    try {
      const heic2any = (await import('heic2any')).default as (o: any) => Promise<Blob | Blob[]>;
      const out = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.85 });
      blob = Array.isArray(out) ? out[0] : out;
    } catch {
      // segue; o Safari decodifica HEIC nativamente no <img> abaixo
    }
  }
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const MAX = 1600;
      const scale = Math.min(1, MAX / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
      resolve({ data: dataUrl.split(',')[1], mimeType: 'image/jpeg', preview: dataUrl });
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    img.src = url;
  });
}

const VirtualAssistant: React.FC = () => {
  const { config } = useDolibarr();
  const navigate = useNavigate();
  const location = useLocation();

  // Data fetching removed - Backend now handles this via ReAct tools

  const [isOpen, setIsOpen] = useState(false);
  // #1013: lastHeartbeat do polling (para o indicador "Processando... Xs desde último update").
  const [lastHeartbeat, setLastHeartbeat] = useState<number | null>(null);
  const [nowTick, setNowTick] = useState<number>(() => Date.now());
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(() => {
    return safeStorage.getItem(VA_SESSION_ID_KEY);
  });
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    const saved = safeStorage.getJSON<ChatMessage[]>(VA_HISTORY_KEY, []);
    return Array.isArray(saved) && saved.length > 0 ? saved : [WELCOME_MESSAGE];
  });
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const cancelledJobsRef = useRef(new Set<string>());
  const [isListening, setIsListening] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [attachedImages, setAttachedImages] = useState<{ data: string; mimeType: string; preview: string }[]>([]);
  const [imageProcessing, setImageProcessing] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [sessions, setSessions] = useState<Array<{ id: string; title: string; updatedAt: number; messageCount: number }>>([]);
  const [attachedPdf, setAttachedPdf] = useState<{ name: string; data: string } | null>(null);
  const [contextWindow, setContextWindow] = useState<number>(200000);
  const [speakingIdx, setSpeakingIdx] = useState<number | null>(null);
  const ttsAudioRef = useRef<HTMLAudioElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const bootstrapAttemptedRef = useRef(false);
  // #1153: cacheia a Promise de criação de sessão em andamento. Previne race
  // condition onde dois renders quase simultâneos (StrictMode em dev, cliques
  // rápidos no botão 'nova conversa') disparam createChatSession() em paralelo
  // e criam 2 sessões para o mesmo usuário.
  const sessionCreationRef = useRef<Promise<string | null> | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);

  const handleJobCancelled = useCallback((jobId: string, summary: string) => {
    cancelledJobsRef.current.add(jobId);
    setMessages(prev => [...prev, { role: 'model', text: summary }]);
    setActiveJobId(current => current === jobId ? null : current);
    setIsLoading(false);
    setLastHeartbeat(null);
    safeStorage.removeItem(VA_PENDING_JOB_KEY);
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isOpen]);

  useEffect(() => {
    safeStorage.setJSON(VA_HISTORY_KEY, messages.slice(-MAX_STORED_MESSAGES));
  }, [messages]);

  // #1013: ticker de 1s enquanto carrega — atualiza o indicador "Xs desde último update".
  useEffect(() => {
    if (!isLoading) return;
    const id = window.setInterval(() => setNowTick(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [isLoading]);

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

  // #953: se a página recarregou com um job em andamento, RETOMA o polling — a resposta do
  // agente (que o backend guarda ~30min) não se perde. Antes: o jobId vivia só no estado,
  // recarregar matava o polling e a resposta nunca chegava.
  useEffect(() => {
    const pending = safeStorage.getJSON<{ jobId: string } | null>(VA_PENDING_JOB_KEY, null);
    if (!pending?.jobId) return;
    setIsLoading(true);
    setActiveJobId(pending.jobId);
    setLastHeartbeat(Date.now());
    AiService.resumeChatJob(pending.jobId, (p: ChatJobProgress) => setLastHeartbeat(p.lastHeartbeat))
      .then((result: any) => {
        if (cancelledJobsRef.current.has(pending.jobId)) return;
        if (result?.contextWindow) setContextWindow(result.contextWindow);
        const responseText = result?.reply;
        if (responseText) {
          setMessages(prev => {
            const last = prev[prev.length - 1];
            if (last && last.role === 'model' && last.text === responseText) return prev; // já veio
            return [...prev, { role: 'model', text: responseText, usage: result.usage, model: result.model, fellBack: result.fellBack }];
          });
        }
      })
      .catch(() => {
        if (cancelledJobsRef.current.has(pending.jobId)) return;
        setMessages(prev => [...prev, { role: 'model', text: '⚠️ A resposta anterior foi interrompida ao recarregar a página. Envie a pergunta novamente, se precisar.', isError: true }]);
      })
      .finally(() => {
        setIsLoading(false);
        setActiveJobId(current => current === pending.jobId ? null : current);
        setLastHeartbeat(null);
        safeStorage.removeItem(VA_PENDING_JOB_KEY);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadSessions = async () => {
    const list = await AiService.getChatSessions(20);
    setSessions(list.map((s: any) => ({ id: s.id, title: s.title, updatedAt: s.updatedAt, messageCount: s.messageCount })));
    setShowHistory(true);
  };

  const switchSession = async (sessionId: string) => {
    // #1153: descarta criação em andamento ao trocar para sessão existente.
    sessionCreationRef.current = null;
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
    // #1153: descarta Promise de criação em andamento — não reaproveitar ref stale.
    sessionCreationRef.current = null;
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
    // #1153: descarta Promise de criação em andamento.
    sessionCreationRef.current = null;
    setMessages([WELCOME_MESSAGE]);
    safeStorage.removeItem(VA_HISTORY_KEY);
    safeStorage.removeItem(VA_SESSION_ID_KEY);
    setCurrentSessionId(null);
  };

  // #938: fala a resposta do agente. Tenta a voz premium (TTS MiniMax, voz configurada
  // pelo admin); sem saldo/erro cai na voz do navegador (speechSynthesis, offline).
  const stopSpeaking = () => {
    if (ttsAudioRef.current) { ttsAudioRef.current.pause(); ttsAudioRef.current = null; }
    try { window.speechSynthesis?.cancel(); } catch { /* noop */ }
    setSpeakingIdx(null);
  };

  const speakMessage = async (idx: number, rawText: string) => {
    if (speakingIdx === idx) { stopSpeaking(); return; }
    stopSpeaking();
    // limpa markdown/links p/ soar natural
    const text = rawText
      .replace(/```[\s\S]*?```/g, ' código omitido. ')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/[#*_`>|]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 4000);
    if (!text) return;
    setSpeakingIdx(idx);
    try {
      const url = await AiService.tts(text);
      const audio = new Audio(url);
      ttsAudioRef.current = audio;
      audio.onended = () => setSpeakingIdx((cur) => (cur === idx ? null : cur));
      audio.onerror = () => setSpeakingIdx((cur) => (cur === idx ? null : cur));
      await audio.play();
    } catch {
      // fallback: voz do navegador (grátis/offline) — cobre saldo MiniMax esgotado
      try {
        const utter = new SpeechSynthesisUtterance(text);
        utter.lang = 'pt-BR';
        const ptVoice = window.speechSynthesis.getVoices().find(v => v.lang?.toLowerCase().startsWith('pt'));
        if (ptVoice) utter.voice = ptVoice;
        utter.onend = () => setSpeakingIdx((cur) => (cur === idx ? null : cur));
        utter.onerror = () => setSpeakingIdx((cur) => (cur === idx ? null : cur));
        window.speechSynthesis.speak(utter);
      } catch {
        setSpeakingIdx(null);
      }
    }
  };

  // #947: aceita 1+ imagens (input multiple), converte/comprime cada uma (HEIC incluso).
  const MAX_IMAGES = 6;
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = ''; // permite re-selecionar o mesmo arquivo depois
    if (!files.length) return;

    const room = MAX_IMAGES - attachedImages.length;
    if (room <= 0) { toast.info(`Máximo de ${MAX_IMAGES} imagens por mensagem.`); return; }
    const toProcess = files.slice(0, room);

    setImageProcessing(true);
    try {
      const results = await Promise.all(toProcess.map(processImageFile));
      const ok = results.filter((r): r is { data: string; mimeType: string; preview: string } => !!r);
      if (ok.length) setAttachedImages(prev => [...prev, ...ok]);
      const failed = results.length - ok.length;
      if (failed) toast.error(`${failed} imagem(ns) não pôde(ram) ser lida(s) — formato não suportado.`);
      if (files.length > room) toast.info(`Adicionei ${room} imagem(ns) (limite de ${MAX_IMAGES}).`);
    } finally {
      setImageProcessing(false);
    }
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

  // #1153: Garante uma ÚNICA sessão em criações concorrentes. Se já existe
  // (state), retorna imediatamente. Se há criação em andamento (ref), todas as
  // chamadas aguardam a mesma Promise — createChatSession() roda 1x só. Após
  // resolver, copia o sessionId para o state e limpa a ref.
  const ensureSessionId = (firstMessage?: string): Promise<string | null> => {
    if (currentSessionId) return Promise.resolve(currentSessionId);
    sessionCreationRef.current ??= (async () => {
      try {
        const session = await AiService.createChatSession(firstMessage);
        const sid = session?.id ?? null;
        if (sid) {
          setCurrentSessionId(sid);
          safeStorage.setItem(VA_SESSION_ID_KEY, sid);
        }
        return sid;
      } catch {
        return null;
      } finally {
        sessionCreationRef.current = null;
      }
    })();
    return sessionCreationRef.current;
  };

  // Sessão automática (#300): reúne o resumo do dia via agente e exibe como abertura.
  const handleBootstrap = async () => {
    // Config do admin (#300 item 3): se desligada, mantém a saudação estática.
    const cfg = (await getAgentBootstrapConfig()) || DEFAULT_BOOTSTRAP_CONFIG;
    if (!cfg.enabled) return;

    setIsLoading(true);
    setLastHeartbeat(Date.now());
    let bootstrapJobId: string | null = null;
    try {
      const sid = await ensureSessionId('Resumo inicial');
      const pageContext = formatViewContext(location.pathname, location.search || undefined);
      const result = await AiService.chatWithData(
        buildBootstrapPrompt(cfg), [], undefined, sid || undefined, pageContext,
        (jobId) => {
          bootstrapJobId = jobId;
          setActiveJobId(jobId);
        },
        (p: ChatJobProgress) => setLastHeartbeat(p.lastHeartbeat),
      );
      if (bootstrapJobId && cancelledJobsRef.current.has(bootstrapJobId)) return;
      if ((result as any)?.contextWindow) setContextWindow((result as any).contextWindow);
      if (result?.reply) {
        setMessages([{ role: 'model', text: result.reply, usage: (result as any).usage, model: (result as any).model, fellBack: (result as any).fellBack }]);
      }
    } catch {
      // Mantém a saudação estática em caso de erro (degradação graciosa).
    } finally {
      setIsLoading(false);
      if (bootstrapJobId) setActiveJobId(current => current === bootstrapJobId ? null : current);
      setLastHeartbeat(null);
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

  // textOverride: usado pela entrada de voz — a transcrição é ENVIADA direto (voice note),
  // sem passar pelo campo de texto (#945: antes a transcrição nunca chegava à LLM).
  const handleSend = async (textOverride?: string) => {
    const userMsg = textOverride ?? input;
    if ((!userMsg.trim() && !attachedImages.length && !attachedPdf) || isLoading) return;

    const userImages = attachedImages;
    const userPdf = attachedPdf;

    setInput('');
    setAttachedImages([]);
    setAttachedPdf(null);
    if (textareaRef.current) textareaRef.current.style.height = 'auto'; // volta a 1 linha

    setMessages(prev => [
      ...prev,
      {
        role: 'user',
        text: userMsg + (userPdf ? ` [PDF: ${userPdf.name}]` : ''),
        images: userImages.length ? userImages.map(im => im.preview) : undefined, // #947: mostra no bubble
      }
    ]);

    setIsLoading(true);
    setLastHeartbeat(Date.now());
    let sentJobId: string | null = null;

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

      const sid = await ensureSessionId(userMsg);

      const pageContext = `${formatViewContext(location.pathname, location.search || undefined)}\n${formatErrorsForAgent()}${pdfContext}`;

      const result = await AiService.chatWithData(
        userMsg, relevantHistory, userImages.map(im => im.data), sid || undefined, pageContext,
        // #953: persiste o jobId assim que enfileira → se recarregar a página, o effect de
        // montagem retoma o polling e a resposta não se perde.
        (jobId) => {
          sentJobId = jobId;
          setActiveJobId(jobId);
          safeStorage.setJSON(VA_PENDING_JOB_KEY, { jobId, at: Date.now() });
        },
        // #1013: atualiza o lastHeartbeat p/ o indicador "Processando... Xs".
        (p: ChatJobProgress) => setLastHeartbeat(p.lastHeartbeat),
      );
      if (sentJobId && cancelledJobsRef.current.has(sentJobId)) return;
      const responseText = result.reply;
      // #967: usa a janela recém-retornada pelo backend (evita closure stale do estado) p/ o cálculo.
      const effectiveWindow = (result as any).contextWindow || contextWindow;
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
          // #967: o uso real de contexto é o do ÚLTIMO turno (cada chamada envia a conversa
          // inteira); somar totalTokens de todas as mensagens inflacionava e gerava avisos falsos.
          const { pct } = getContextUsage(updated, effectiveWindow);
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
      if (!sentJobId || !cancelledJobsRef.current.has(sentJobId)) {
        setMessages(prev => [...prev, { role: 'model', text: "Desculpe, encontrei um erro ao processar sua solicitação.", isError: true }]);
      }
    } finally {
      setIsLoading(false);
      if (sentJobId) setActiveJobId(current => current === sentJobId ? null : current);
      setLastHeartbeat(null);
      safeStorage.removeItem(VA_PENDING_JOB_KEY); // #953: job concluído (ou erro) → não retomar
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      // #947: antes o Enter era engolido em silêncio enquanto o agente respondia
      // (ex.: durante o resumo automático de abertura) — parecia que o chat ignorou.
      if (isLoading && (input.trim() || attachedImages.length || attachedPdf)) {
        toast.info('Aguarde o assistente concluir a resposta atual…');
        return;
      }
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
        if (blob.size < 1000) return; // gravação vazia/acidental (< ~0,1s): ignora em silêncio
        const reader = new FileReader();
        reader.onloadend = async () => {
          const base64 = (reader.result as string).split(',')[1];
          // #945: transcreve e ENVIA direto (voice note). Antes a transcrição ia pro
          // histórico + campo mas nunca era enviada — a LLM não respondia nada.
          setIsTranscribing(true);
          try {
            const transcription = await AiService.transcribeAudio(base64, 'audio/webm');
            // O backend sinaliza erro de ASR como texto "[...]" (indisponível/sem saldo/etc.)
            // — não é fala do usuário; avisa em vez de mandar pro agente.
            const isAsrError = !transcription || /^\[.*\]$/.test(transcription.trim());
            if (isAsrError) {
              setMessages(prev => [...prev, { role: 'model', text: `🎤 Não consegui transcrever o áudio. ${transcription || ''}`.trim(), isError: true }]);
              return;
            }
            setIsTranscribing(false);
            await handleSend(transcription);
          } catch {
            setMessages(prev => [...prev, { role: 'model', text: '🎤 Erro na transcrição do áudio. Tente novamente.', isError: true }]);
          } finally {
            setIsTranscribing(false);
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
                // #967: uso real = último turno (soma de todas inflacionava o percentual).
                const { total, pct } = getContextUsage(messages, contextWindow);
                const roundedPct = Math.min(100, Math.round(pct));
                const barColor = roundedPct > 90 ? 'bg-red-400' : roundedPct > 70 ? 'bg-yellow-400' : 'bg-emerald-400';
                return total > 0 ? (
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] text-white/70" title={`${total.toLocaleString()} / ${contextWindow.toLocaleString()} tokens`}>
                      {total.toLocaleString()} ({roundedPct}%)
                    </span>
                    <div className="w-12 h-1.5 bg-white/20 rounded-full overflow-hidden">
                      <div className={`h-full ${barColor} rounded-full transition-all`} style={{ width: `${roundedPct}%` }} />
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
                    {msg.images && msg.images.length > 0 && (
                      <div className={`flex flex-wrap gap-1 mb-2 ${msg.images.length === 1 ? '' : 'max-w-[240px]'}`}>
                        {msg.images.map((src, i) => (
                          <img
                            key={i}
                            src={src}
                            alt={`Imagem ${i + 1}`}
                            className={`rounded-lg border border-white/20 object-cover ${msg.images!.length === 1 ? 'max-w-full max-h-48' : 'h-24 w-24'}`}
                          />
                        ))}
                      </div>
                    )}
                    {msg.role === 'model' ? <AgentMarkdown text={msg.text} navigate={navigate} /> : msg.text}
                    {msg.role === 'model' && !msg.isError && msg.text && (
                      <div className="flex items-center gap-2 mt-1 pt-1 border-t border-slate-100 dark:border-slate-700/50 flex-wrap">
                        <button
                          onClick={() => speakMessage(idx, msg.text)}
                          className={`p-1 rounded transition-colors ${speakingIdx === idx ? 'text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-900/30' : 'text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400'}`}
                          title={speakingIdx === idx ? 'Parar' : 'Ouvir resposta'}
                          aria-label={speakingIdx === idx ? 'Parar leitura' : 'Ouvir resposta'}
                        >
                          {speakingIdx === idx ? <Square size={12} /> : <Volume2 size={13} />}
                        </button>
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
                    {lastHeartbeat && (
                      <div className="text-[10px] text-slate-400 dark:text-slate-500 mt-1" aria-live="polite">
                        Processando… ({Math.max(0, Math.round((nowTick - lastHeartbeat) / 1000))}s desde último update)
                      </div>
                    )}
                    <ChatMessages activeJobId={activeJobId} onCancelled={handleJobCancelled} />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Image Preview(s) — #947: miniaturas de todas as imagens anexadas */}
          {(attachedImages.length > 0 || imageProcessing) && (
            <div className="p-2 bg-slate-100 dark:bg-slate-800 border-t border-slate-200 dark:border-slate-700 flex items-center gap-2 flex-wrap">
              {attachedImages.map((im, i) => (
                <div key={i} className="relative">
                  <img src={im.preview} alt={`Anexo ${i + 1}`} className="h-16 w-16 object-cover rounded-lg border border-slate-300 dark:border-slate-600" />
                  <button
                    onClick={() => setAttachedImages(prev => prev.filter((_, j) => j !== i))}
                    className="absolute -top-1.5 -right-1.5 bg-slate-700 text-white rounded-full p-0.5 hover:bg-red-600 shadow"
                    title="Remover imagem"
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
              {imageProcessing && (
                <div className="h-16 w-16 flex items-center justify-center rounded-lg border border-dashed border-slate-300 dark:border-slate-600">
                  <Loader2 size={18} className="animate-spin text-indigo-500" />
                </div>
              )}
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
                  disabled={isTranscribing || isLoading}
                  className={`p-2 rounded-full transition-all disabled:opacity-50 ${isListening ? 'bg-red-500 text-white animate-pulse ring-2 ring-red-300' : 'hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400'}`}
                  title={isTranscribing ? 'Transcrevendo…' : isListening ? 'Gravando — toque para enviar' : 'Mensagem de voz (fala vira texto e é enviada)'}
                >
                  {isTranscribing ? <Loader2 size={20} className="animate-spin text-indigo-500" /> : <Mic size={20} />}
                </button>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className={`p-2 rounded-full transition-all hover:bg-slate-100 dark:hover:bg-slate-800 ${attachedImages.length ? 'text-indigo-600' : 'text-slate-400'}`}
                  title="Anexar imagem(ns)"
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
                  accept="image/*,.heic,.heif"
                  multiple
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
                  ref={textareaRef}
                  value={input}
                  onChange={(e) => {
                    setInput(e.target.value);
                    // auto-resize: cresce com o conteúdo até ~5 linhas (o max-h-28 limita)
                    const el = e.target;
                    el.style.height = 'auto';
                    el.style.height = `${Math.min(el.scrollHeight, 112)}px`;
                  }}
                  onKeyDown={handleKeyPress}
                  placeholder={isTranscribing ? 'Transcrevendo o áudio…' : isListening ? 'Gravando… toque no microfone para enviar' : 'Pergunte ao Assistente…'}
                  disabled={isTranscribing}
                  rows={1}
                  className="w-full bg-transparent border-none outline-none text-sm resize-none max-h-28 text-slate-800 dark:text-slate-200 placeholder:text-slate-400 disabled:opacity-60"
                  style={{ minHeight: '24px' }}
                />
              </div>

              <button
                onClick={() => handleSend()}
                disabled={isLoading || imageProcessing || (!input.trim() && !attachedImages.length && !attachedPdf)}
                title={isLoading ? 'Aguardando a resposta…' : 'Enviar'}
                className="p-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
              >
                {isLoading ? <Loader2 size={20} className="animate-spin" /> : <Send size={20} />}
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
