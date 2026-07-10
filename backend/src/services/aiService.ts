import { GoogleGenAI } from "@google/genai";
import axios from 'axios';
import { dolibarrService } from './dolibarrService';
import { config } from '../config/env';
import fs from 'fs/promises';
import path from 'path';
import { ScraperService } from './scraperService';
import { logger } from '../utils/logger';
import { isValidExternalUrl } from '../utils/urlValidation';
import { TOOLS_PROMPT, executeTool } from './agentTools';
import { agentConfigService } from './agentConfigService';

const log = logger.child('AiService');

export function extractToolCall(text: string): { tool: string; args: any } | null {
    // Format 1: {"tool": "name", "args": {...}}  (our standard)
    const startMatch = text.search(/\{\s*"tool"\s*:/);
    if (startMatch !== -1) {
        let depth = 0;
        for (let i = startMatch; i < text.length; i++) {
            if (text[i] === '{') depth++;
            else if (text[i] === '}') depth--;
            if (depth === 0) {
                try { return JSON.parse(text.slice(startMatch, i + 1)); }
                catch { /* fall through */ }
                break;
            }
        }
    }

    // Format 2: <tool_call: {"name": "...", "arguments": {...}}>  (GLM-style)
    const glmMatch = text.match(/<tool_call:\s*(\{[\s\S]*?\})>/);
    if (glmMatch) {
        try {
            const parsed = JSON.parse(glmMatch[1]);
            if (parsed.name) {
                return { tool: parsed.name, args: parsed.arguments || parsed.args || {} };
            }
        } catch { /* fall through */ }
    }

    // Format 3: {"name": "...", "arguments": {...}}  (bare alternate)
    const altMatch = text.search(/\{\s*"name"\s*:\s*"(\w+)"/);
    if (altMatch !== -1) {
        let depth = 0;
        for (let i = altMatch; i < text.length; i++) {
            if (text[i] === '{') depth++;
            else if (text[i] === '}') depth--;
            if (depth === 0) {
                try {
                    const parsed = JSON.parse(text.slice(altMatch, i + 1));
                    if (parsed.name) {
                        return { tool: parsed.name, args: parsed.arguments || parsed.args || {} };
                    }
                } catch { /* fall through */ }
                break;
            }
        }
    }

    return null;
}

// #955: extrai TODAS as tool-calls de um texto (o MiniMax M3 emite várias de uma vez).
// Varre todos os objetos {"tool":...} / {"name":...} de nível superior e parseia cada um.
export function extractToolCalls(text: string, max = 16): { tool: string; args: any }[] {
    const calls: { tool: string; args: any }[] = [];
    if (!text) return calls;
    const re = /\{\s*"(?:tool|name)"\s*:/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) && calls.length < max) {
        const start = m.index;
        let depth = 0;
        for (let i = start; i < text.length; i++) {
            if (text[i] === '{') depth++;
            else if (text[i] === '}') depth--;
            if (depth === 0) {
                try {
                    const parsed = JSON.parse(text.slice(start, i + 1));
                    const tool = parsed.tool || parsed.name;
                    if (tool) calls.push({ tool, args: parsed.args || parsed.arguments || {} });
                } catch { /* ignora bloco inválido */ }
                re.lastIndex = i + 1;
                break;
            }
        }
    }
    return calls;
}

// #1002: system prompt do Marciano — identidade concisa + regras anti-sycophancy e
// anti-"announce-and-stop". Compartilhado entre GoogleProvider e LocalProvider para
// comportamento consistente. Texto-base curto a pedido do CEO (≤ 3 linhas ao se
// apresentar); corrige os três defeitos relatados: verbosidade, concordância cega e anúncio sem ação.
export const MARCIANO_IDENTITY_PROMPT = `Sou a IA da CoolGroove — mas pode me chamar de Marciano. Seu assistente pessoal para o dia a dia no sistema.
Responda de forma prestativa, profissional e concisa em Português do Brasil.

APRESENTAÇÃO: se perguntarem "quem é você?" (ou variante), responda em até 3 linhas começando com "Sou a IA da CoolGroove".

REGRA ANTI-CONCORDÂNCIA CEGA: ao ser corrigido, NÃO diga "você tem razão" sem antes verificar evidência. Se ainda não verificou, diga "não verifiquei ainda" e investigue no código/dados antes de concordar.

REGRA CRÍTICA — NUNCA "anuncie e pare": se você VAI usar uma ferramenta, emita o JSON dela AGORA, na MESMA resposta (só o JSON, sem texto antes).`;

// --- Interfaces ---

export interface ChatMessage {
    role: 'user' | 'model' | 'system';
    parts: string;
}

export interface TokenUsage {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
}

export interface GenerateReplyResult {
    text: string;
    usage?: TokenUsage;
    contextWindow?: number;
    /** Modelo que efetivamente respondeu (ex.: "glm-5.2", "MiniMax-M3"). */
    model?: string;
    /** true quando o fallback automático foi acionado (GLM→MiniMax). */
    fellBack?: boolean;
}

const CONTEXT_WINDOWS: Record<string, number> = {
    'glm-5.2': 200000,
    'glm-5.1': 200000,
    'glm-4.6v': 128000,
    'glm-4': 128000,
    'minimax-m3': 1000000,
    'gemini-2.0-flash': 1000000,
    'gemini-1.5-flash': 1000000,
    'gemini-2.5-pro': 1000000,
    'llama3': 8192,
    'llama3.1': 128000,
    'qwen2.5': 32768,
};

function getContextWindow(model?: string): number {
    if (!model) return 128000;
    const key = model.toLowerCase().replace(/[.\-]/g, '');
    for (const [k, v] of Object.entries(CONTEXT_WINDOWS)) {
        if (key.includes(k.replace(/[.\-]/g, ''))) return v;
    }
    return 128000;
}

// #956: estimativa barata de tokens (~4 chars/token para PT-BR/JSON misto). Usada para PODAR
// o contexto ANTES de enviá-lo; o valor real chega em usage.prompt_tokens (guarda de orçamento).
export function estimateTokens(text: string): number {
    return Math.ceil((text || '').length / 4);
}

// #956: poda de contexto — blocos [TOOL RESULT ...]/[ERRO NA FERRAMENTA ...] antigos são
// truncados a um sumário curto, preservando os `keepRecent` mais recentes inteiros. Impede
// que o currentContext infle indefinidamente (evidência: 6 list tools → 135K tokens) e estoure
// a janela do modelo. Retorna o contexto, possivelmente podado. Função PURA (testável).
export function pruneContext(context: string, budgetChars: number, keepRecent = 2): string {
    if (!context || context.length <= budgetChars) return context;
    // Corta apenas nos blocos de DADOS (results/erros); o contexto base e os nudges [SISTEMA]
    // (pequenos) seguem junto do "head" e não são tocados.
    const markerRe = /\n\n\[(?:TOOL RESULT|ERRO NA FERRAMENTA)[^\]]*\]/g;
    const cuts: number[] = [];
    let m: RegExpExecArray | null;
    while ((m = markerRe.exec(context))) cuts.push(m.index);
    if (!cuts.length) return context; // sem blocos podáveis -> devolve intacto
    const head = context.slice(0, cuts[0]);
    const blocks: string[] = [];
    for (let i = 0; i < cuts.length; i++) {
        blocks.push(context.slice(cuts[i], i + 1 < cuts.length ? cuts[i + 1] : context.length));
    }
    const protectedCount = Math.max(0, Math.min(keepRecent, blocks.length));
    const oldBlocks = blocks.slice(0, blocks.length - protectedCount);
    const recentBlocks = blocks.slice(blocks.length - protectedCount);

    const summarize = (block: string, maxChars: number): string => {
        const flat = block.replace(/\s+/g, ' ').trim();
        if (flat.length <= maxChars) return block;
        return flat.slice(0, maxChars) + ` … [poda de contexto: bloco de ${block.length} caracteres resumido]\n`;
    };

    // 1º passo: sumariza SÓ os antigos (preserva os recentes p/ a tarefa em andamento).
    const summarizedOld = oldBlocks.map(b => summarize(b, 400));
    let result = head + summarizedOld.join('') + recentBlocks.join('');
    if (result.length <= budgetChars) return result;
    // 2º passo: ainda estourando -> sumariza também os recentes (com folga maior).
    const summarizedRecent = recentBlocks.map(b => summarize(b, 800));
    return head + summarizedOld.join('') + summarizedRecent.join('');
}

// #957: stringificação DETERMINÍSTICA de um valor (ordena as chaves dos objetos, recursivo).
// O JSON.stringify padrão depende da ordem de inserção -> args {b:2,a:1} e {a:1,b:2} viravam
// assinaturas diferentes e quebravam o dedup. Arrays preservam a ordem (faz parte da semântica).
export function stableStringify(value: any): string {
    return JSON.stringify(value, (_k, v) => {
        if (v && typeof v === 'object' && !Array.isArray(v)) {
            return Object.keys(v).sort().reduce((acc: any, k) => { acc[k] = v[k]; return acc; }, {});
        }
        return v;
    });
}

// #957: assinatura canônica de uma tool-call para dedup no loop do agente. Normaliza a ordem
// das chaves dos args via stableStringify. Função PURA (testável).
export function toolCallSignature(tool: string, args: any): string {
    return `${tool}:${stableStringify(args ?? {})}`;
}

// #957/#955: teto de quantas vezes o gate de conclusão cutuca um "anuncia e para" antes de
// desistir e forçar síntese. Substitui o "dispara no máximo 1x" do nudge lexical #954.
export const MAX_CONCLUSION_NUDGES = 2;

