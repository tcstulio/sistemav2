import axios from 'axios';
import { toast } from 'sonner';
import { ThirdParty, Invoice, Project, Ticket } from '../types';
import { logger } from '../utils/logger';
import { safeStorage } from '../utils/safeStorage';

const log = logger.child('AiService');

const handleAiError = (context: string, error: any): void => {
    const msg = error.response?.data?.error || error.message || 'Erro desconhecido';
    log.error(`${context}: ${msg}`);
    toast.error(`IA indisponível: ${context}`);
};

// Utility to get headers with Auth
const getAuthHeaders = () => {
    const savedConfigObj = safeStorage.getJSON<Record<string, any>>('coolgroove_config', {});
    const token = savedConfigObj.apiKey || '';
    return {
        headers: {
            'Authorization': 'Bearer ' + token
        }
    };
};

export interface ChatMessage {
    role: 'user' | 'model' | 'system';
    text: string;
    isError?: boolean;
    /** Previews (dataURL) das imagens anexadas — só em memória, p/ exibir no bubble (#947). */
    images?: string[];
    usage?: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
    };
    /** Modelo que efetivamente respondeu (ex.: "glm-5.2", "MiniMax-M3"). */
    model?: string;
    /** true quando o fallback automático foi acionado (GLM→MiniMax). */
    fellBack?: boolean;
}

export interface ChatSessionInfo {
    id: string;
    userId: string;
    title: string;
    messageCount: number;
    lastPreview: string;
    createdAt: number;
    updatedAt: number;
}

// Snapshot da última análise financeira persistida (issue #492 / #490).
// Espelha o shape retornado por GET /api/ai/analyze/financial-analysis/latest.
export interface LatestFinancialAnalysis {
    data: unknown; // Payload da análise IA (geralmente markdown em string)
    lastRunAt: string; // ISO timestamp da última execução
    status: 'success' | 'error';
    error?: string;
}

// Agenda da automação de Análise Financeira IA (#497).
// Espelha o shape de PUT/GET /api/ai/analyze/financial-analysis/automation-config.
export interface FinancialAnalysisAutomationSchedule {
    dayOfWeek: number; // 0 = Domingo, 6 = Sábado
    hour: number; // 0-23
    minute: number; // 0-59
}

export interface FinancialAnalysisAutomationConfig {
    enabled: boolean;
    schedule: FinancialAnalysisAutomationSchedule;
    lastRunAt: string | null; // ISO timestamp ou null
    lastRunStatus: 'success' | 'error' | null;
}

const API_URL = '/api/ai';
const AI_JOBS_URL = '/api/ai-jobs'; // #1011: endpoint de heartbeat leve (:id/status)

// #1013: o cliente estende o polling enquanto o backend sinaliza que o job está vivo,
// em vez de cortar no teto fixo de 20min (que matava jobs longos >20min mesmo com o
// agente ainda trabalhando). Cada sinal "alive" alonga o prazo; um teto absoluto de 40min
// (2x o teto original) evita loop infinito.
const POLL_MS = 2500;
const POLL_BASE_WAIT_MS = 20 * 60 * 1000;   // prazo inicial (igual ao comportamento original)
const POLL_EXTENSION_MS = 10 * 60 * 1000;   // +10min a cada sinal de "alive"
const POLL_ABSOLUTE_CAP_MS = 40 * 60 * 1000; // salvaguarda final (2x o teto original)
const MAX_CONSECUTIVE_5XX = 5;               // 5xx repetido = servidor caído → timeout

/** #1013: progresso do polling reportado à UI (indicador "Processando... Xs"). */
export interface ChatJobProgress {
    /** epoch ms do último sinal de vida conhecido (do heartbeat ou do próprio poll). */
    lastHeartbeat: number;
    /** progresso 0..100 reportado pelo agente, quando disponível. */
    progressPct?: number;
}

/**
 * #1577: erro tipado lançado pelo pollChatJob quando o job foi cancelado pelo usuário
 * (GET /jobs/:id devolve { status: 'cancelled', alive: false, partialSummary }). Distinto
 * de um erro genérico para que o chamador (ChatMessages) saiba tratar silenciosamente:
 * o handler do socket 'chat:job:cancelled' já exibiu o resumo na UI — réplicas do
 * pollChatJob via polling só precisam encerrar o ciclo "isSending" sem mostrar "Erro:".
 */