// #957/#955: detector ESTRUTURAL de "anuncia e para" — substitui a regex lexical estreita do
// nudge #954. Um turno SEM tool-call é um anúncio NÃO-finalizado quando é curto, dominado por
// uma intenção de ação futura em 1ª pessoa OU termina com sinal de "continua" (":", reticências,
// seta), e NÃO entrega substância de resposta (pergunta ao usuário, valores, texto longo).
// Robusto aos modos reais de falha que a regex #954 perdia (ex.: "Vou disparar as 6 ferramentas…:").
export function looksLikeUnfinishedAnnouncement(text: string): boolean {
    const t = (text || '').trim();
    if (!t) return false;
    const lower = t.toLowerCase();
    const short = t.length < 280;
    const trailingCue = /(:|\.\.\.|…|->)$/.test(t);
    const intentionCue = /\b(vou|vamos|deixa eu|deixa-me|me deixe|permita-me|irei|pretendo|preciso|estou a|estou indo|estou verificando|agora vou|depois vou|logo vou|em seguida|let me|i'?ll|i will|i'?m going to|we'?ll|we will|gonna)\b/.test(lower);
    const hasQuestion = /\?/.test(t);
    const hasSubstance = t.length > 600 || /\d{2,}/.test(t) || /(r\$|usd|\beur\b|\brs\b)/.test(lower);
    if (hasQuestion || hasSubstance) return false;
    if (intentionCue && short) return true;
    if (trailingCue && short) return true;
    return false;
}

// #957/#955: gate de conclusão estruturado — decide o destino de um turno que NÃO emitiu
// tool-call. Substitui o nudge lexical #954: em vez de casar verbo+reticências, avalia se a
// resposta é uma entrega real (conclui) ou um anúncio não-finalizado (cutuca; sem orçamento,
// força síntese em vez de devolver o anúncio cru). Função PURA (testável).
export interface ConclusionGateInput {
    reply: string;
    nudgedCount: number; // quantas vezes o gate já cutucou neste turno
    iteration: number;   // iteração atual (0-based)
    maxIterations: number;
}
export type ConclusionGateAction = 'conclude' | 'nudge' | 'synthesize';
export interface ConclusionGateResult { action: ConclusionGateAction; reason: string; }

export function evaluateConclusionGate(inp: ConclusionGateInput): ConclusionGateResult {
    const { reply, nudgedCount, iteration, maxIterations } = inp;
    const text = (reply || '').trim();
    if (!looksLikeUnfinishedAnnouncement(text)) {
        return { action: 'conclude', reason: 'substantive-answer' };
    }
    // Anúncio não-finalizado: cutuca se ainda há orçamento de nudge E uma próxima iteração útil
    // (na iteração final o nudge não teria vez -> vai direto à síntese). O teto MAX_ITERATIONS
    // (#956) continua sendo o guarda de terminação.
    const canNudge = nudgedCount < MAX_CONCLUSION_NUDGES && iteration < maxIterations - 1;
    if (canNudge) return { action: 'nudge', reason: 'announce-without-action' };
    return { action: 'synthesize', reason: 'announce-no-nudge-budget' };
}

interface AIProvider {
    generateReply(conversationHistory: ChatMessage[], context: string, imageBase64?: string | string[], options?: { provider?: string, model?: string, origin?: string }): Promise<GenerateReplyResult>;
    analyzeSystem(query: string, fileContext: string, module?: string): Promise<string>;
    analyzeSentiment(text: string, module?: string): Promise<{ score: number; label: string }>;
    extractCustomerInfo(text: string, module?: string): Promise<any>;
    extractReceiptData(imageBase64: string, module?: string): Promise<any>;
    analyzeFinancialHealth(data: any, module?: string): Promise<string>;
    fixApiCall(logData: any, context?: string, module?: string): Promise<string>;
    generateCode(endpoint: string, method: string, description?: string, context?: string, module?: string): Promise<string>;
    getModels?(): Promise<string[]>;
    // New methods
    draftCollectionEmail?(customer: any, amount: number, module?: string): Promise<string>;
    generateSalesForecast?(invoices: any[], context?: any, module?: string): Promise<string>;
    analyzeCustomerSentiment?(customer: any, invoices: any[], module?: string): Promise<string>;
    auditProposal?(proposal: any, module?: string): Promise<string>;
    auditProject?(project: any, tasks?: any[], projectInvoices?: any[], module?: string): Promise<string>;
    analyzeSystemLogs?(logs: any[], module?: string): Promise<string>;
    analyzeMonthlyReport?(data: any, module?: string): Promise<string>;
}

// #915: agrega faturas em série mensal {period, revenue, count} ANTES de montar o prompt do
// LLM. Sem isso o forecast embute N faturas cruas no texto (conta real: 303 → 116-166s, estoura
// o timeout de cliente). Agregado vira ~12-24 pontos → geração volta pra ~28s, baixa variância.
export interface MonthlyRevenuePoint { period: string; revenue: number; count: number; }
export function aggregateInvoicesToMonthlySeries(invoices: any[]): MonthlyRevenuePoint[] {
    const map = new Map<string, { revenue: number; count: number }>();
    for (const inv of invoices || []) {
        const dateVal = inv?.date ?? inv?.datec ?? inv?.d ?? 0;
        const ts = typeof dateVal === 'string'
            ? new Date(dateVal).getTime()
            : (Number(dateVal) < 10000000000 ? Number(dateVal) * 1000 : Number(dateVal)); // s→ms
        const d = new Date(ts);
        if (isNaN(d.getTime())) continue;
        const period = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
        const cur = map.get(period) || { revenue: 0, count: 0 };
        cur.revenue += Number(inv?.total_ttc ?? inv?.v) || 0;
        cur.count += 1;
        map.set(period, cur);
    }
    return Array.from(map.entries())
        .map(([period, v]) => ({ period, revenue: Math.round(v.revenue * 100) / 100, count: v.count }))
        .sort((a, b) => a.period.localeCompare(b.period));
}

// --- Google GenAI Provider ---

class GoogleProvider implements AIProvider {
    private ai: GoogleGenAI | null = null;
    private modelName: string | undefined;

    constructor(apiKey: string, modelName?: string) {
        log.debug('Initializing GoogleProvider...');
        if (apiKey) {
            try {
                this.ai = new GoogleGenAI({ apiKey });
                this.modelName = modelName || config.geminiModel || 'gemini-1.5-flash';
            } catch (e: any) {
                log.error('Error initializing GoogleGenAI', e);
            }
        }
    }

    async generateReply(conversationHistory: ChatMessage[], context: string, imageBase64?: string | string[], options?: { provider?: string, model?: string, origin?: string }): Promise<GenerateReplyResult> {
        if (!this.ai) {
            log.error('Google AI not configured.');
            throw new Error("Google AI not configured.");
        }
        const ctxWindow = getContextWindow(options?.model || this.modelName);

        const toolsPrompt = TOOLS_PROMPT;

        let currentHistory = [...conversationHistory];
        let currentContext = context;
        let iterations = 0;
        const MAX_ITERATIONS = 5;
        const seenToolCalls = new Set<string>();
        const accUsage: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

        while (iterations < MAX_ITERATIONS) {

            // Format history
            const historyText = currentHistory.map(msg =>
                `${msg.role.toUpperCase()}: ${msg.parts}`
            ).join('\n');

            const agentPrompt = agentConfigService.getSystemPrompt();
            const prompt = `
                ${MARCIANO_IDENTITY_PROMPT}
                ${agentPrompt ? '\n' + agentPrompt + '\n' : ''}
                CONTEXTO DE DADOS:
                ${currentContext}
                
                ${toolsPrompt}

                HISTÓRICO DA CONVERSA:
                ${historyText}
                
                Tarefa: Responda a última mensagem do usuário CONSIDERANDO TODO O HISTÓRICO.
                Se o usuário fizer referência a algo dito anteriormente (faturas, nomes, datas), use o HISTÓRICO para entender. Caso contrário, se precisar de mais dados, USE AS FERRAMENTAS.
                ${imageBase64 ? 'O usuário também enviou uma imagem anexada. Analise-a e incorpore na sua resposta.' : ''}
                
                IMPORTANTE: NÃO ASSINE A MENSAGEM.
            `;

            // Build content — suporta 1+ imagens (#947): cada uma vira um inlineData part.
            const imgArr = Array.isArray(imageBase64) ? imageBase64 : (imageBase64 ? [imageBase64] : []);
            let contents: any;
            if (imgArr.length && iterations === 0) {
                const parts: any[] = [{ text: prompt }];
                for (const b64 of imgArr) {
                    parts.push({ inlineData: { data: b64.replace(/^data:image\/[^;]+;base64,/, ""), mimeType: "image/jpeg" } });
                }
                contents = [{ role: 'user', parts }];
            } else {
                contents = prompt;
            }

            const response = await this.ai.models.generateContent({
                model: options?.model || this.modelName || config.geminiModel || 'gemini-2.0-flash',
                contents,
            });

            const textResponse = response.text || "";

            const meta = (response as any).responseMetaData?.usageMetadata || (response as any).usageMetadata;
            if (meta) {
                accUsage.promptTokens += meta.promptTokenCount || 0;
                accUsage.completionTokens += meta.candidatesTokenCount || meta.completionTokenCount || 0;
                accUsage.totalTokens += meta.totalTokenCount || 0;
            }

            const toolCall = extractToolCall(textResponse);

            if (toolCall) {
                try {
                    log.info(`Tool Call: ${toolCall.tool}`, toolCall.args);

                    const callSig = toolCallSignature(toolCall.tool, toolCall.args || {});
                    if (seenToolCalls.has(callSig)) {
                        // #957: duplicata não aborta o turno — avisa o modelo e segue (deixa
                        // variar os parâmetros ou concluir). O teto MAX_ITERATIONS garante término.
                        log.warn(`GoogleProvider: tool call duplicada ignorada (turno continua): ${callSig}`);
                        currentContext += `\n\n[SISTEMA] Você já chamou ${toolCall.tool} com esses mesmos argumentos. Varie os parâmetros ou responda ao usuário com o que já tem.`;
                        iterations++;
                        continue;
                    }
                    seenToolCalls.add(callSig);

                    const toolResult = await executeTool(toolCall.tool, toolCall.args || {});

                    if (String(toolCall.tool).startsWith('prepare_')) {
                        return { text: toolResult, usage: accUsage, contextWindow: ctxWindow };
                    }

                    currentContext += `\n\n[DADOS OBTIDOS VIA ${toolCall.tool}]:\n${toolResult}\n`;

                    iterations++;
                    continue;

                } catch (e: any) {
                    if (e.name === 'AskUserInterrupt') {
                        return { text: e.question, usage: accUsage, contextWindow: ctxWindow };
                    }
                    log.error("Tool execution failed", e);
                    currentContext += `\n\n[ERRO NA EXECUÇÃO]: ${e.message}\n`;
                    iterations++;
                    continue;
                }
            }

            // No tool call, return final response
            return { text: textResponse, usage: accUsage, contextWindow: ctxWindow };
        }

        return { text: "Desculpe, não consegui obter todas as informações necessárias após várias tentativas.", usage: accUsage, contextWindow: ctxWindow };
    }

    async draftCollectionEmail(customer: any, amount: number, _module?: string): Promise<string> {
        if (!this.ai) return JSON.stringify({ subject: "Erro", body: "IA não configurada" });
        const prompt = `
            Você é um especialista em cobranças amigáveis.
            Escreva um e-mail de cobrança profissional e cordial em Português do Brasil.
            
            DADOS DO CLIENTE:
            - Nome: ${customer.name || 'Cliente'}
            - Valor em aberto: R$ ${amount.toFixed(2)}
            
            Retorne APENAS um JSON válido no formato:
            { "subject": "Assunto do email", "body": "Corpo do email completo" }
        `;
        try {
            const response = await this.ai.models.generateContent({ model: config.geminiModel, contents: prompt });
            const raw = response.text || "{}";
            const jsonStr = raw.match(/\{[\s\S]*\}/)?.[0] || "{}";
            return jsonStr;
        } catch (e) {
            log.error("draftCollectionEmail Error", e);
            return JSON.stringify({ subject: "Lembrete de Pagamento", body: "Erro ao gerar email." });
        }
    }

    async generateSalesForecast(invoices: any[], context?: any, _module?: string): Promise<string> {
        if (!this.ai) return JSON.stringify({ forecast: [], summary: "IA não configurada" });

        // Group invoices by Month/Year for clearer token usage if needed, 
        // but raw list is fine if not too huge. The frontend already filters relevant ones.

        // #915: usa a série mensal agregada (do frontend via context.timeSeries, ou agrega as
        // faturas cruas aqui — caminho da automação/cron). Prompt enxuto = geração rápida.
        const series: MonthlyRevenuePoint[] = Array.isArray(context?.timeSeries) && context.timeSeries.length
            ? context.timeSeries
            : aggregateInvoicesToMonthlySeries(invoices);

        log.debug("Received Context", context);
        log.debug(`Computed Ref Date String: ${new Date(context?.referenceDate).toLocaleDateString('pt-BR')}`);
        log.debug(`Forecast monthly points: ${series.length}`);

        const refDate = context?.referenceDate ? new Date(context.referenceDate).toLocaleDateString('pt-BR') : 'Data Atual';

        const prompt = `
            Atue como um analista financeiro sênior especializado em Sazonalidade e Previsão de Vendas.
            
            OBJETIVO:
            Gerar uma estimativa de vendas para os próximos 3 meses do ano corrente.
            
            DATA DE REFERÊNCIA (HOJE): ${refDate}
            (Importante: O "Mês Atual" está incompleto. Sua previsão para ele deve ser um "Landing" (Previsão de Fechamento), somando o que já foi realizado (nas faturas enviadas) com a projeção para os dias restantes baseada na sazonalidade).

            METODOLOGIA DE ANÁLISE:
            1. MÊS ATUAL (LANDING): Estime o fechamento do mês atual somando Realizado + Tendência para dias restantes.
            2. PRÓXIMOS MESES (SAZONALIDADE): Utilize os meses seguintes dos anos anteriores para estimar os meses futuros (padrão de comportamento).
            3. TENDÊNCIA (AJUSTE): Utilize os dados recentes (últimos 6 meses) para ajustar a escala volumétrica geral.

            DADOS (Série Mensal de Receita — já agregada por mês: { "period": "AAAA-MM", "revenue": total faturado, "count": nº de faturas }):
            ${JSON.stringify(series)}

            INSTRUÇÕES:
            - Identifique o padrão de vendas (picos/quedas) nos meses alvo em anos anteriores.
            - Projete esse padrão para os próximos 3 meses.
            - Ajuste os valores finais baseando-se na média de faturamento dos últimos 6 meses (Tendência).

            SAÍDA (JSON Puro):
            {
                "forecast": [
                    { "month": "Nome Mês Ano", "predicted_revenue": 0.00, "confidence": "high|medium|low" } // 3 meses
                ],
                "summary": "Explique a lógica (ex: 'Projeção baseada nos meses X, Y, Z de 2024, ajustada pelo crescimento recente...')",
                "trend": "up" | "down" | "stable"
            }
        `;
        try {
            const response = await this.ai.models.generateContent({ model: config.geminiModel, contents: prompt });
            const raw = response.text || "{}";
            const jsonStr = raw.match(/\{[\s\S]*\}/)?.[0] || "{}";
            return jsonStr;
        } catch (e) {
            log.error("generateSalesForecast Error", e);
            return JSON.stringify({ forecast: [], summary: "Erro na previsão." });
        }
    }

    async analyzeCustomerSentiment(customer: any, invoices: any[], _module?: string): Promise<string> {
        if (!this.ai) return JSON.stringify({ score: 50, label: "N/A", insights: "IA não configurada" });
        const relevantInvoices = invoices.slice(0, 20).map(i => ({
            ref: i.ref,
            total: i.total_ttc,
            status: i.status,
            date: i.date
        }));
        const prompt = `
            Analise o relacionamento com este cliente baseado nos dados abaixo.
            
            CLIENTE:
            - Nome: ${customer.name}
            - Status: ${customer.status}
            - Desde: ${customer.date_creation || 'N/A'}
            
            FATURAS RECENTES:
            ${JSON.stringify(relevantInvoices)}
            
            Retorne APENAS um JSON:
            {
                "score": 0-100,
                "label": "Positive" | "Neutral" | "Negative" | "At Risk",
                "insights": "Análise em português",
                "recommendations": ["Recomendação 1", "Recomendação 2"]
            }
        `;
        try {
            const response = await this.ai.models.generateContent({ model: config.geminiModel, contents: prompt });
            const raw = response.text || "{}";
            const jsonStr = raw.match(/\{[\s\S]*\}/)?.[0] || "{}";
            return jsonStr;
        } catch (e) {
            log.error("analyzeCustomerSentiment Error", e);
            return JSON.stringify({ score: 50, label: "Error", insights: "Erro na análise." });
        }
    }

    async auditProposal(proposal: any, _module?: string): Promise<string> {
        if (!this.ai) return JSON.stringify({ score: 0, issues: ["IA não configurada"] });
        const prompt = `
            Você é um auditor de propostas comerciais.
            Analise esta proposta e identifique possíveis problemas ou melhorias.
            
            PROPOSTA:
            ${JSON.stringify(proposal)}
            
            Retorne APENAS um JSON:
            {
                "score": 0-100,
                "status": "Aprovada" | "Revisar" | "Rejeitada",
                "issues": ["Problema 1", "Problema 2"],
                "suggestions": ["Sugestão 1", "Sugestão 2"],
                "summary": "Resumo da auditoria"
            }
        `;
        try {
            const response = await this.ai.models.generateContent({ model: config.geminiModel, contents: prompt });
            const raw = response.text || "{}";
            const jsonStr = raw.match(/\{[\s\S]*\}/)?.[0] || "{}";
            return jsonStr;
        } catch (e) {
            log.error("auditProposal Error", e);
            return JSON.stringify({ score: 0, issues: ["Erro na auditoria."] });
        }
    }

    async auditProject(project: any, tasks?: any[], projectInvoices?: any[], _module?: string): Promise<string> {
        if (!this.ai) return JSON.stringify({ health: "unknown", issues: ["IA não configurada"] });
        const prompt = `
            Você é um gerente de projetos experiente.
            Analise a saúde deste projeto e identifique riscos.
            
            PROJETO:
            ${JSON.stringify(project)}
            
            TAREFAS (${tasks?.length || 0}):
            ${JSON.stringify(tasks?.slice(0, 20) || [])}
            
            FATURAS RELACIONADAS (${projectInvoices?.length || 0}):
            ${JSON.stringify(projectInvoices?.slice(0, 10) || [])}
            
            Retorne APENAS um JSON:
            {
                "health": "Saudável" | "Atenção" | "Crítico",
                "score": 0-100,
                "risks": ["Risco 1", "Risco 2"],
                "recommendations": ["Recomendação 1"],
                "summary": "Resumo da análise"
            }
        `;
        try {
            const response = await this.ai.models.generateContent({ model: config.geminiModel, contents: prompt });
            const raw = response.text || "{}";
            const jsonStr = raw.match(/\{[\s\S]*\}/)?.[0] || "{}";
            return jsonStr;
        } catch (e) {
            log.error("auditProject Error", e);
            return JSON.stringify({ health: "unknown", issues: ["Erro na análise."] });
        }
    }

    async analyzeSystemLogs(logs: any[], _module?: string): Promise<string> {
        if (!this.ai) return "[]";
        const logsSummary = logs.slice(0, 50).map(l => ({
            type: l.endpoint_or_task || l.type,
            status: l.status,
            duration: l.duration_ms,
            error: l.error_message
        }));
        const prompt = `
            Você é um especialista em otimização de sistemas.
            Analise estes logs de API e sugira otimizações.
            
            LOGS:
            ${JSON.stringify(logsSummary)}
            
            Retorne APENAS um JSON array:
            [
                {
                    "type": "error" | "performance" | "pattern",
                    "title": "Título curto",
                    "description": "Descrição do problema",
                    "suggestion": "Como resolver",
                    "priority": "high" | "medium" | "low"
                }
            ]
        `;
        try {
            const response = await this.ai.models.generateContent({ model: config.geminiModel, contents: prompt });
            const raw = response.text || "[]";
            const jsonStr = raw.match(/\[[\s\S]*\]/)?.[0] || "[]";
            return jsonStr;
        } catch (e) {
            log.error("analyzeSystemLogs Error", e);
            return "[]";
        }
    }

    async analyzeMonthlyReport(data: any): Promise<string> {
        if (!this.ai) return "Análise indisponível (Erro de Configuração)";

        const prompt = `
            Atue como um CFO (Chief Financial Officer) e COO (Chief Operating Officer) experiente.
            Você está gerando o RELATÓRIO MENSAL EXECUTIVO para a diretoria.

            DADOS DO MÊS:
            ${JSON.stringify(data, null, 2)}

            Sua tarefa é analisar estes dados brutos e escrever um resumo executivo profissional em Markdown.

            ESTRUTURA OBRIGATÓRIA DO RELATÓRIO:

            ## 1. Resumo Executivo
            Uma visão geral do mês em 1-2 parágrafos. O mês foi bom? Quais foram as grandes vitórias? Houve algum problema crítico?

            ## 2. Destaques Financeiros
            - Analise a receita vs despesas.
            - Comente sobre o fluxo de caixa.
            - Aponte tendências preocupantes ou positivas.

            ## 3. Performance Comercial
            - Taxa de conversão de propostas.
            - Volume de novos negócios.
            - Previsão para o próximo mês (se houver dados de pipeline).

            ## 4. Eficiência Operacional & RH
            - Carga de trabalho da equipe.
            - Projetos em risco ou atrasados.
            - Saúde do time (absenteísmo, turnover).

            ## 5. Recomendações Estratégicas
            3 a 5 ações concretas que a diretoria deve tomar baseada nestes números.

            TOM DE VOZ:
            Profissional, direto, focado em insights e não apenas repetir números. Use formatação (negrito, listas) para facilitar a leitura.
        `;

        try {
            const response = await this.ai.models.generateContent({
                model: this.modelName || 'gemini-1.5-flash',
                contents: prompt
            });
            return response.text || "Não foi possível gerar o relatório.";
        } catch (e) {
            log.error("analyzeMonthlyReport Error", e);
            return "Erro ao analisar o relatório mensal.";
        }
    }

    async analyzeSystem(query: string, fileContext: string): Promise<string> {
        if (!this.ai) throw new Error("Google AI not configured");

        const prompt = `
            Você é um especialista em análise de sistemas de software.
            
            CONTEXTO DE ARQUIVOS DO SISTEMA:
            ${fileContext}
            
            PERGUNTA DO USUÁRIO:
            ${query}
            
            Responda com base apenas no código fornecido. Seja técnico e preciso.
        `;

        const response = await this.ai.models.generateContent({
            model: config.geminiModel,
            contents: prompt,
        });
        return response.text || "";
    }

    async analyzeSentiment(text: string): Promise<{ score: number; label: string }> {
        if (!this.ai) return { score: 0, label: 'N/A' };

        const prompt = `
            Analise o sentimento da seguinte mensagem em uma escala de 0 a 100 (0=Muito Negativo, 100=Muito Positivo).
            Retorne APENAS um JSON no formato: { "score": number, "label": "Positive" | "Neutral" | "Negative" }
            
            Mensagem: "${text}"
        `;

        try {
            const response = await this.ai.models.generateContent({
                model: config.geminiModel,
                contents: prompt,
            });
            const raw = response.text || "{}";
            const jsonStr = raw.match(/\{[\s\S]*\}/)?.[0] || "{}";
            return JSON.parse(jsonStr);
        } catch (error) {
            log.error("Sentiment Error", error);
            return { score: 50, label: 'Error' };
        }
    }

    async extractCustomerInfo(text: string): Promise<any> {
        if (!this.ai) return null;
        const prompt = `
            Extraia informações de cliente do texto abaixo.
            Retorne um JSON com os campos: name, email, phone, address, tax_id (CPF/CNPJ).
            Se não encontrar info, retorne null nos campos.
            
            Texto: "${text}"
        `;
        try {
            const response = await this.ai.models.generateContent({ model: config.geminiModel, contents: prompt });
            const raw = response.text || "{}";
            const cleanJson = raw.replace(/```json|```/g, '').trim();
            return JSON.parse(cleanJson);
        } catch (e) {
            log.error("Gemini Extract Error", e);
            return null;
        }
    }

    async extractReceiptData(imageBase64: string) {
        if (!this.ai) return null;
        try {
            const cleanBase64 = imageBase64.replace(/^data:image\/(png|jpeg|jpg|webp);base64,/, "");

            const prompt = `
            Analyze this receipt image and extract the following JSON data:
            - date (YYYY-MM-DD)
            - vendor (string)
            - total (number)
            - currency (string, e.g. BRL, USD)
            - items: array of objects with:
                - description (full product name/text)
                - quantity (count, default to 1 if not specified)
                - unit_price (price per unit)
                - total_price (line total)
            - category: string (suggested expense category based on items)

            Return ONLY raw JSON.
            `;

            const result = await this.ai.models.generateContent({
                model: config.geminiModel,
                contents: [
                    {
                        role: 'user',
                        parts: [
                            { text: prompt },
                            { inlineData: { data: cleanBase64, mimeType: "image/jpeg" } }
                        ]
                    }
                ]
            });

            const raw = result.text || "{}";
            const cleanJson = raw.replace(/```json|```/g, '').trim();
            return JSON.parse(cleanJson);
        } catch (error) {
            log.error("Gemini Vision Error", error);
            return null;
        }
    }

    async analyzeFinancialHealth(data: any): Promise<string> {
        if (!this.ai) return "Análise indisponível (Erro de Configuração)";
        try {
            const prompt = `
            Atue como um CFO (Chief Financial Officer) virtual. Analise os seguintes dados financeiros e forneça um resumo executivo com insights e recomendações.
            Use formatação Markdown.
            Dados: ${JSON.stringify(data)}
            `;
            const result = await this.ai.models.generateContent({
                model: config.geminiModel,
                contents: prompt
            });
            return result.text || "";
        } catch (error) {
            log.error("Gemini Finance Analysis Error", error);
            return "Não foi possível gerar a análise financeira no momento.";
        }
    }

    async fixApiCall(logData: any, context?: string): Promise<string> {
        if (!this.ai) return "Service Unavailable";
        const prompt = `
        You are a Senior TypeScript/React Developer.
        Analyze this failed API call log and provide a solution.

        SYSTEM CONTEXT:
        ${context || 'No context provided.'}

        FAILED REQUEST LOG:
        ${JSON.stringify(logData, null, 2)}

        Task: Explain failure and provide corrected code.
        `;
        try {
            const result = await this.ai.models.generateContent({
                model: config.geminiModel,
                contents: prompt
            });
            return result.text || "";
        } catch (e) {
            log.error("Gemini fixApiCall Error", e);
            return "Analysis failed.";
        }
    }

    async generateCode(endpoint: string, method: string, description?: string, context?: string): Promise<string> {
        if (!this.ai) return "Service Unavailable";
        const prompt = `
        You are a Senior Developer. Write a TypeScript function for \`dolibarrService.ts\`.

        Details:
        - Endpoint: ${endpoint}
        - Method: ${method}
        - Description: ${description}

        Context:
        ${context || "Standard Dolibarr REST API"}

        Output ONLY valid TypeScript code.
        `;
        try {
            const result = await this.ai.models.generateContent({
                model: config.geminiModel,
                contents: prompt
            });
            return result.text || "";
        } catch (e) {
            log.error("Gemini CodeGen Error", e);
            return "// Generation failed";
        }
    }

    async transcribeAudio(audioBase64: string, mimeType: string = 'audio/ogg'): Promise<string> {
        if (!this.ai) return "[Transcrição indisponível]";
        try {
            const cleanBase64 = audioBase64.replace(/^data:audio\/[^;]+;base64,/, "");

            const result = await this.ai.models.generateContent({
                model: config.geminiModel,
                contents: [
                    {
                        role: 'user',
                        parts: [
                            { text: "Transcreva o áudio a seguir para texto em português. Retorne APENAS a transcrição, sem comentários adicionais." },
                            { inlineData: { data: cleanBase64, mimeType } }
                        ]
                    }
                ]
            });

            return result.text?.trim() || "[Áudio não reconhecido]";
        } catch (error) {
            log.error("Gemini Audio Transcription Error", error);
            return "[Erro na transcrição]";
        }
    }

    async getModels(): Promise<string[]> {
        if (!this.ai) return [];
        try {
            // Google GenAI list models endpoint
            const response = await this.ai.models.list();
            // Filter for generative models that support generateContent
            const generativeModels = [];
            for await (const model of response) {
                // Only include models that start with 'models/gemini'
                if (model.name?.startsWith('models/gemini')) {
                    // Extract model name without 'models/' prefix
                    const modelName = model.name.replace('models/', '');
                    generativeModels.push(modelName);
                }
            }
            // Sort with newer models first
            return generativeModels.sort((a, b) => {
                // Prioritize 2.0 > 1.5 > 1.0
                const getVersion = (m: string) => {
                    if (m.includes('2.0')) return 3;
                    if (m.includes('1.5')) return 2;
                    return 1;
                };
                const vDiff = getVersion(b) - getVersion(a);
                if (vDiff !== 0) return vDiff;
                // Then prioritize flash > pro
                if (a.includes('flash') && !b.includes('flash')) return -1;
                if (!a.includes('flash') && b.includes('flash')) return 1;
                return a.localeCompare(b);
            });
        } catch (error) {
            log.error("Failed to fetch Gemini models", error);
            // Fallback to known models if API fails
            return [
                'gemini-2.0-flash',
                'gemini-2.0-flash-lite',
                'gemini-1.5-flash',
                'gemini-1.5-flash-8b',
                'gemini-1.5-pro',
                'gemini-pro'
            ];
        }
    }
}

// --- Local LLM Provider (OpenAI Compatible) ---

import { isQuotaError, markQuotaExhausted, clearQuotaExhausted } from './llmQuotaState';
import { llmCallLogService } from './llmCallLogService';
import { llmHealthService } from './llmHealthService';
import { configService as _configService } from './configService';

export class LocalProvider implements AIProvider {
    private baseUrl: string;
    private modelName: string;
    private apiKey?: string;
    // Config opcional de VISÃO (ex.: GLM-4.6V). Quando presente, o provider passa a
    // suportar OCR/análise de imagem direto (sem fallback p/ Google). Usa uma base
    // própria pois o modelo multimodal vive em endpoint diferente do de texto.
    private visionConfig?: { baseUrl: string; model: string };
    // Fallback de TEXTO (ex.: MiniMax M3) acionado quando o provider primário (GLM/Z.AI)
    // falha de forma RECUPERÁVEL — tipicamente HTTP 429 (rate limit) ou timeout/5xx. Mantém
    // Judge/Planner/chat funcionando quando a cota do GLM estoura. Endpoint próprio (modelo
    // e chave diferentes do primário).
    private fallbackConfig?: { baseUrl: string; model: string; apiKey?: string };

    constructor(baseUrl: string, modelName: string = 'llama3', apiKey?: string, visionConfig?: { baseUrl: string; model: string }, fallbackConfig?: { baseUrl: string; model: string; apiKey?: string }) {
        this.baseUrl = (baseUrl || '').replace(/\/+$/, ''); // remove barra final -> evita //chat/completions
        this.modelName = modelName;
        this.apiKey = apiKey;
        this.visionConfig = visionConfig && visionConfig.baseUrl
            ? { baseUrl: visionConfig.baseUrl.replace(/\/+$/, ''), model: visionConfig.model }
            : undefined;
        this.fallbackConfig = fallbackConfig && fallbackConfig.baseUrl && process.env.LLM_FALLBACK_ENABLED !== 'false'
            ? { baseUrl: fallbackConfig.baseUrl.replace(/\/+$/, ''), model: fallbackConfig.model, apiKey: fallbackConfig.apiKey }
            : undefined;
    }

    // Erro recuperável -> vale tentar o fallback: rate limit (429), erro de servidor (5xx),
    // ou timeout/queda de conexão. 4xx (exceto 429) NÃO é recuperável (request inválido).
    private isRetryableError(err: any): boolean {
        const status = err?.response?.status;
        if (status === 429) return true;
        if (typeof status === 'number' && status >= 500 && status < 600) return true;
        const code = err?.code;
        return code === 'ECONNABORTED' || code === 'ETIMEDOUT' || code === 'ECONNRESET' || code === 'ECONNREFUSED';
    }

    // Detalhe legível do erro (status HTTP + corpo, ou code/message) — usado p/ detectar cota.
    private errDetail(err: any): string {
        return err?.response
            ? `HTTP ${err.response.status} ${JSON.stringify(err.response.data || '').slice(0, 200)}`
            : (err?.code || err?.message || String(err));
    }

    // POST /chat/completions no primário; se falhar de forma recuperável e houver fallback
    // configurado, refaz a MESMA chamada no fallback (MiniMax M3). Lança se ambos falharem.
    // Efeito colateral: SUCESSO limpa o sinal global de cota; FALHA por cota (429/1310/402/...)
    // o marca — para o TaskRunner segurar o dispatch e retomar quando a API voltar.
    // Código de erro curto (status HTTP ou code de rede) p/ o log durável (#710).
    private errCode(err: any): string {
        return err?.response?.status ? String(err.response.status) : (err?.code || 'error');
    }

    // Backoff exponencial para erros de infra (429/timeout/5xx): tenta o primário ANTES do
    // fallback, com esperas 2s→4s→8s... até o DEADLINE de re-tentativas. Não é um loop infinito:
    // quando o deadline estoura, desiste e passa para o fallback (se houver) ou lança.
    // Não toca o fallback em erro não-recuperável (4xx exceto 429, JSON inválido, etc.).
    private async postChatCompletion(messages: any[], temperature: number, options?: { model?: string; origin?: string }): Promise<{ data: any; modelUsed: string; fellBack: boolean }> {
        const buildBody = (model: string) => ({ model, messages, temperature });
        const primaryModel = options?.model || this.modelName;
        const origin = options?.origin;
        const primaryTimeoutMs = config.llmPrimaryTimeoutMs ?? 180000;
        const retryDeadlineMs = config.llmRetryDeadlineMs ?? 60000;
        const retryDeadline = Date.now() + retryDeadlineMs;
        const t0 = Date.now();

        let primaryErr: any;
        let retryDelay = 2000; // backoff inicial: 2s

        // Tenta o primário com backoff exponencial dentro do deadline.
        while (true) {
            try {
                const r = await axios.post(`${this.baseUrl}/chat/completions`, buildBody(primaryModel), { headers: this.getHeaders(), timeout: primaryTimeoutMs });
                clearQuotaExhausted(); // sucesso -> cota OK
                llmCallLogService.record({ model: primaryModel, primaryModel, fellBack: false, ok: true, latencyMs: Date.now() - t0, origin, totalTokens: r.data?.usage?.total_tokens });
                return { data: r.data, modelUsed: primaryModel, fellBack: false };
            } catch (err: any) {
                primaryErr = err;
                // Erro não-recuperável (400/401/403 etc.): não tenta fallback, lança imediatamente.
                if (!this.isRetryableError(err)) {
                    if (isQuotaError(this.errDetail(err))) markQuotaExhausted(`primário ${this.modelName}: ${this.errDetail(err)}`);
                    llmCallLogService.record({ model: primaryModel, primaryModel, fellBack: false, ok: false, latencyMs: Date.now() - t0, origin, errorCode: this.errCode(err), errorDetail: this.errDetail(err).slice(0, 300) });
                    throw err;
                }

                const reason = err?.response?.status || err?.code || err?.message || 'erro';
                const remaining = retryDeadline - Date.now();

                if (remaining > retryDelay) {
                    // Ainda há tempo dentro do deadline — aguarda backoff e tenta de novo.
                    log.warn(`LLM primário (${this.modelName}) falhou [${reason}] — backoff ${retryDelay}ms (deadline restante: ${Math.round(remaining / 1000)}s)`);
                    await new Promise((res) => setTimeout(res, retryDelay));
                    retryDelay = Math.min(retryDelay * 2, 32000); // cap em 32s
                } else {
                    // Deadline esgotado: passa para fallback (se houver) ou lança.
                    log.warn(`LLM primário (${this.modelName}) falhou [${reason}] — deadline de retry esgotado -> ${this.fallbackConfig ? `fallback para ${this.fallbackConfig.model}` : 'lançando erro'}`);
                    break;
                }
            }
        }

        // Sem fallback configurado: registra e lança o erro do primário.
        if (!this.fallbackConfig) {
            if (isQuotaError(this.errDetail(primaryErr))) markQuotaExhausted(`primário ${this.modelName}: ${this.errDetail(primaryErr)}`);
            llmCallLogService.record({ model: primaryModel, primaryModel, fellBack: false, ok: false, latencyMs: Date.now() - t0, origin, errorCode: this.errCode(primaryErr), errorDetail: this.errDetail(primaryErr).slice(0, 300) });
            throw primaryErr;
        }

        // Fallback (MiniMax M3)
        const fbHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
        if (this.fallbackConfig!.apiKey) fbHeaders['Authorization'] = `Bearer ${this.fallbackConfig!.apiKey}`;
        const tFb = Date.now();
        try {
            const resp = await axios.post(`${this.fallbackConfig!.baseUrl}/chat/completions`, buildBody(this.fallbackConfig!.model), { headers: fbHeaders, timeout: primaryTimeoutMs });
            log.info(`LLM fallback OK: ${this.fallbackConfig!.model} respondeu no lugar de ${this.modelName}`);
            clearQuotaExhausted(); // fallback respondeu -> ainda há cota (no MiniMax)
            llmCallLogService.record({ model: this.fallbackConfig!.model, primaryModel, fellBack: true, ok: true, latencyMs: Date.now() - tFb, origin, errorDetail: `primário ${primaryModel}: ${this.errDetail(primaryErr)}`.slice(0, 300), totalTokens: resp.data?.usage?.total_tokens });
            return { data: resp.data, modelUsed: this.fallbackConfig!.model, fellBack: true };
        } catch (fbErr: any) {
            // Ambos falharam: se qualquer um foi erro de cota, sinaliza esgotamento GLOBAL.
            if (isQuotaError(this.errDetail(fbErr)) || isQuotaError(this.errDetail(primaryErr))) {
                markQuotaExhausted(`primário+fallback esgotados — ${this.errDetail(fbErr)}`);
            }
            llmCallLogService.record({ model: this.fallbackConfig!.model, primaryModel, fellBack: true, ok: false, latencyMs: Date.now() - tFb, origin, errorCode: this.errCode(fbErr), errorDetail: this.errDetail(fbErr).slice(0, 300) });
            throw fbErr;
        }
    }

    // true quando o provider tem um modelo de visão configurado + chave (ex.: GLM-4.6V).
    supportsVision(): boolean {
        return !!this.visionConfig && !!this.apiKey;
    }

    private getHeaders(): Record<string, string> {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (this.apiKey) {
            headers['Authorization'] = `Bearer ${this.apiKey}`;
        }
        return headers;
    }

    async getModels(): Promise<string[]> {
        try {
            // Ollama/OpenAI Compatible /v1/models endpoint
            const response = await axios.get(`${this.baseUrl}/models`, { headers: this.getHeaders() });
            // Standard OpenAI format: { data: [{ id: 'model-name', ... }, ...] }
            if (response.data && Array.isArray(response.data.data)) {
                return response.data.data.map((m: any) => m.id);
            }
            // Ollama raw format: { models: [{ name: 'model:tag' }] }
            if (response.data && Array.isArray(response.data.models)) {
                return response.data.models.map((m: any) => m.name);
            }
            return [];
        } catch (error) {
            log.error("Failed to fetch local models", error);
            return [];
        }
    }

    async generateReply(conversationHistory: ChatMessage[], context: string, imageBase64?: string | string[], options?: { provider?: string, model?: string, origin?: string }): Promise<GenerateReplyResult> {
        const toolsPrompt = TOOLS_PROMPT;
        const ctxWindow = getContextWindow(options?.model || this.modelName);

        let currentHistory = [...conversationHistory];
        let currentContext = context;
        let iterations = 0;
        // #956: teto de iterações (25-40; default 30) — NÃO infinito (risco de loop). Junto
        // com o orçamento de tokens abaixo, garante que tarefas multi-lookup (cotação = achar
        // cliente + buscar N produtos + montar proposta) completem sem cair na síntese que
        // proíbe ferramentas. Criação em massa (prepare_create_proposal(lines)/prepare_batch_create)
        // colapsa N escritas em 1 call — reforçado no prompt — então 30 cobre cenários pesados.
        const MAX_ITERATIONS = Math.min(Math.max(config.agentMaxIterations ?? 30, 1), 40);
        // Orçamento de contexto (#956): PARAR ANTES de estourar a janela do modelo, não num nº
        // mágico de passos. budget = fração da janela; o resto cobre a resposta final + margem.
        const contextBudgetTokens = Math.floor(ctxWindow * (config.agentContextBudgetPct ?? 0.72));
        // currentContext (a parte que mais cresce — TOOL RESULTs) fica limitada a ~metade do
        // orçamento em caracteres; system prompt (tools) + histórico usam o resto.
        const contextCharBudget = Math.floor(contextBudgetTokens * 0.5 * 4);
        const seenToolCalls = new Set<string>();
        let nudgedCount = 0; // #957/#955: gate de conclusão conta quantos nudges já aplicou.
        // #959: modelos de raciocínio (MiniMax M3, GLM) vazam <think>...</think>/<reasoning> no
        // content. Remove esses blocos SÓ para exibição/narração — a extração de tool-call usa o cru.
        const stripReasoning = (t?: string) => (t || '')
            .replace(/<think>[\s\S]*?<\/think>/gi, '')
            .replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, '')
            .trim();
        const accUsage: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
        // Track which model actually responded and whether fallback was used.
        let lastModelUsed: string = options?.model || this.modelName;
        let lastFellBack = false;
        // #956: tamanho real (em tokens) do último prompt enviado — sinal de ground truth p/ o
        // guarda de orçamento. budgetExhausted marca se saímos do loop por orçamento (síntese).
        let lastPromptTokens = 0;
        let budgetExhausted = false;

        const accumulate = (usage: any) => {
            if (!usage) return;
            accUsage.promptTokens += usage.prompt_tokens || 0;
            accUsage.completionTokens += usage.completion_tokens || 0;
            accUsage.totalTokens += usage.total_tokens || 0;
            if (usage.prompt_tokens) lastPromptTokens = usage.prompt_tokens;
        };

        // #934/#947: o modelo de texto (glm-5.x) não é multimodal — a imagem era IGNORADA.
        // Agora descreve/OCR via modelo de visão (glm-4.6v) e injeta no contexto, para o loop
        // de tools agir sobre o conteúdo real (ex.: foto de nota → update_stock). Suporta
        // MÚLTIPLAS imagens (descreve cada uma). Falha da visão vira aviso (sem alucinar).
        const imgs = Array.isArray(imageBase64) ? imageBase64 : (imageBase64 ? [imageBase64] : []);
        if (imgs.length) {
            const lastUserMsg = [...currentHistory].reverse().find(m => m.role === 'user')?.parts;
            const hint = typeof lastUserMsg === 'string' ? lastUserMsg : undefined;
            const descriptions = await Promise.all(imgs.map((b64) => this.describeImage(b64, hint)));
            const label = imgs.length === 1 ? 'IMAGEM ANEXADA' : `${imgs.length} IMAGENS ANEXADAS`;
            const body = descriptions.map((d, i) => {
                const tag = imgs.length === 1 ? '' : `IMAGEM ${i + 1}: `;
                return d ? `${tag}${d}` : `${tag}[não foi possível analisar esta imagem]`;
            }).join('\n\n');
            const anyOk = descriptions.some(Boolean);
            currentContext += anyOk
                ? `\n\n[${label} — conteúdo extraído pela visão (${this.visionConfig?.model}), trate como o que o usuário enviou]:\n${body}`
                : `\n\n[${label}]: não foi possível analisá-la(s) (visão indisponível). AVISE o usuário; NÃO invente o conteúdo.`;
        }

        while (iterations < MAX_ITERATIONS) {
            // #956: guarda de orçamento — se a última chamada já esgotou o orçamento de tokens,
            // outra iteração arrisca estourar a janela do modelo. Interrompe e sintetiza com o
            // que já coletamos (o currentContext é podado a cada passo, então cabe na síntese).
            if (lastPromptTokens && lastPromptTokens >= contextBudgetTokens) {
                budgetExhausted = true;
                log.warn(`Agente: orçamento de contexto atingido (${lastPromptTokens} >= ${contextBudgetTokens} tokens) — sintetizando com os dados coletados.`);
                break;
            }
            const agentPrompt = agentConfigService.getSystemPrompt();
            let messages = [
                { role: 'system', content: `${MARCIANO_IDENTITY_PROMPT}${agentPrompt ? '\n' + agentPrompt : ''}\n\nCONTEXTO: ${currentContext}\n\n${toolsPrompt}` },
                ...currentHistory.map(msg => ({
                    role: msg.role === 'model' ? 'assistant' : msg.role,
                    content: msg.parts
                }))
            ];

            while (messages.length > 1 && messages[1].role === 'assistant') {
                messages.splice(1, 1);
            }

            try {
                const { data, modelUsed, fellBack } = await this.postChatCompletion(messages, 0.5, options);
                lastModelUsed = modelUsed;
                lastFellBack = fellBack;

                accumulate(data.usage);

                const message = data.choices[0].message;
                const rawContent = message.content || '';
                const reply = stripReasoning(rawContent);
                // #955: modelos como o MiniMax M3 emitem VÁRIAS tool-calls de uma vez. Executa
                // todas na mesma iteração (honra o estilo do modelo e alivia o teto). Fallback:
                // single (cobre <tool_call:...> do GLM) e reasoning_content (GLM põe a chamada lá).
                let toolCalls = extractToolCalls(rawContent);
                if (!toolCalls.length) {
                    const single = extractToolCall(rawContent) || extractToolCall(message.reasoning_content || '');
                    if (single) toolCalls = [single];
                }

                if (toolCalls.length) {
                    let ranAny = false;
                    const duplicates: string[] = [];
                    for (const tc of toolCalls) {
                        const callSig = toolCallSignature(tc.tool, tc.args || {});
                        if (seenToolCalls.has(callSig)) {
                            duplicates.push(tc.tool);
                            continue; // #957: pula a duplicata (não aborta o turno)
                        }
                        seenToolCalls.add(callSig);
                        log.info(`Local LLM Tool Call: ${tc.tool}`, tc.args);
                        try {
                            const toolResult = await executeTool(tc.tool, tc.args || {});
                            // prepare_* (HITL) devolve deeplink e encerra o turno p/ o usuário confirmar.
                            if (String(tc.tool).startsWith('prepare_')) {
                                return { text: toolResult, usage: accUsage, contextWindow: ctxWindow, model: lastModelUsed, fellBack: lastFellBack };
                            }
                            currentContext += `\n\n[TOOL RESULT ${tc.tool}]: ${toolResult}`;
                            // #956: poda de contexto — mantém o currentContext dentro do orçamento
                            // (TOOL RESULTs antigos viram sumário; os recentes ficam inteiros).
                            currentContext = pruneContext(currentContext, contextCharBudget, 2);
                            ranAny = true;
                        } catch (e: any) {
                            if (e.name === 'AskUserInterrupt') {
                                return { text: e.question, usage: accUsage, contextWindow: ctxWindow, model: lastModelUsed, fellBack: lastFellBack };
                            }
                            // erro de tool não aborta o turno — injeta e segue.
                            const detail = e?.message || String(e);
                            log.warn(`Local LLM Tool Error (injeta e continua): ${detail}`);
                            currentContext += `\n\n[ERRO NA FERRAMENTA ${tc.tool}]: ${detail}. Corrija os parâmetros ou responda ao usuário com o que já tem.`;
                            currentContext = pruneContext(currentContext, contextCharBudget, 2);
                            ranAny = true;
                        }
                    }
                    if (ranAny) {
                        iterations++;
                        continue;
                    }
                    // #957: TODAS as chamadas eram duplicatas -> sem progresso novo. Em vez de
                    // encerrar o turno (break -> síntese prematura), injeta um AVISO nomeando a
                    // ferramenta repetida e dá ao modelo outra chance de variar os parâmetros ou
                    // concluir. O teto MAX_ITERATIONS (#956) garante a terminação do loop.
                    const dupList = Array.from(new Set(duplicates)).join(', ') || 'a ferramenta';
                    currentContext += `\n\n[SISTEMA] Você já chamou ${dupList} com esses mesmos argumentos. Varie os parâmetros (ex.: outro termo de busca, outro filtro) ou, se já tem dados suficientes, responda ao usuário com o que já coletou.`;
                    iterations++;
                    continue;
                }

                // #957/#955: gate de conclusão ESTRUTURADO substitui o nudge lexical #954 (que só
                // casava verbo+reticências, disparava 1x e nunca na última iteração). O gate decide
                // o destino de um turno sem tool-call: entregar a resposta (conclude), cutucar para
                // o modelo agir/responder (nudge), ou forçar síntese quando não há mais orçamento.
                const gate = evaluateConclusionGate({
                    reply,
                    nudgedCount,
                    iteration: iterations,
                    maxIterations: MAX_ITERATIONS,
                });
                if (gate.action === 'nudge') {
                    nudgedCount++;
                    currentContext += `\n\n[SISTEMA] Sua resposta anterior apenas ANUNCIOU uma ação ("${reply.slice(0, 160).replace(/\s+/g, ' ')}") mas NÃO executou ferramenta nem entregou uma resposta final. Decida AGORA: (a) se precisa de dados, emita o JSON {"tool":"nome","args":{...}} — nada de texto antes; (b) se já tem o suficiente, responda DIRETAMENTE ao usuário, sem apenas anunciar.`;
                    iterations++;
                    continue;
                }
                if (gate.action === 'synthesize') {
                    // Anúncio sem orçamento de nudge: não devolve o cru -> força síntese a partir
                    // dos dados coletados (bloco após o while).
                    break;
                }

                return { text: reply, usage: accUsage, contextWindow: ctxWindow, model: lastModelUsed, fellBack: lastFellBack };

            } catch (error: any) {
                const detail = error?.response
                    ? `HTTP ${error.response.status} ${JSON.stringify(error.response.data)?.slice(0, 300)}`
                    : (error?.code || error?.message || String(error));
                log.error(`Local LLM Error [url=${this.baseUrl}/chat/completions model=${this.modelName}]: ${detail}`);
                // Re-lança para que wrappers (aiService.generateReply / runWithChain) possam
                // acionar fallback ou roteamento para outro provider. Antes retornava
                // `{ text: 'Erro LLM Local: ...' }` o que mascarava o erro e impedia fallback.
                throw error;
            }
        }
        try {
            const finalMessages = [
                {
                    role: 'system',
                    content: `Você é um assistente ERP. Responda em Português ao usuário usando SOMENTE os dados coletados abaixo. NÃO chame ferramentas e NÃO retorne JSON. Se os dados não respondem ao pedido, diga isso de forma clara e objetiva e sugira o que falta (ex.: especificar um projeto, cliente ou período).${budgetExhausted ? '\n\n[O orçamento de contexto foi atingido; use SOMENTE os dados abaixo. Se não bastarem para completar o pedido, diga o que faltou coletar.]' : ''}\n\nDADOS COLETADOS:\n${currentContext}`,
                },
                ...currentHistory.map(msg => ({
                    role: msg.role === 'model' ? 'assistant' : msg.role,
                    content: msg.parts,
                })),
            ];
            while (finalMessages.length > 1 && finalMessages[1].role === 'assistant') {
                finalMessages.splice(1, 1);
            }
            const { data: finalData, modelUsed: finalModel, fellBack: finalFellBack } = await this.postChatCompletion(finalMessages, 0.3, options);
            accumulate(finalData?.usage);
            let finalText = stripReasoning(finalData?.choices?.[0]?.message?.content || '');
            // #955: se a síntese vier como tool-calls cruas (o M3 às vezes ignora o "sem
            // ferramentas"), não despeja JSON no usuário → cai na mensagem de fallback abaixo.
            if (finalText && extractToolCalls(finalText).length) finalText = '';
            if (finalText) return { text: finalText, usage: accUsage, contextWindow: ctxWindow, model: finalModel, fellBack: finalFellBack };
        } catch (e: any) {
            log.error('Local LLM final-answer fallback error', e?.message || e);
        }
        return { text: 'Não consegui completar a solicitação com as ferramentas disponíveis. Pode reformular ou dar mais detalhes (ex.: o projeto, cliente ou período)?', usage: accUsage, contextWindow: ctxWindow, model: lastModelUsed, fellBack: lastFellBack };
    }

    async analyzeSystem(query: string, fileContext: string, _module?: string): Promise<string> {
        const prompt = `
            [INST]
            Você é um arquiteto de software sênior.
            Analise o seguinte código e responda a pergunta.

            CÓDIGO:
            ${fileContext}

            PERGUNTA:
            ${query}
            [/INST]
        `;

        try {
            const response = await axios.post(`${this.baseUrl}/chat/completions`, {
                model: this.modelName,
                messages: [
                    { role: 'system', content: 'You are a senior code architect.' },
                    { role: 'user', content: prompt }
                ],
                temperature: 0.2
            }, { headers: this.getHeaders() });
            return response.data.choices[0].message.content;
        } catch (error: any) {
            log.error(`Local LLM Error [analyzeSystem]: ${error.message}`);
            throw error;
        }
    }

    async analyzeSentiment(text: string, _module?: string): Promise<{ score: number; label: string }> {
        const prompt = `
            [INST]
            Analise o sentimento desta mensagem (0-100).
            Responda APENAS JSON: { "score": number, "label": "Positive"|"Neutral"|"Negative" }

            Msg: "${text}"
            [/INST]
        `;

        try {
            const response = await axios.post(`${this.baseUrl}/chat/completions`, {
                model: this.modelName,
                messages: [
                    { role: 'system', content: 'You are a sentiment analyzer. Output only JSON.' },
                    { role: 'user', content: prompt }
                ],
                temperature: 0.1
            }, { headers: this.getHeaders() });
            const content = response.data.choices[0].message.content;
            const jsonStr = content.match(/\{[\s\S]*\}/)?.[0] || "{}";
            return JSON.parse(jsonStr);
        } catch (error: any) {
            log.error(`Local LLM Error [analyzeSentiment]: ${error.message}`);
            throw error;
        }
    }

    async extractCustomerInfo(text: string): Promise<any> {
        const prompt = `
            [INST]
            Extraia dados de cliente: nome, email, telefone, endereco, cpf/cnpj.
            Retorne APENAS JSON.

            Texto: "${text}"
            [/INST]
        `;
        try {
            const response = await axios.post(`${this.baseUrl}/chat/completions`, {
                model: this.modelName,
                messages: [
                    { role: 'system', content: 'You are a data extraction bot. Output only JSON.' },
                    { role: 'user', content: prompt }
                ],
                temperature: 0.1
            }, { headers: this.getHeaders() });
            const content = response.data.choices[0].message.content;
            const jsonStr = content.match(/\{[\s\S]*\}/)?.[0] || "{}";
            return JSON.parse(jsonStr);
        } catch (error: any) {
            log.error(`Local LLM Error [extractCustomerInfo]: ${error.message}`);
            throw error;
        }
    }

    /**
     * Descreve/faz OCR de uma imagem via modelo de visão (glm-4.6v) e retorna TEXTO.
     * Usado pelo generateReply p/ injetar o conteúdo da imagem no loop de tools — o modelo
     * de texto (glm-5.x) não é multimodal, então a imagem era silenciosamente ignorada (#934).
     */
    async describeImage(imageBase64: string, userHint?: string): Promise<string | null> {
        if (!this.visionConfig || !this.apiKey) return null;
        try {
            const clean = imageBase64.replace(/^data:image\/[^;]+;base64,/, "");
            const dataUrl = `data:image/jpeg;base64,${clean}`;
            const prompt = `Analise esta imagem em detalhes, em português.
- Se contiver documento/nota/recibo/etiqueta/tela: extraia TODOS os textos legíveis (OCR), incluindo códigos, referências, quantidades, valores e datas.
- Se contiver produtos/objetos: identifique-os e conte as quantidades visíveis.
- Seja factual; não invente o que não estiver visível.${userHint ? `\nContexto do usuário: ${userHint}` : ''}`;
            const response = await axios.post(`${this.visionConfig.baseUrl}/chat/completions`, {
                model: this.visionConfig.model,
                messages: [{
                    role: 'user',
                    content: [
                        { type: 'text', text: prompt },
                        { type: 'image_url', image_url: { url: dataUrl } },
                    ],
                }],
                temperature: 0.1,
            }, { headers: this.getHeaders(), timeout: 180000 });
            return response.data?.choices?.[0]?.message?.content || null;
        } catch (error: any) {
            const detail = error?.response?.data ? JSON.stringify(error.response.data).slice(0, 300) : error?.message;
            log.error(`describeImage falhou: ${detail}`);
            return null;
        }
    }

    async extractReceiptData(imageBase64: string, _module?: string): Promise<any> {
        // Sem modelo de visão configurado (ex.: Ollama/llama3) -> não suporta; o serviço
        // faz o fallback p/ um provider multimodal (Google).
        if (!this.visionConfig || !this.apiKey) {
            log.warn("LocalProvider sem visão configurada — extractReceiptData indisponível.");
            return null;
        }
        try {
            // Aceita data URL ou base64 puro; normaliza p/ data URL (formato esperado por image_url).
            const clean = imageBase64.replace(/^data:image\/[^;]+;base64,/, "");
            const dataUrl = `data:image/jpeg;base64,${clean}`;

            const prompt = `
            Analyze this receipt image and extract the following JSON data:
            - date (YYYY-MM-DD)
            - vendor (string)
            - total (number)
            - currency (string, e.g. BRL, USD)
            - items: array of objects with:
                - description (full product name/text)
                - quantity (count, default to 1 if not specified)
                - unit_price (price per unit)
                - total_price (line total)
            - category: string (suggested expense category based on items)

            Return ONLY raw JSON.`;

            const response = await axios.post(`${this.visionConfig.baseUrl}/chat/completions`, {
                model: this.visionConfig.model,
                messages: [
                    {
                        role: 'user',
                        content: [
                            { type: 'text', text: prompt },
                            { type: 'image_url', image_url: { url: dataUrl } },
                        ],
                    },
                ],
                temperature: 0.1,
            }, { headers: this.getHeaders(), timeout: 180000 });

            const raw = response.data?.choices?.[0]?.message?.content || "{}";
            const cleanJson = raw.replace(/```json|```/g, '').trim();
            return JSON.parse(cleanJson);
        } catch (error: any) {
            const detail = error?.response
                ? `HTTP ${error.response.status} ${JSON.stringify(error.response.data)?.slice(0, 300)}`
                : (error?.message || String(error));
            log.error(`GLM Vision (extractReceiptData) Error: ${detail}`);
            throw error;
        }
    }

    async analyzeFinancialHealth(data: any, _module?: string): Promise<string> {
        const prompt = `
            [INST]
            Atue como CFO. Analise estes dados financeiros:
            ${JSON.stringify(data)}
            Resumo curto com insights.
            [/INST]
        `;
        try {
            const response = await axios.post(`${this.baseUrl}/chat/completions`, {
                model: this.modelName,
                messages: [
                    { role: 'system', content: 'You are a financial analyst.' },
                    { role: 'user', content: prompt }
                ],
                temperature: 0.3
            }, { headers: this.getHeaders() });
            return response.data.choices[0].message.content;
        } catch (error: any) {
            log.error(`Local LLM Error [analyzeFinancialHealth]: ${error.message}`);
            throw error;
        }
    }

    async fixApiCall(logData: any, context?: string, _module?: string): Promise<string> {
        const prompt = `
            [INST]
            You are a Senior Developer. Analyze this failed API log and fix it.

            CONTEXT:
            ${context ? context.substring(0, 3000) : "N/A"}

            LOG:
            ${JSON.stringify(logData)}

            Provide explanation and fixed code.
            [/INST]
        `;
        try {
            const response = await axios.post(`${this.baseUrl}/chat/completions`, {
                model: this.modelName,
                messages: [
                    { role: 'system', content: 'You are a code debugger.' },
                    { role: 'user', content: prompt }
                ],
                temperature: 0.2
            }, { headers: this.getHeaders() });
            return response.data.choices[0].message.content;
        } catch (error: any) {
            log.error("Local LLM fixApiCall Error", error);
            throw error;
        }
    }

    async generateCode(endpoint: string, method: string, description?: string, context?: string, _module?: string): Promise<string> {
        const prompt = `
            [INST]
            Write TypeScript code for Dolibarr API:
            Endpoint: ${endpoint}
            Method: ${method}
            Desc: ${description}

            Context:
            ${context ? context.substring(0, 2000) : ""}
            [/INST]
        `;
        try {
            const response = await axios.post(`${this.baseUrl}/chat/completions`, {
                model: this.modelName,
                messages: [
                    { role: 'system', content: 'You are a code generator.' },
                    { role: 'user', content: prompt }
                ],
                temperature: 0.1
            }, { headers: this.getHeaders() });
            return response.data.choices[0].message.content;
        } catch (error: any) {
            log.error("Local LLM generateCode Error", error);
            throw error;
        }
    }

    async transcribeAudio(audioBase64: string, mimeType: string = 'audio/ogg', _module?: string): Promise<string> {
        // #936: ASR LOCAL primeiro (whisper.cpp — sem custo/nuvem; infra escolhida pelo usuário).
        // Se o Whisper não estiver instalado ou falhar, cai para o GLM-ASR-2512 (nuvem).
        try {
            const { whisperService } = require('./whisperService');
            if (whisperService.isAvailable()) {
                return await whisperService.transcribe(audioBase64, mimeType);
            }
        } catch (e: any) {
            log.warn(`Whisper local falhou (${e?.message}); tentando GLM-ASR na nuvem.`);
        }

        // Fallback nuvem: GLM-ASR-2512 (Z.AI). Multipart /audio/transcriptions.
        // Cobrado do saldo PaaS (não é do plano Coding); áudio ≤30s/≤25MB por chamada.
        if (!this.apiKey) return "[Transcrição indisponível: chave da IA ausente]";
        try {
            const clean = audioBase64.replace(/^data:audio\/[^;]+;base64,/, "");
            const buffer = Buffer.from(clean, 'base64');
            const ext = (mimeType.split('/')[1] || 'ogg').split(';')[0]; // 'audio/webm;codecs=opus' → 'webm'
            const form = new FormData();
            form.append('model', config.zaiAsrModel);
            form.append('stream', 'false');
            form.append('file', new Blob([buffer], { type: mimeType.split(';')[0] }), `audio.${ext}`);

            const resp = await axios.post(`${config.zaiAsrBaseUrl}/audio/transcriptions`, form, {
                headers: { 'Authorization': `Bearer ${this.apiKey}` },
                timeout: 120000,
            });
            const text = resp.data?.text ?? resp.data?.data?.text ?? '';
            if (typeof text === 'string' && text.trim()) return text.trim();
            log.warn('ASR sem texto na resposta', { keys: Object.keys(resp.data || {}) });
            return "[Áudio não reconhecido]";
        } catch (error: any) {
            const detail = error?.response?.data ? JSON.stringify(error.response.data).slice(0, 200) : error?.message;
            log.error(`transcribeAudio (glm-asr) falhou: ${detail}`);
            if (/1113|insufficient/i.test(String(detail))) {
                return "[Transcrição indisponível: sem saldo PaaS na Z.AI — recarregue para ativar a voz]";
            }
            return "[Erro na transcrição do áudio]";
        }
    }

    // Helper: uma completion de chat (texto). Reusado pelos métodos de análise abaixo.
    private async complete(userPrompt: string, system = 'Você é um assistente útil.', temperature = 0.3): Promise<string> {
        const response = await axios.post(`${this.baseUrl}/chat/completions`, {
            model: this.modelName,
            messages: [
                { role: 'system', content: system },
                { role: 'user', content: userPrompt },
            ],
            temperature,
        }, { headers: this.getHeaders(), timeout: 180000 });
        return response.data?.choices?.[0]?.message?.content || '';
    }

    // --- Métodos de análise (antes só existiam no GoogleProvider; sem eles o GLM caía no
    //     fallback "indisponível"). São geração de texto/JSON — o GLM/local faz bem. (#123) ---

    async draftCollectionEmail(customer: any, amount: number): Promise<string> {
        const prompt = `Você é um especialista em cobranças amigáveis. Escreva um e-mail de cobrança profissional e cordial em Português do Brasil.\nCLIENTE: ${customer?.name || 'Cliente'} | Valor em aberto: R$ ${Number(amount || 0).toFixed(2)}\nRetorne APENAS um JSON: { "subject": "...", "body": "..." }`;
        try {
            const raw = await this.complete(prompt, 'Output only JSON.', 0.4);
            return raw.match(/\{[\s\S]*\}/)?.[0] || JSON.stringify({ subject: 'Lembrete de Pagamento', body: raw });
        } catch (e: any) {
            log.error('LocalProvider draftCollectionEmail Error', e?.message || e);
            throw e;
        }
    }

    async generateSalesForecast(invoices: any[], context?: any, _module?: string): Promise<string> {
        // #915: série mensal agregada (context.timeSeries do frontend, ou agrega cru — cron).
        const series: MonthlyRevenuePoint[] = Array.isArray(context?.timeSeries) && context.timeSeries.length
            ? context.timeSeries
            : aggregateInvoicesToMonthlySeries(invoices);
        const refDate = context?.referenceDate ? new Date(context.referenceDate).toLocaleDateString('pt-BR') : 'Data Atual';
        const prompt = `Atue como analista financeiro sênior (sazonalidade e previsão de vendas).
DATA DE REFERÊNCIA (HOJE): ${refDate} (o mês atual está incompleto: faça o "landing" = realizado + projeção dos dias restantes).
METODOLOGIA: 1) mês atual = realizado + tendência; 2) próximos meses por sazonalidade (anos anteriores); 3) ajuste pela média dos últimos 6 meses.
DADOS (série mensal agregada, [{period:"AAAA-MM",revenue,count}]): ${JSON.stringify(series)}
Retorne APENAS JSON: { "forecast": [ { "month": "Nome Mês Ano", "predicted_revenue": 0.00, "confidence": "high|medium|low" } ], "summary": "lógica usada", "trend": "up|down|stable" } (3 meses)`;
        try {
            const raw = await this.complete(prompt, 'Output only JSON.', 0.3);
            return raw.match(/\{[\s\S]*\}/)?.[0] || JSON.stringify({ forecast: [], summary: 'Sem dados suficientes.' });
        } catch (e: any) {
            log.error('LocalProvider generateSalesForecast Error', e?.message || e);
            throw e;
        }
    }

    async analyzeCustomerSentiment(customer: any, invoices: any[], _module?: string): Promise<string> {
        const relevant = (invoices || []).slice(0, 20).map((i) => ({ ref: i.ref, total: i.total_ttc, status: i.status, date: i.date }));
        const prompt = `Analise o relacionamento com este cliente.\nCLIENTE: ${customer?.name} | Status: ${customer?.status} | Desde: ${customer?.date_creation || 'N/A'}\nFATURAS: ${JSON.stringify(relevant)}\nRetorne APENAS JSON: { "score": 0-100, "label": "Positive|Neutral|Negative|At Risk", "insights": "...", "recommendations": ["..."] }`;
        try {
            const raw = await this.complete(prompt, 'Output only JSON.', 0.3);
            return raw.match(/\{[\s\S]*\}/)?.[0] || JSON.stringify({ score: 50, label: 'Neutral', insights: 'Sem dados.' });
        } catch (e: any) {
            log.error('LocalProvider analyzeCustomerSentiment Error', e?.message || e);
            throw e;
        }
    }

    async auditProposal(proposal: any): Promise<string> {
        const prompt = `Você é um auditor de propostas comerciais. Analise e aponte problemas/melhorias.\nPROPOSTA: ${JSON.stringify(proposal)}\nRetorne APENAS JSON: { "score": 0-100, "status": "Aprovada|Revisar|Rejeitada", "issues": ["..."], "suggestions": ["..."], "summary": "..." }`;
        try {
            const raw = await this.complete(prompt, 'Output only JSON.', 0.3);
            return raw.match(/\{[\s\S]*\}/)?.[0] || JSON.stringify({ score: 0, issues: ['Sem dados.'] });
        } catch (e: any) {
            log.error('LocalProvider auditProposal Error', e?.message || e);
            throw e;
        }
    }

    async auditProject(project: any, tasks?: any[], projectInvoices?: any[], _module?: string): Promise<string> {
        const prompt = `Você é um gerente de projetos experiente. Analise a saúde do projeto e riscos.\nPROJETO: ${JSON.stringify(project)}\nTAREFAS (${tasks?.length || 0}): ${JSON.stringify(tasks?.slice(0, 20) || [])}\nFATURAS (${projectInvoices?.length || 0}): ${JSON.stringify(projectInvoices?.slice(0, 10) || [])}\nRetorne APENAS JSON: { "health": "Saudável|Atenção|Crítico", "score": 0-100, "risks": ["..."], "recommendations": ["..."], "summary": "..." }`;
        try {
            const raw = await this.complete(prompt, 'Output only JSON.', 0.3);
            return raw.match(/\{[\s\S]*\}/)?.[0] || JSON.stringify({ health: 'unknown', issues: ['Sem dados.'] });
        } catch (e: any) {
            log.error('LocalProvider auditProject Error', e?.message || e);
            throw e;
        }
    }

    async analyzeSystemLogs(logs: any[], _module?: string): Promise<string> {
        const summary = (logs || []).slice(0, 50).map((l) => ({ type: l.endpoint_or_task || l.type, status: l.status, duration: l.duration_ms, error: l.error_message }));
        const prompt = `Você é especialista em otimização de sistemas. Analise estes logs de API e sugira otimizações.\nLOGS: ${JSON.stringify(summary)}\nRetorne APENAS um JSON array: [ { "type": "error|performance|pattern", "title": "...", "description": "...", "suggestion": "...", "priority": "high|medium|low" } ]`;
        try {
            const raw = await this.complete(prompt, 'Output only a JSON array.', 0.3);
            return raw.match(/\[[\s\S]*\]/)?.[0] || '[]';
        } catch (e: any) {
            log.error('LocalProvider analyzeSystemLogs Error', e?.message || e);
            throw e;
        }
    }

    async analyzeMonthlyReport(data: any): Promise<string> {
        const prompt = `Atue como um CFO e COO experiente gerando o RELATÓRIO MENSAL EXECUTIVO para a diretoria.
DADOS DO MÊS: ${JSON.stringify(data, null, 2)}
Escreva um resumo executivo profissional em Markdown com as seções: ## 1. Resumo Executivo, ## 2. Destaques Financeiros, ## 3. Performance Comercial, ## 4. Eficiência Operacional & RH, ## 5. Recomendações Estratégicas (3-5 ações). Tom profissional e focado em insights, com negrito e listas.`;
        try {
            const text = await this.complete(prompt, 'Você é um CFO/COO experiente. Responda em Markdown.', 0.4);
            return text || 'Não foi possível gerar o relatório.';
        } catch (e: any) {
            log.error('LocalProvider analyzeMonthlyReport Error', e?.message || e);
            throw e;
        }
    }
}