export class ChatJobCancelledError extends Error {
    /** Resumo parcial devolvido pelo backend (texto acumulado até o cancelamento). */
    public readonly partialSummary: string | null;

    constructor(partialSummary: string | null) {
        super('Job cancelado pelo usuário.');
        this.name = 'ChatJobCancelledError';
        this.partialSummary = partialSummary;
        // Mantém o stack trace em V8/Node (em jsdom é no-op seguro).
        const ErrorCtor = Error as unknown as {
            captureStackTrace?: (target: object, ctor: unknown) => void;
        };
        if (typeof ErrorCtor.captureStackTrace === 'function') {
            ErrorCtor.captureStackTrace(this, ChatJobCancelledError);
        }
    }
}

// #1011/#1013: consulta o heartbeat leve do job (GET /api/ai-jobs/:id/status). Retorna
// { alive, lastHeartbeatMs, progressPct } ou { alive: false } se indisponível/expirado.
// Usado quando o endpoint principal do job devolve 404 (job evictado da memória sob
// pressão / 429): se o backend ainda reporta o job como vivo, NÃO declaramos timeout.
async function checkJobHeartbeat(jobId: string): Promise<{ alive: boolean; lastHeartbeatMs?: number; progressPct?: number }> {
    try {
        const st = await axios.get(`${AI_JOBS_URL}/${jobId}/status`, getAuthHeaders());
        const data: any = st.data;
        if (data?.alive) {
            const hbMs = data.lastHeartbeat ? new Date(data.lastHeartbeat).getTime() : Date.now();
            return { alive: true, lastHeartbeatMs: hbMs, progressPct: data.progressPct };
        }
        return { alive: false };
    } catch {
        // 404 { reason: 'not_found'|'expired' } ou erro de rede → job não está vivo.
        return { alive: false };
    }
}

// #953/#1013: faz polling de um job de chat até done/error. Extraído p/ que a resposta seja
// RECUPERÁVEL após um F5 (o backend guarda o resultado ~30min): o componente persiste o
// jobId ao enfileirar e chama resumeChatJob(jobId) ao remontar, evitando perder a resposta.
//
// Estratégia de timeout (#1013): o prazo começa em 20min (como antes). Cada sinal "alive"
// — seja do endpoint principal (status running/queued com alive:true) ou do heartbeat
// /status quando o job deu 404 — alonga o prazo em +10min, até o teto absoluto de 40min.
// Assim um job que roda 25min com o backend saudável NÃO é cortado; só declaramos timeout
// quando o backend para de reportar vida (alive:false / 404 no heartbeat / 5xx repetido)
// ou ao atingir o teto absoluto. `onProgress` notifica a UI do lastHeartbeat p/ o indicador.
async function pollChatJob(jobId: string, onProgress?: (p: ChatJobProgress) => void): Promise<any> {
    const startedAt = Date.now();
    const absoluteDeadline = startedAt + POLL_ABSOLUTE_CAP_MS;
    let deadline = startedAt + POLL_BASE_WAIT_MS; // prazo macio (alongado por sinais "alive")
    let lastHeartbeat = startedAt;
    let consecutive5xx = 0;

    while (Date.now() < Math.min(deadline, absoluteDeadline)) {
        await new Promise((r) => setTimeout(r, POLL_MS));
        let job: any;
        try {
            const st = await axios.get(`${API_URL}/jobs/${jobId}`, getAuthHeaders());
            job = st.data;
            consecutive5xx = 0;
        } catch (pollErr: any) {
            const status = pollErr?.response?.status;
            // #1013: job sumiu do endpoint principal — checa liveness via heartbeat /status.
            if (status === 404) {
                const hb = await checkJobHeartbeat(jobId);
                if (hb.alive) {
                    // Backend ainda processa: NÃO declara timeout — alonga prazo e segue.
                    lastHeartbeat = hb.lastHeartbeatMs ?? Date.now();
                    deadline = Math.min(deadline + POLL_EXTENSION_MS, absoluteDeadline);
                    onProgress?.({ lastHeartbeat, progressPct: hb.progressPct });
                    continue;
                }
                throw new Error('O processamento foi interrompido (job expirado). Tente novamente.');
            }
            // #1013: 5xx repetido = servidor indisponível → timeout (não fica em loop eterno).
            if (status && status >= 500) {
                if (++consecutive5xx >= MAX_CONSECUTIVE_5XX) {
                    throw new Error('Tempo limite do assistente excedido (servidor indisponível).');
                }
                continue; // transitório — tenta de novo no próximo ciclo
            }
            throw pollErr;
        }
        if (job.status === 'done') {
            return { reply: job.reply, sessionId: job.sessionId, usage: job.usage, contextWindow: job.contextWindow, model: job.model, fellBack: job.fellBack };
        }
        if (job.status === 'error') {
            throw new Error(job.error || 'O assistente falhou ao processar.');
        }
        // #1577: job cancelado pelo usuário — encerra o polling imediatamente. O backend
        // devolve alive:false + partialSummary neste caso. Lançamos ChatJobCancelledError
        // (tipado) para o chamador distinguir cancelamento de falha real e suprimir o
        // bubble de "Erro:" — a UI de cancelamento já foi renderizada pelo handler do
        // socket 'chat:job:cancelled' (ou será renderizada por quem capturar este erro).
        if (job.status === 'cancelled') {
            throw new ChatJobCancelledError(job.partialSummary ?? null);
        }
        // queued/running → job vivo: alonga o prazo (cap 40min) e notifica a UI.
        if (job.alive) {
            lastHeartbeat = Date.now();
            deadline = Math.min(deadline + POLL_EXTENSION_MS, absoluteDeadline);
        }
        onProgress?.({ lastHeartbeat, progressPct: job.progressPct });
    }
    throw new Error('Tempo limite do assistente excedido (40 min).');
}