// --- Service Factory ---

let defaultProvider: AIProvider | null = null;

const glmVisionConfig = (apiKey?: string) => apiKey
    ? { baseUrl: (config as any).zaiVisionBaseUrl || 'https://api.z.ai/api/paas/v4', model: (config as any).zaiVisionModel || 'glm-4.6v' }
    : undefined;

// Fallback de texto p/ o GLM: MiniMax M3 (quando há chave configurada). Acionado em 429/timeout/5xx.
// Prefere a Subscription Key do plano (créditos da assinatura) — a API key pay-as-you-go
// estava zerada e deixava o fallback GLM→M3 silenciosamente quebrado (mesma confusão de
// carteiras do TTS/#942). Fallback pra API key se a do plano não estiver configurada.
const minimaxKey = () => config.minimaxMediaKey || config.minimaxApiKey;
const minimaxFallbackConfig = () => (minimaxKey() && config.minimaxBaseUrl)
    ? { baseUrl: config.minimaxBaseUrl, model: config.minimaxModel, apiKey: minimaxKey() }
    : undefined;

function createProvider(name: string, url?: string, key?: string, modelName?: string): AIProvider {
    if (name === 'google') return new GoogleProvider(key || config.googleApiKey, modelName);
    if (name === 'glm') return new LocalProvider(url || config.zaiBaseUrl, modelName || config.zaiModel, key || config.zaiApiKey, glmVisionConfig(key || config.zaiApiKey), minimaxFallbackConfig());
    if (name === 'minimax') return new LocalProvider(url || config.minimaxBaseUrl, modelName || config.minimaxModel, key || minimaxKey());
    return new LocalProvider(url || config.localLlmUrl, modelName || config.localModelName);
}