export const AiService = {

    // Resolve um deeplink de prefill gerado pelo agente (#57 Peça 2/3): troca o token assinado
    // pelos dados (verificados via HMAC no backend). Genérico: devolve { kind, data } —
    // kind = create_ticket | create_customer | edit_customer | ... e data = campos a pré-preencher.
    resolvePrefill: async (token: string): Promise<{ kind: string; data: Record<string, any> } | null> => {
        try {
            const response = await axios.get(`${API_URL}/prefill`, { params: { token }, ...getAuthHeaders() });
            const d = response.data;
            if (!d?.data) return null;
            return { kind: d.kind || 'unknown', data: d.data };
        } catch (error: any) {
            // #1521 — surfa a mensagem REAL do backend (ex.: "Link inválido ou expirado. Peça ao agente
            // para gerar um novo.") em vez do genérico "IA indisponível". O 404-de-link-antigo já é
            // tratado pelo redirect de rota; aqui cobrimos o token expirado/inválido numa rota válida.
            const msg = error?.response?.data?.error || 'Não foi possível abrir este link. Peça um novo ao agente.';
            log.error(`Resolver rascunho: ${msg}`);
            toast.error(msg);
            return null;
        }
    },

    generateTicketReply: async (ticketSubject: string, ticketMessage: string, history: string[]) => {
        try {
            const response = await axios.post(`${API_URL}/generate-reply`, {
                context: `Assunto: ${ticketSubject}. Msg Inicial: ${ticketMessage}`,
                history: history.map(h => ({ role: 'user', parts: h })),
                module: 'chat'
            }, getAuthHeaders());
            return response.data.reply;
        } catch (error: any) {
            handleAiError('Resposta de ticket', error);
            return null;
        }
    },

    generateProjectTasks: async (projectContext: string) => {
        try {
            const prompt = `
                Generate a list of project tasks based on this context: "${projectContext}".
                Return ONLY a JSON array of objects with these properties:
                - label (string, max 50 chars)
                - description (string, concise)
                - planned_workload (number, in hours)
                Example: [{"label": "Design DB", "description": "Schema design", "planned_workload": 4}]
            `;
            const response = await axios.post(`${API_URL}/generate-reply`, {
                history: [{ role: 'user', parts: prompt }],
                context: "You are a project manager. Output JSON only.",
                module: 'proposals'
            }, getAuthHeaders());

            // The backend returns a string. We attempt to parse it if the model wrapped it in code blocks or just text.
            let reply = response.data.reply;
            // Basic cleanup if md blocks are present
            reply = reply.replace(/```json/g, '').replace(/```/g, '').trim();
            return JSON.parse(reply);
        } catch (error: any) {
            handleAiError('Geração de tarefas', error);
            return [];
        }
    },

    extractProjectInfo: async (text: string) => {
        try {
            const response = await axios.post(`${API_URL}/extract/customer`, { text }, getAuthHeaders());
            return response.data.result;
        } catch (error: any) {
            handleAiError('Extração de projeto', error);
            return null;
        }
    },

    analyzeFinancialHealth: async (data: any) => {
        try {
            const response = await axios.post(`${API_URL}/analyze/financial`, { data }, getAuthHeaders());
            return response.data.result;
        } catch (error: any) {
            handleAiError('Análise financeira', error);
            return "Erro ao processar análise.";
        }
    },

    // Recupera a última análise financeira persistida (org-wide). Retorna null
    // quando ainda não há análise salva. Usado pelo dashboard para exibir o
    // resultado automaticamente, sem exigir clique manual (#492).
    getLatestFinancialAnalysis: async (): Promise<LatestFinancialAnalysis | null> => {
        try {
            const response = await axios.get(`${API_URL}/analyze/financial-analysis/latest`, getAuthHeaders());
            return (response.data as LatestFinancialAnalysis | null) ?? null;
        } catch (error: any) {
            handleAiError('Última análise financeira', error);
            return null;
        }
    },

    // Lê a config da automação de Análise Financeira IA (#497).
    // Não dispara toast aqui: o chamador decide a mensagem (#677). Retorna null em caso de erro.
    getFinancialAnalysisAutomationConfig: async (): Promise<FinancialAnalysisAutomationConfig | null> => {
        try {
            const response = await axios.get(`${API_URL}/analyze/financial-analysis/automation-config`, getAuthHeaders());
            return response.data as FinancialAnalysisAutomationConfig;
        } catch (error: any) {
            log.error('Config de automação financeira', error);
            return null;
        }
    },

    // Atualiza (parcial) a config da automação de Análise Financeira IA (#497).
    // Não dispara toast aqui: o chamador decide a mensagem (#677). Retorna a config mergeada ou null em caso de erro.
    updateFinancialAnalysisAutomationConfig: async (
        patch: Partial<FinancialAnalysisAutomationConfig>
    ): Promise<FinancialAnalysisAutomationConfig | null> => {
        try {
            const response = await axios.put(`${API_URL}/analyze/financial-analysis/automation-config`, patch, getAuthHeaders());
            return response.data as FinancialAnalysisAutomationConfig;
        } catch (error: any) {
            log.error('Salvar config de automação financeira', error);
            return null;
        }
    },

    logCorrection: async (logId: string, correction: string) => {
        log.debug('Correction logged', { logId, correction });
    },

    draftCollectionEmail: async (customer: ThirdParty, totalDue: number) => {
        try {
            const response = await axios.post(`${API_URL}/draft/collection-email`, {
                customer: { name: customer.name, email: customer.email, id: customer.id },
                amount: totalDue
            }, getAuthHeaders());
            return response.data.result;
        } catch (error: any) {
            handleAiError('Email de cobrança', error);
            return JSON.stringify({ subject: "Lembrete de Pagamento", body: "Erro ao gerar email." });
        }
    },

    generateSalesForecast: async (invoices: Invoice[]) => {
        try {
            // Intelligent Data Selection for Seasonality
            const now = new Date();
            log.debug(`Reference Date (Front) = ${now.toString()}`);
            log.debug('Context sent to AI', { referenceDate: now.toISOString() });

            const currentYear = now.getFullYear();
            const currentMonth = now.getMonth(); // 0-11

            // 1. Identify Target Forecast Window (Next 3 Months)
            // 1. Identify Target Forecast Window (Current Month + Next 2 Months)
            const targetMonths = [
                currentMonth,
                (currentMonth + 1) % 12,
                (currentMonth + 2) % 12
            ];

            // 2. Filter Invoices
            const relevantInvoices = invoices.filter(inv => {
                const dateVal = inv.date || (inv as any).datec || 0;
                const timestamp = typeof dateVal === 'string' ? new Date(dateVal).getTime() : (dateVal < 10000000000 ? dateVal * 1000 : dateVal);
                const invDate = new Date(timestamp);
                const invMonth = invDate.getMonth();
                const invYear = invDate.getFullYear();

                // A. Recent Trend: Last 6 months
                const monthsDiff = (currentYear * 12 + currentMonth) - (invYear * 12 + invMonth);
                if (monthsDiff >= 0 && monthsDiff <= 6) return true;

                // B. Seasonality: Same target months in previous years
                if (invYear < currentYear && targetMonths.includes(invMonth)) return true;

                return false;
            });

            // Sort by date asc
            relevantInvoices.sort((a, b) => {
                const dA = typeof a.date === 'string' ? new Date(a.date).getTime() : a.date;
                const dB = typeof b.date === 'string' ? new Date(b.date).getTime() : b.date;
                return dA - dB;
            });

            // #915: agrega as faturas relevantes em série mensal {period,revenue,count} ANTES de
            // enviar. Conta real: 303 faturas cruas = 116-166s (estoura o timeout de 120s); a série
            // (~13 pontos) traz a geração de volta pra ~28s. Reduz payload E o prompt do LLM.
            const monthMap = new Map<string, { revenue: number; count: number }>();
            for (const inv of relevantInvoices) {
                const dv = inv.date || (inv as any).datec || 0;
                const ts = typeof dv === 'string' ? new Date(dv).getTime() : (dv < 10000000000 ? dv * 1000 : dv);
                const d = new Date(ts);
                if (isNaN(d.getTime())) continue;
                const period = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
                const cur = monthMap.get(period) || { revenue: 0, count: 0 };
                cur.revenue += Number(inv.total_ttc) || 0;
                cur.count += 1;
                monthMap.set(period, cur);
            }
            const timeSeries = Array.from(monthMap.entries())
                .map(([period, v]) => ({ period, revenue: Math.round(v.revenue * 100) / 100, count: v.count }))
                .sort((a, b) => a.period.localeCompare(b.period));

            // Furo do guard (#908): o guard do Dashboard só vê invoices.length; se o FILTRO de janela
            // (últimos 6m + sazonalidade) zerou tudo (conta só com faturas antigas), curto-circuita
            // aqui com mensagem clara — sem bater no LLM.
            if (timeSeries.length === 0) {
                return JSON.stringify({ forecast: [], summary: 'Não há faturas nos últimos 6 meses (nem sazonais em anos anteriores) para gerar a previsão.' });
            }

            log.info('Sales forecast: série mensal enviada à IA', { relevant: relevantInvoices.length, months: timeSeries.length });

            // #908: forecast ASSÍNCRONO (job + polling), como o chat. Enfileira e faz polling — não
            // segura a conexão, então a variância do GLM (60-90s típico, cauda >120s) NUNCA estoura
            // timeout de cliente/túnel (524). O job roda em background até concluir.
            const start = await axios.post(`${API_URL}/analyze/sales-forecast-async`, {
                invoices: [], // payload agregado em context.timeSeries
                context: {
                    referenceDate: now.toISOString(),
                    targetMonths: targetMonths,
                    timeSeries
                }
            }, { ...getAuthHeaders(), timeout: 30000 });

            const jobId = start.data?.jobId;
            if (!jobId) throw new Error('Falha ao enfileirar a previsão de vendas.');

            const POLL_MS = 2500;
            const MAX_WAIT_MS = 5 * 60 * 1000; // generoso; o job conclui em background
            const startedAt = Date.now();
            while (Date.now() - startedAt < MAX_WAIT_MS) {
                await new Promise((r) => setTimeout(r, POLL_MS));
                let job: any;
                try {
                    const st = await axios.get(`${API_URL}/jobs/${jobId}`, { ...getAuthHeaders(), timeout: 30000 });
                    job = st.data;
                } catch (pollErr: any) {
                    if (pollErr?.response?.status === 404) throw new Error('O processamento da previsão expirou. Tente novamente.');
                    throw pollErr;
                }
                if (job.status === 'done') return job.result; // string JSON do forecast
                if (job.status === 'error') throw new Error(job.error || 'Falha ao gerar a previsão.');
                // queued/running → segue o polling
            }
            throw new Error('Forecast timeout'); // >5min: o catch marca isTimeout p/ o Dashboard
        } catch (error: any) {
            handleAiError('Previsão de vendas', error);
            // #908: propaga o timeout de forma distinta p/ o Dashboard dar mensagem específica.
            if (error?.code === 'ECONNABORTED' || /timeout/i.test(String(error?.message))) {
                const timeoutErr: any = new Error('Forecast timeout');
                timeoutErr.isTimeout = true;
                throw timeoutErr;
            }
            return null;
        }
    },

    analyzeCustomerSentiment: async (customer: ThirdParty, invoices: Invoice[]) => {
        try {
            const response = await axios.post(`${API_URL}/analyze/customer-sentiment`, {
                customer: { name: customer.name, status: customer.status, date_creation: customer.date_creation, id: customer.id },
                invoices: invoices.slice(0, 20).map(i => ({
                    ref: i.ref,
                    total_ttc: i.total_ttc,
                    status: i.statut,
                    date: i.date
                }))
            }, getAuthHeaders());
            // Return in the format expected by the component
            return { text: response.data.result, logId: Date.now().toString() };
        } catch (error: any) {
            handleAiError('Análise de sentimento', error);
            return null;
        }
    },

    extractReceiptData: async (base64: string) => {
        try {
            const response = await axios.post(`${API_URL}/extract/receipt`, { image: base64 }, getAuthHeaders());
            return response.data.result;
        } catch (error: any) {
            handleAiError('Extração de recibo', error);
            return null;
        }
    },

    auditProposal: async (proposal: any) => {
        try {
            const response = await axios.post(`${API_URL}/audit/proposal`, { proposal }, getAuthHeaders());
            return response.data.result;
        } catch (error: any) {
            handleAiError('Auditoria de proposta', error);
            return null;
        }
    },

    auditProject: async (project: Project, tasks: any[], invoices: any[]) => {
        try {
            const response = await axios.post(`${API_URL}/audit/project`, {
                project: { title: project.title, ref: project.ref, status: project.statut },
                tasks: tasks.slice(0, 20),
                invoices: invoices.slice(0, 10)
            }, getAuthHeaders());
            return response.data.result;
        } catch (error: any) {
            handleAiError('Auditoria de projeto', error);
            return null;
        }
    },

    // --- Voz do agente (TTS MiniMax) — #938 ---

    /** Texto → URL de áudio (mp3). Lança com status 402 quando sem saldo (front usa fallback do navegador). */
    tts: async (text: string, voiceId?: string): Promise<string> => {
        const response = await axios.post(`${API_URL}/voice/tts`, { text, ...(voiceId ? { voiceId } : {}) }, { ...getAuthHeaders(), timeout: 120000 });
        return response.data.url;
    },

    listVoices: async (): Promise<{ voiceId: string; name: string }[]> => {
        try {
            const response = await axios.get(`${API_URL}/voice/voices`, getAuthHeaders());
            return response.data.voices || [];
        } catch (error: any) {
            log.error('listVoices', error);
            return [];
        }
    },

    getVoiceConfig: async (): Promise<{ voiceId: string; speed: number } | null> => {
        try {
            const response = await axios.get(`${API_URL}/voice/config`, getAuthHeaders());
            return response.data;
        } catch (error: any) {
            log.error('getVoiceConfig', error);
            return null;
        }
    },

    updateVoiceConfig: async (patch: { voiceId?: string; speed?: number }): Promise<{ voiceId: string; speed: number } | null> => {
        try {
            const response = await axios.put(`${API_URL}/voice/config`, patch, getAuthHeaders());
            return response.data;
        } catch (error: any) {
            log.error('updateVoiceConfig', error);
            return null;
        }
    },

    // #947: userImages aceita 1+ imagens (base64 puro, sem prefixo data URL).
    // #953: onJobStarted recebe o jobId assim que enfileirado (p/ persistir e retomar após F5).
    // #1013: onProgress recebe o lastHeartbeat do polling p/ o indicador "Processando... Xs".
    chatWithData: async (msg: string, history: ChatMessage[], userImages?: string | string[], sessionId?: string, pageContext?: string, onJobStarted?: (jobId: string) => void, onProgress?: (p: ChatJobProgress) => void) => {
        try {
            const now = new Date();
            const dateStr = now.toLocaleDateString('pt-BR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
            const timeStr = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

            let dataContext = `[SISTEMA] Data atual: ${dateStr}. Hora: ${timeStr}. Use ferramentas para buscar dados específicos.`;
            if (pageContext) dataContext += '\n' + pageContext;

            // issue #1151: o servidor agora é a fonte autoritativa do histórico (lê da
            // sessão via chatSessionService.getMessages). O cliente envia apenas
            // { sessionId, message } — NÃO envia mais `history`. O `history` local só
            // continua existindo como estado de UI; o backend o ignora no contexto do LLM.
            const images = Array.isArray(userImages) ? userImages : (userImages ? [userImages] : []);
            const start = await axios.post(`${API_URL}/generate-reply-async`, {
                message: msg,
                context: dataContext,
                image: images[0],          // compat: 1ª imagem no campo antigo
                images: images.length ? images : undefined,
                module: 'chat',
                sessionId
            }, getAuthHeaders());

            const jobId = start.data?.jobId;
            if (!jobId) throw new Error('Falha ao enfileirar o job do assistente.');
            onJobStarted?.(jobId); // #953: componente persiste o jobId p/ retomar após F5

            return await pollChatJob(jobId, onProgress);

        } catch (error: any) {
            handleAiError('Chat', error);
            return { reply: "Erro de conexão com o Assistente Virtual.", sessionId: null };
        }
    },

    // #953: retoma um job já enfileirado (após F5). Não trata o erro aqui — o chamador
    // decide (mostrar a resposta OU limpar o job pendente se expirou).
    // #1013: onProgress repassa o lastHeartbeat do polling p/ a UI.
    resumeChatJob: (jobId: string, onProgress?: (p: ChatJobProgress) => void) => pollChatJob(jobId, onProgress),

    createChatSession: async (firstMessage?: string): Promise<ChatSessionInfo | null> => {
        try {
            const response = await axios.post(`${API_URL}/sessions`, { firstMessage }, getAuthHeaders());
            return response.data.data;
        } catch (error: any) {
            handleAiError('Criar sessão', error);
            return null;
        }
    },

    getChatSessions: async (limit?: number): Promise<ChatSessionInfo[]> => {
        try {
            const params = limit ? { limit: String(limit) } : {};
            const response = await axios.get(`${API_URL}/sessions`, { params, ...getAuthHeaders() });
            return response.data.data || [];
        } catch (error: any) {
            handleAiError('Listar sessões', error);
            return [];
        }
    },

    getChatSession: async (id: string): Promise<{ userId: string; messages: any[] } | null> => {
        try {
            const response = await axios.get(`${API_URL}/sessions/${id}`, getAuthHeaders());
            const session = response.data.data;
            if (!session) return null;
            return { userId: session.userId || '', messages: session.messages || [] };
        } catch (error: any) {
            handleAiError('Carregar sessão', error);
            return null;
        }
    },

    deleteChatSession: async (id: string): Promise<boolean> => {
        try {
            await axios.delete(`${API_URL}/sessions/${id}`, getAuthHeaders());
            return true;
        } catch (error: any) {
            handleAiError('Deletar sessão', error);
            return false;
        }
    },

    deleteAllChatSessions: async (): Promise<number> => {
        try {
            const response = await axios.delete(`${API_URL}/sessions`, getAuthHeaders());
            return response.data.deletedCount || 0;
        } catch (error: any) {
            handleAiError('Deletar todas as sessões', error);
            return 0;
        }
    },

    analyzeSystemLogs: async (logs: any[]) => {
        try {
            // #951: defesa no consumidor — logs ANTIGOS (pré-fix) podem ter base64 no
            // request_body/output. Corta qualquer string longa antes de mandar à LLM,
            // pra não explodir o contexto (a fonte já é sanitizada em core.ts).
            const capStr = (v: any) => (typeof v === 'string' && v.length > 1000) ? `[omitido: ${v.length} chars]` : v;
            const safeLogs = logs.slice(0, 50).map((l) => {
                if (!l || typeof l !== 'object') return l;
                const o: Record<string, any> = {};
                for (const k in l) o[k] = capStr(l[k]);
                return o;
            });
            const response = await axios.post(`${API_URL}/analyze/logs`, {
                logs: safeLogs
            }, getAuthHeaders());
            return response.data.result;
        } catch (error: any) {
            handleAiError('Análise de logs', error);
            return "[]";
        }
    },

    analyzeApiStructure: async (json: string) => {
        try {
            const response = await axios.post(`${API_URL}/analyze-system`, { query: `Analyze this API structure: ${json}` }, getAuthHeaders());
            return response.data.result;
        } catch (error: any) {
            handleAiError('Análise de API', error);
            return null;
        }
    },

    analyzeSystem: async (query: string) => {
        try {
            const response = await axios.post(`${API_URL}/analyze-system`, { query }, getAuthHeaders());
            return response.data.result;
        } catch (error: any) {
            log.error('System Analysis Error', error);
            return "Erro ao analisar sistema: " + (error.response?.data?.error || error.message);
        }
    },

    analyzeSentiment: async (text: string) => {
        try {
            const response = await axios.post(`${API_URL}/analyze-sentiment`, { text }, getAuthHeaders());
            return response.data;
        } catch (error: any) {
            log.error('Sentiment Analysis Error', error);
            return { score: 50, label: "Error" };
        }
    },

    extractCustomerInfo: async (text: string) => {
        try {
            const response = await axios.post(`${API_URL}/extract/customer`, { text }, getAuthHeaders());
            return response.data.result;
        } catch (error: any) {
            log.error('Extraction Error', error);
            return null;
        }
    },

    fixApiCallWithDocs: async (failedLog: any, doc: string) => {
        try {
            const response = await axios.post(`${API_URL}/fix/api-call`, { log: failedLog }, getAuthHeaders());
            return response.data.result;
        } catch (error: any) {
            log.error('Fix API Error', error);
            return "Erro ao analisar log: " + (error.response?.data?.error || error.message);
        }
    },

    generateServiceCode: async (endpoint: string, method: string, description?: string) => {
        try {
            const response = await axios.post(`${API_URL}/generate/code`, { endpoint, method, description }, getAuthHeaders());
            return response.data.result;
        } catch (error: any) {
            return "Erro ao gerar código: " + (error.response?.data?.error || error.message);
        }
    },

    transcribeAudio: async (audioBase64: string, mimeType: string = 'audio/ogg') => {
        try {
            const response = await axios.post(`${API_URL}/transcribe-audio`, { audio: audioBase64, mimeType }, getAuthHeaders());
            return response.data.transcription;
        } catch (error: any) {
            log.error('Transcription Error', error);
            return "[Erro na transcrição]";
        }
    },

    analyzePdf: async (pdfBase64: string, question?: string) => {
        try {
            const response = await axios.post(`${API_URL}/analyze/pdf`, { pdf: pdfBase64, question }, getAuthHeaders());
            return response.data.result;
        } catch (error: any) {
            log.error('PDF Analysis Error', error);
            return "[Erro na análise do PDF]";
        }
    },

    analyzeDataQuality: async (data: any[], type: string) => {
        try {
            const response = await axios.post(`${API_URL}/analyze/data-quality`, {
                data,
                type
            }, getAuthHeaders());
            return response.data.result;
        } catch (error: any) {
            handleAiError('Qualidade de dados', error);
            return null;
        }
    },

    generateActivityReport: async (context: string) => {
        try {
            // Using the generate-reply endpoint as a generic text generator
            const response = await axios.post(`${API_URL}/generate-reply`, {
                history: [{ role: 'user', parts: `Generate a detailed activity report based on the following logs and context. summarize by project or main activity type. Focus on what was actually accomplished.\n\n${context}` }],
                context: "You are a project manager assistant generating a work report.",
                module: 'system_analysis'
            }, getAuthHeaders());
            return response.data.reply;
        } catch (error: any) {
            log.error('Activity Report Error', error);
            return "Erro ao gerar relatório. Verifique sua conexão ou tente novamente.";
        }
    },

    analyzeMonthlyReport: async (data: any) => {
        try {
            const response = await axios.post(`${API_URL}/analyze/monthly-report`, { data }, getAuthHeaders());
            return response.data.result;
        } catch (error: any) {
            log.error('Monthly Report Analysis Error', error);
            return "Erro ao gerar análise do relatório mensal.";
        }
    },

    draftMessage: async (customer: ThirdParty, context: string, channels: ('email' | 'whatsapp')[], additionalData?: any) => {
        try {
            let dataContext = "";
            if (additionalData) {
                dataContext = `
                RELEVANT DATA TO CITE:
                ${JSON.stringify(additionalData, null, 2)}
                
                INSTRUCTIONS FOR DATA:
                - You MUST mention specific details from the data above (e.g. invoice numbers, amounts, project names) if relevant to the '${context}'.
                - If the goal is collection, cite the overdue invoices.
                - If the goal is project update, cite the project status.
                `;
            }

            const prompt = `
                Generate a message for customer: ${customer.name} (${customer.email || 'no email'}).
                Context/Goal: ${context}.
                Required Formats: ${channels.join(', ')}.
                
                ${dataContext}
                
                Return ONLY a JSON object with this structure (fill only requested channels):
                {
                    "email": { "subject": "...", "body": "..." },
                    "whatsapp": { "text": "..." }
                }
            `;

            const response = await axios.post(`${API_URL}/generate-reply`, {
                history: [{ role: 'user', parts: prompt }],
                context: "You are a professional business assistant.",
                module: 'chat'
            }, getAuthHeaders());

            // The backend returns a string in 'reply'. We need to parse it if it's JSON.
            // But generate-reply returns text. We rely on the model obeying the JSON instruction.
            return response.data.reply;
        } catch (error: any) {
            handleAiError('Rascunho de mensagem', error);
            return null;
        }
    }
};