const getProvider = (specificProviderName?: string): AIProvider => {
    if (specificProviderName) {
        return createProvider(specificProviderName);
    }

    if (!defaultProvider) {
        defaultProvider = createProvider(config.llmProvider);
    }
    return defaultProvider;
};

// --- Roteamento por capacidade (#57 Peça 3) ---
// GLM/MiniMax/local (LocalProvider) são text-only neste código: visão e áudio
// só funcionam no GoogleProvider. Quando a ENTRADA exige uma capacidade que o
// provider de texto configurado não tem, roteamos APENAS essa chamada para um
// provider multimodal (Google), mantendo o GLM/local para texto.
const providerSupportsVision = (p: AIProvider): boolean => p instanceof GoogleProvider;
// #936: LocalProvider agora transcreve via GLM-ASR-2512 (Z.AI) — não precisa mais do Google.
const providerSupportsAudio = (p: AIProvider): boolean => p instanceof GoogleProvider || p instanceof LocalProvider;

// Provider multimodal de fallback (hoje só o Google). null se não houver chave.
const getMultimodalProvider = (): AIProvider | null => {
    if (config.googleApiKey) return new GoogleProvider(config.googleApiKey);
    return null;
};

/**
 * Executa `exec(provider)` percorrendo a cadeia de fallback do módulo.
 * Pula providers indisponíveis (em cooldown no LlmHealthService).
 * Em erro de cota/infra registra no LlmHealthService e tenta o próximo.
 * Sucesso registra recordSuccess e retorna o resultado.
 * Se todos falharem, lança o último erro.
 * Registra `chain` e `activeIndex` no llmCallLogService ao encerrar.
 *
 * NUNCA modifica postChatCompletion — é uma camada ACIMA do provider.
 */
async function runWithChain<T>(
    moduleName: string,
    exec: (provider: string) => Promise<T>,
): Promise<T> {
    const chain = _configService.getFallbackChain(moduleName);
    let lastErr: any;
    let activeIndex = -1;

    for (let i = 0; i < chain.length; i++) {
        const provider = chain[i];
        if (!llmHealthService.isAvailable(provider)) {
            log.warn(`runWithChain[${moduleName}]: provider '${provider}' em cooldown — pulando.`);
            continue;
        }
        try {
            const result = await exec(provider);
            llmHealthService.recordSuccess(provider);
            activeIndex = i;
            // Registra encerramento da cadeia (aditivo ao log individual do provider)
            try {
                llmCallLogService.record({
                    model: provider,
                    primaryModel: chain[0],
                    fellBack: i > 0,
                    ok: true,
                    latencyMs: 0,
                    origin: moduleName,
                    chain,
                    activeIndex,
                });
            } catch { /* observabilidade não quebra chamada */ }
            return result;
        } catch (err: any) {
            const detail = err?.response
                ? `HTTP ${err.response.status} ${JSON.stringify(err.response.data || '').slice(0, 200)}`
                : (err?.code || err?.message || String(err));

            if (isQuotaError(detail)) {
                llmHealthService.recordQuotaError(provider, err);
            } else {
                llmHealthService.recordTransientError(provider, err);
            }
            lastErr = err;
            log.warn(`runWithChain[${moduleName}]: provider '${provider}' falhou [${detail.slice(0, 120)}] — tentando próximo.`);
        }
    }

    // Todos falharam
    try {
        llmCallLogService.record({
            model: chain[chain.length - 1] ?? moduleName,
            primaryModel: chain[0] ?? moduleName,
            fellBack: chain.length > 1,
            ok: false,
            latencyMs: 0,
            origin: moduleName,
            chain,
            activeIndex: -1,
            errorDetail: lastErr?.message?.slice(0, 300),
        });
    } catch { /* observabilidade não quebra */ }

    throw lastErr ?? new Error(`runWithChain[${moduleName}]: todos os providers falharam`);
}

/**
 * Probe leve: testa se o provider responde (sem backoff de 2-32s).
 * Usado pelo taskRunner para sondagem periódica de disponibilidade.
 * Retorna true se o provider respondeu com qualquer texto, false caso contrário.
 */
async function probeProvider(provider: string): Promise<boolean> {
    try {
        const p = createProvider(provider);
        // Chamada mínima: pergunta trivial com timeout curto (10s)
        if ('generateReply' in p) {
            const probe = p as AIProvider;
            // Usa axios diretamente para um probe com timeout curto sem o backoff do postChatCompletion
            if (p instanceof LocalProvider) {
                const baseUrl = (p as any).baseUrl as string;
                const headers: Record<string, string> = { 'Content-Type': 'application/json' };
                const apiKey = (p as any).apiKey as string | undefined;
                if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
                const model = (p as any).modelName as string;
                await axios.post(`${baseUrl}/chat/completions`, {
                    model,
                    messages: [{ role: 'user', content: 'ping' }],
                    max_tokens: 1,
                    temperature: 0,
                }, { headers, timeout: 10000 });
                return true;
            }
            // Para GoogleProvider: analisa sentimento de "ping" (leve)
            if (p instanceof GoogleProvider) {
                await probe.analyzeSentiment('ping');
                return true;
            }
        }
        return false;
    } catch {
        return false;
    }
}

export const aiService = {
    setConfig: (providerName: 'local' | 'google' | 'glm' | 'minimax', url?: string, key?: string, modelName?: string) => {
        defaultProvider = createProvider(providerName, url, key, modelName);
        log.info(`AI Provider set to: ${providerName} (Model: ${modelName})`);
    },

    /** Expõe runWithChain para uso externo (ex.: taskRunner, testes). */
    runWithChain,

    /** Expõe probeProvider para uso externo (ex.: taskRunner health check). */
    probeProvider,

    getModels: async () => {
        const provider = getProvider();
        if (provider.getModels) {
            return await provider.getModels();
        }
        return [];
    },

    generateReply: async (conversationHistory: ChatMessage[], context: string, imageBase64?: string | string[], moduleName: string = 'chat') => {
        // Injeta o endereço público (cloudflared) no contexto -> o agente sabe responder "qual o endereço de acesso?".
        try {
            const tunnelUrl = require('./tunnelService').tunnelService.getUrl();
            if (tunnelUrl) context = `${context}\n[INFRA] Endereço de acesso público atual (cloudflared): ${tunnelUrl}`;
        } catch { /* ignore */ }

        const configService = _configService;

        if (configService.isRunWithChainEnabled()) {
            return runWithChain(moduleName, (providerName) => {
                const moduleConfig = configService.getModuleConfig(moduleName);
                const modelName = moduleConfig.model;
                let specificProvider = getProvider(providerName);
                if (imageBase64 && !providerSupportsVision(specificProvider)) {
                    const mm = getMultimodalProvider();
                    if (mm) return mm.generateReply(conversationHistory, context, imageBase64, { provider: 'google', model: config.geminiModel, origin: moduleName });
                }
                return specificProvider.generateReply(conversationHistory, context, imageBase64, { provider: providerName, model: modelName, origin: moduleName });
            });
        }

        const moduleConfig = configService.getModuleConfig(moduleName);
        const providerName = moduleConfig.provider || config.llmProvider;
        const modelName = moduleConfig.model;
        let specificProvider = getProvider(providerName);
        if (!specificProvider) specificProvider = getProvider();

        if (imageBase64 && !providerSupportsVision(specificProvider)) {
            const mm = getMultimodalProvider();
            if (mm) {
                log.info(`generateReply: imagem presente e provider '${providerName}' sem visão -> roteando para Google.`);
                return mm.generateReply(conversationHistory, context, imageBase64, { provider: 'google', model: config.geminiModel, origin: moduleName });
            }
            log.warn(`generateReply: imagem presente mas nenhum provider com visão disponível (sem googleApiKey) -> seguindo com '${providerName}'.`);
        }

        return specificProvider.generateReply(conversationHistory, context, imageBase64, { provider: providerName, model: modelName, origin: moduleName });
    },

    analyzeSystem: async (query: string, rootPath: string = '../src', module: string = 'system_analysis') => {
        const configService = _configService;
        const fileContext = await readSystemContext(rootPath);
        if (configService.isRunWithChainEnabled()) {
            return runWithChain(module, (p) => getProvider(p).analyzeSystem(query, fileContext, module));
        }
        return getProvider().analyzeSystem(query, fileContext, module);
    },

    analyzeSentiment: async (message: string, module: string = 'chat') => {
        const configService = _configService;
        if (configService.isRunWithChainEnabled()) {
            return runWithChain(module, (p) => getProvider(p).analyzeSentiment(message, module));
        }
        return getProvider().analyzeSentiment(message, module);
    },

    extractReceiptData: async (imageBase64: string, module: string = 'banking') => {
        // OCR de recibo: GLM-4.6V (LocalProvider com visão) atende direto;
        // se sem visão, roteia p/ Google. Não usa runWithChain pois depende de visão.
        let provider = getProvider();
        const canVision = providerSupportsVision(provider)
            || (typeof (provider as any).supportsVision === 'function' && (provider as any).supportsVision());
        if (!canVision) {
            const mm = getMultimodalProvider();
            if (mm) {
                log.info("extractReceiptData: provider de texto sem visão -> roteando para Google.");
                provider = mm;
            }
        }
        return provider.extractReceiptData(imageBase64, module);
    },

    // Descrição livre de imagem (OCR + o que a imagem mostra), via provider com visão (GLM-4.6V).
    // Usado pelo TaskRunner p/ o coder entender um alvo indicado por imagem na issue. null se sem visão.
    describeImage: async (imageBase64: string, userHint?: string): Promise<string | null> => {
        let provider: any = getProvider();
        const canVision = providerSupportsVision(provider)
            || (typeof provider.supportsVision === 'function' && provider.supportsVision());
        if (!canVision) {
            const mm = getMultimodalProvider();
            if (mm) provider = mm;
        }
        if (typeof provider.describeImage !== 'function') return null;
        return provider.describeImage(imageBase64, userHint);
    },

    extractCustomerInfo: async (text: string, module: string = 'chat') => {
        const configService = _configService;
        if (configService.isRunWithChainEnabled()) {
            return runWithChain(module, (p) => getProvider(p).extractCustomerInfo(text, module));
        }
        return getProvider().extractCustomerInfo(text, module);
    },

    analyzeFinancialHealth: async (data: any, module: string = 'banking') => {
        const configService = _configService;
        if (configService.isRunWithChainEnabled()) {
            return runWithChain(module, (p) => getProvider(p).analyzeFinancialHealth(data, module));
        }
        return getProvider().analyzeFinancialHealth(data, module);
    },

    fixApiCall: async (logData: any, module: string = 'system_analysis') => {
        const configService = _configService;
        const context = await readSystemContext('../src');
        if (configService.isRunWithChainEnabled()) {
            return runWithChain(module, (p) => getProvider(p).fixApiCall(logData, context, module));
        }
        return getProvider().fixApiCall(logData, context, module);
    },

    generateCode: async (endpoint: string, method: string, description?: string, module: string = 'system_analysis') => {
        const configService = _configService;
        const context = await readSystemContext('../src');
        if (configService.isRunWithChainEnabled()) {
            return runWithChain(module, (p) => getProvider(p).generateCode(endpoint, method, description, context, module));
        }
        return getProvider().generateCode(endpoint, method, description, context, module);
    },

    transcribeAudio: async (audioBase64: string, mimeType: string = 'audio/ogg', module: string = 'chat') => {
        // Áudio: se o provider de texto (GLM/local) não transcreve, roteia p/ Google.
        // Não usa runWithChain pois depende de capacidade multimodal específica.
        let provider = getProvider();
        if (!providerSupportsAudio(provider)) {
            const mm = getMultimodalProvider();
            if (mm) {
                log.info("transcribeAudio: provider de texto sem áudio -> roteando para Google.");
                provider = mm;
            }
        }
        if ('transcribeAudio' in provider) {
            return (provider as any).transcribeAudio(audioBase64, mimeType, module);
        }
        throw new Error('Transcrição não disponível neste provider');
    },

    draftCollectionEmail: async (customer: any, amount: number, module: string = 'banking') => {
        const configService = _configService;
        if (configService.isRunWithChainEnabled()) {
            return runWithChain(module, (p) => {
                const pr = getProvider(p);
                if (!('draftCollectionEmail' in pr && pr.draftCollectionEmail)) throw new Error('draftCollectionEmail indisponível');
                return pr.draftCollectionEmail!(customer, amount, module);
            });
        }
        const provider = getProvider();
        if ('draftCollectionEmail' in provider && provider.draftCollectionEmail) {
            return provider.draftCollectionEmail(customer, amount, module);
        }
        throw new Error('draftCollectionEmail não disponível neste provider');
    },

    generateSalesForecast: async (invoices: any[], context?: any, module: string = 'banking') => {
        const configService = _configService;
        if (configService.isRunWithChainEnabled()) {
            return runWithChain(module, (p) => {
                const pr = getProvider(p);
                if (!('generateSalesForecast' in pr && pr.generateSalesForecast)) throw new Error('generateSalesForecast indisponível');
                return pr.generateSalesForecast!(invoices, context, module);
            });
        }
        const provider = getProvider();
        if ('generateSalesForecast' in provider && provider.generateSalesForecast) {
            return provider.generateSalesForecast(invoices, context, module);
        }
        throw new Error('generateSalesForecast não disponível neste provider');
    },

    analyzeCustomerSentiment: async (customer: any, invoices: any[], module: string = 'banking') => {
        const configService = _configService;
        if (configService.isRunWithChainEnabled()) {
            return runWithChain(module, (p) => {
                const pr = getProvider(p);
                if (!('analyzeCustomerSentiment' in pr && pr.analyzeCustomerSentiment)) throw new Error('analyzeCustomerSentiment indisponível');
                return pr.analyzeCustomerSentiment!(customer, invoices, module);
            });
        }
        const provider = getProvider();
        if ('analyzeCustomerSentiment' in provider && provider.analyzeCustomerSentiment) {
            return provider.analyzeCustomerSentiment(customer, invoices, module);
        }
        throw new Error('analyzeCustomerSentiment não disponível neste provider');
    },

    auditProposal: async (proposal: any, module: string = 'proposals') => {
        const configService = _configService;
        if (configService.isRunWithChainEnabled()) {
            return runWithChain(module, (p) => {
                const pr = getProvider(p);
                if (!('auditProposal' in pr && pr.auditProposal)) throw new Error('auditProposal indisponível');
                return pr.auditProposal!(proposal, module);
            });
        }
        const provider = getProvider();
        if ('auditProposal' in provider && provider.auditProposal) {
            return provider.auditProposal(proposal, module);
        }
        throw new Error('auditProposal não disponível neste provider');
    },

    auditProject: async (project: any, tasks?: any[], projectInvoices?: any[], module: string = 'proposals') => {
        const configService = _configService;
        if (configService.isRunWithChainEnabled()) {
            return runWithChain(module, (p) => {
                const pr = getProvider(p);
                if (!('auditProject' in pr && pr.auditProject)) throw new Error('auditProject indisponível');
                return pr.auditProject!(project, tasks, projectInvoices, module);
            });
        }
        const provider = getProvider();
        if ('auditProject' in provider && provider.auditProject) {
            return provider.auditProject(project, tasks, projectInvoices, module);
        }
        throw new Error('auditProject não disponível neste provider');
    },

    analyzeSystemLogs: async (logs: any[], module: string = 'system_analysis') => {
        const configService = _configService;
        if (configService.isRunWithChainEnabled()) {
            return runWithChain(module, (p) => {
                const pr = getProvider(p);
                if (!('analyzeSystemLogs' in pr && pr.analyzeSystemLogs)) throw new Error('analyzeSystemLogs indisponível');
                return pr.analyzeSystemLogs!(logs, module);
            });
        }
        const provider = getProvider();
        if ('analyzeSystemLogs' in provider && provider.analyzeSystemLogs) {
            return provider.analyzeSystemLogs(logs, module);
        }
        throw new Error('analyzeSystemLogs não disponível neste provider');
    },

    analyzeMonthlyReport: async (data: any, module: string = 'system_analysis') => {
        const configService = _configService;
        if (configService.isRunWithChainEnabled()) {
            return runWithChain(module, (p) => {
                const pr = getProvider(p);
                if (!('analyzeMonthlyReport' in pr && pr.analyzeMonthlyReport)) throw new Error('analyzeMonthlyReport indisponível');
                return pr.analyzeMonthlyReport!(data, module);
            });
        }
        const provider = getProvider();
        if ('analyzeMonthlyReport' in provider && provider.analyzeMonthlyReport) {
            return provider.analyzeMonthlyReport(data, module);
        }
        throw new Error('analyzeMonthlyReport não disponível neste provider');
    }
};

// --- Helper Functions ---

async function readSystemContext(rootPath: string): Promise<string> {
    const filesToRead = [
        'src/types.ts',
        'src/services/dolibarrService.ts',
        'backend/src/server.ts',
        'backend/src/routes/dolibarrRoutes.ts'
    ];

    let context = "";
    const projectRoot = path.resolve(__dirname, '../../../');

    for (const relativePath of filesToRead) {
        try {
            const fullPath = path.join(projectRoot, relativePath);
            const content = await fs.readFile(fullPath, 'utf-8');
            context += `\n--- FILE: ${relativePath} ---\n${content.substring(0, 5000)}\n`;
        } catch (e) {
        }
    }
    return context;
}
