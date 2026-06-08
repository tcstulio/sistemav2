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
}

interface AIProvider {
    generateReply(conversationHistory: ChatMessage[], context: string, imageBase64?: string, options?: { provider?: string, model?: string }): Promise<GenerateReplyResult>;
    analyzeSystem(query: string, fileContext: string, options?: { provider?: string, model?: string }): Promise<string>;
    analyzeSentiment(text: string): Promise<{ score: number; label: string }>;
    extractCustomerInfo(text: string): Promise<any>;
    extractReceiptData(imageBase64: string): Promise<any>;
    analyzeFinancialHealth(data: any): Promise<string>;
    fixApiCall(logData: any, context?: string): Promise<string>;
    generateCode(endpoint: string, method: string, description?: string, context?: string): Promise<string>;
    getModels?(): Promise<string[]>;
    // New methods
    draftCollectionEmail?(customer: any, amount: number): Promise<string>;
    generateSalesForecast?(invoices: any[], context?: any): Promise<string>;
    analyzeCustomerSentiment?(customer: any, invoices: any[]): Promise<string>;
    auditProposal?(proposal: any): Promise<string>;
    auditProject?(project: any, tasks?: any[], projectInvoices?: any[]): Promise<string>;
    analyzeSystemLogs?(logs: any[]): Promise<string>;
    analyzeMonthlyReport?(data: any): Promise<string>;
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

    async generateReply(conversationHistory: ChatMessage[], context: string, imageBase64?: string, options?: { provider?: string, model?: string }): Promise<GenerateReplyResult> {
        if (!this.ai) {
            log.error('Google AI not configured.');
            throw new Error("Google AI not configured.");
        }

        const toolsPrompt = TOOLS_PROMPT;

        let currentHistory = [...conversationHistory];
        let currentContext = context;
        let iterations = 0;
        const MAX_ITERATIONS = 5;
        const accUsage: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

        while (iterations < MAX_ITERATIONS) {

            // Format history
            const historyText = currentHistory.map(msg =>
                `${msg.role.toUpperCase()}: ${msg.parts}`
            ).join('\n');

            const agentPrompt = agentConfigService.getSystemPrompt();
            const prompt = `
                Você é o Marciano — o agente de inteligência artificial do CoolGroove System (ERP Dolibarr).
                Responda de forma prestativa, profissional e concisa em Português do Brasil.
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

            // Build content
            let contents: any;
            if (imageBase64 && iterations === 0) {
                const cleanBase64 = imageBase64.replace(/^data:image\/(png|jpeg|jpg|webp);base64,/, "");
                contents = [
                    {
                        role: 'user',
                        parts: [
                            { text: prompt },
                            { inlineData: { data: cleanBase64, mimeType: "image/jpeg" } }
                        ]
                    }
                ];
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

                    const toolResult = await executeTool(toolCall.tool, toolCall.args || {});

                    if (String(toolCall.tool).startsWith('prepare_')) {
                        return { text: toolResult, usage: accUsage };
                    }

                    currentContext += `\n\n[DADOS OBTIDOS VIA ${toolCall.tool}]:\n${toolResult}\n`;

                    iterations++;
                    continue;

                } catch (e: any) {
                    if (e.name === 'AskUserInterrupt') {
                        return { text: e.question, usage: accUsage };
                    }
                    log.error("Tool execution failed", e);
                    currentContext += `\n\n[ERRO NA EXECUÇÃO]: ${e.message}\n`;
                    iterations++;
                    continue;
                }
            }

            // No tool call, return final response
            return { text: textResponse, usage: accUsage };
        }

        return { text: "Desculpe, não consegui obter todas as informações necessárias após várias tentativas.", usage: accUsage };
    }

    async draftCollectionEmail(customer: any, amount: number): Promise<string> {
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

    async generateSalesForecast(invoices: any[], context?: any): Promise<string> {
        if (!this.ai) return JSON.stringify({ forecast: [], summary: "IA não configurada" });

        // Group invoices by Month/Year for clearer token usage if needed, 
        // but raw list is fine if not too huge. The frontend already filters relevant ones.

        const invoicesSummary = invoices.map(i => ({
            d: i.date || i.datec,
            v: i.total_ttc,
            s: i.status
        }));

        log.debug("Received Context", context);
        log.debug(`Computed Ref Date String: ${new Date(context?.referenceDate).toLocaleDateString('pt-BR')}`);
        log.debug(`Invoice Count: ${invoicesSummary.length}`);
        if (invoicesSummary.length > 0) {
            log.debug(`Last Invoice Date: ${invoicesSummary[invoicesSummary.length - 1].d}`);
        }

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

            DADOS (Faturas Selecionadas - Recentes + Sazonalidade Histórica):
            ${JSON.stringify(invoicesSummary)}

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

    async analyzeCustomerSentiment(customer: any, invoices: any[]): Promise<string> {
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

    async auditProposal(proposal: any): Promise<string> {
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

    async auditProject(project: any, tasks?: any[], projectInvoices?: any[]): Promise<string> {
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

    async analyzeSystemLogs(logs: any[]): Promise<string> {
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

export class LocalProvider implements AIProvider {
    private baseUrl: string;
    private modelName: string;
    private apiKey?: string;
    // Config opcional de VISÃO (ex.: GLM-4.6V). Quando presente, o provider passa a
    // suportar OCR/análise de imagem direto (sem fallback p/ Google). Usa uma base
    // própria pois o modelo multimodal vive em endpoint diferente do de texto.
    private visionConfig?: { baseUrl: string; model: string };

    constructor(baseUrl: string, modelName: string = 'llama3', apiKey?: string, visionConfig?: { baseUrl: string; model: string }) {
        this.baseUrl = (baseUrl || '').replace(/\/+$/, ''); // remove barra final -> evita //chat/completions
        this.modelName = modelName;
        this.apiKey = apiKey;
        this.visionConfig = visionConfig && visionConfig.baseUrl
            ? { baseUrl: visionConfig.baseUrl.replace(/\/+$/, ''), model: visionConfig.model }
            : undefined;
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

    async generateReply(conversationHistory: ChatMessage[], context: string, imageBase64?: string, options?: { provider?: string, model?: string }): Promise<GenerateReplyResult> {
        const toolsPrompt = TOOLS_PROMPT;

        let currentHistory = [...conversationHistory];
        let currentContext = context;
        let iterations = 0;
        const MAX_ITERATIONS = 5;
        const seenToolCalls = new Set<string>();
        const accUsage: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

        const accumulate = (usage: any) => {
            if (!usage) return;
            accUsage.promptTokens += usage.prompt_tokens || 0;
            accUsage.completionTokens += usage.completion_tokens || 0;
            accUsage.totalTokens += usage.total_tokens || 0;
        };

        while (iterations < MAX_ITERATIONS) {
            const agentPrompt = agentConfigService.getSystemPrompt();
            let messages = [
                { role: 'system', content: `Você é o Marciano — agente IA do CoolGroove System (ERP Dolibarr). Use Português. ${agentPrompt ? '\n' + agentPrompt : ''}\n\nCONTEXTO: ${currentContext}\n\n${toolsPrompt}` },
                ...currentHistory.map(msg => ({
                    role: msg.role === 'model' ? 'assistant' : msg.role,
                    content: msg.parts
                }))
            ];

            while (messages.length > 1 && messages[1].role === 'assistant') {
                messages.splice(1, 1);
            }

            try {
                const response = await axios.post(`${this.baseUrl}/chat/completions`, {
                    model: options?.model || this.modelName,
                    messages: messages,
                    temperature: 0.5
                }, {
                    headers: this.getHeaders(),
                    timeout: 120000
                });

                accumulate(response.data.usage);

                const reply = response.data.choices[0].message.content;

                const toolCall = extractToolCall(reply);

                if (toolCall) {
                    try {
                        log.info(`Local LLM Tool Call: ${toolCall.tool}`, toolCall.args);

                        const callSig = `${toolCall.tool}:${JSON.stringify(toolCall.args || {})}`;
                        if (seenToolCalls.has(callSig)) break;
                        seenToolCalls.add(callSig);

                        const toolResult = await executeTool(toolCall.tool, toolCall.args || {});

                        if (String(toolCall.tool).startsWith('prepare_')) {
                            return { text: toolResult, usage: accUsage };
                        }

                        currentContext += `\n\n[TOOL RESULT]: ${toolResult}`;
                        iterations++;
                        continue;

                    } catch (e: any) {
                        if (e.name === 'AskUserInterrupt') {
                            return { text: e.question, usage: accUsage };
                        }
                        log.error("Local LLM Tool Error", e);
                        return { text: reply, usage: accUsage };
                    }
                }

                return { text: reply, usage: accUsage };

            } catch (error: any) {
                const detail = error?.response
                    ? `HTTP ${error.response.status} ${JSON.stringify(error.response.data)?.slice(0, 300)}`
                    : (error?.code || error?.message || String(error));
                log.error(`Local LLM Error [url=${this.baseUrl}/chat/completions model=${this.modelName}]: ${detail}`);
                return { text: `Erro LLM Local: ${detail}`, usage: accUsage };
            }
        }
        try {
            const finalMessages = [
                {
                    role: 'system',
                    content: `Você é um assistente ERP. Responda em Português ao usuário usando SOMENTE os dados coletados abaixo. NÃO chame ferramentas e NÃO retorne JSON. Se os dados não respondem ao pedido, diga isso de forma clara e objetiva e sugira o que falta (ex.: especificar um projeto, cliente ou período).\n\nDADOS COLETADOS:\n${currentContext}`,
                },
                ...currentHistory.map(msg => ({
                    role: msg.role === 'model' ? 'assistant' : msg.role,
                    content: msg.parts,
                })),
            ];
            while (finalMessages.length > 1 && finalMessages[1].role === 'assistant') {
                finalMessages.splice(1, 1);
            }
            const finalResp = await axios.post(`${this.baseUrl}/chat/completions`, {
                model: options?.model || this.modelName,
                messages: finalMessages,
                temperature: 0.3,
            }, { headers: this.getHeaders(), timeout: 120000 });
            accumulate(finalResp.data?.usage);
            const finalText = finalResp.data?.choices?.[0]?.message?.content;
            if (finalText) return { text: finalText, usage: accUsage };
        } catch (e: any) {
            log.error('Local LLM final-answer fallback error', e?.message || e);
        }
        return { text: 'Não consegui completar a solicitação com as ferramentas disponíveis. Pode reformular ou dar mais detalhes (ex.: o projeto, cliente ou período)?', usage: accUsage };
    }

    async analyzeSystem(query: string, fileContext: string): Promise<string> {
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
            log.error(`Local LLM Error: ${error.message}`);
            return "Erro ao conectar com LLM Local.";
        }
    }

    async analyzeSentiment(text: string): Promise<{ score: number; label: string }> {
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
            log.error(`Local LLM Error: ${error.message}`);
            return { score: 50, label: 'Error' };
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
            log.error(`Local LLM Error: ${error.message}`);
            return {};
        }
    }

    async extractReceiptData(imageBase64: string): Promise<any> {
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
            }, { headers: this.getHeaders(), timeout: 120000 });

            const raw = response.data?.choices?.[0]?.message?.content || "{}";
            const cleanJson = raw.replace(/```json|```/g, '').trim();
            return JSON.parse(cleanJson);
        } catch (error: any) {
            const detail = error?.response
                ? `HTTP ${error.response.status} ${JSON.stringify(error.response.data)?.slice(0, 300)}`
                : (error?.message || String(error));
            log.error(`GLM Vision (extractReceiptData) Error: ${detail}`);
            return null;
        }
    }

    async analyzeFinancialHealth(data: any): Promise<string> {
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
            log.error(`Local LLM Error: ${error.message}`);
            return "Erro ao gerar análise financeira local.";
        }
    }

    async fixApiCall(logData: any, context?: string): Promise<string> {
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
            return "Local diagnosis failed.";
        }
    }

    async generateCode(endpoint: string, method: string, description?: string, context?: string): Promise<string> {
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
            return "// Local Gen Failed";
        }
    }

    async transcribeAudio(audioBase64: string, mimeType: string = 'audio/ogg'): Promise<string> {
        // LocalProvider doesn't support audio transcription natively
        // You could integrate with local Whisper API here if available
        log.warn("LocalProvider: Audio transcription not supported. Consider using Google provider.");
        return "[Transcrição não disponível - LLM local não suporta áudio]";
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
        }, { headers: this.getHeaders(), timeout: 120000 });
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
            return JSON.stringify({ subject: 'Lembrete de Pagamento', body: 'Erro ao gerar email.' });
        }
    }

    async generateSalesForecast(invoices: any[], context?: any): Promise<string> {
        const invoicesSummary = (invoices || []).map((i) => ({ d: i.date || i.datec, v: i.total_ttc, s: i.status }));
        const refDate = context?.referenceDate ? new Date(context.referenceDate).toLocaleDateString('pt-BR') : 'Data Atual';
        const prompt = `Atue como analista financeiro sênior (sazonalidade e previsão de vendas).
DATA DE REFERÊNCIA (HOJE): ${refDate} (o mês atual está incompleto: faça o "landing" = realizado + projeção dos dias restantes).
METODOLOGIA: 1) mês atual = realizado + tendência; 2) próximos meses por sazonalidade (anos anteriores); 3) ajuste pela média dos últimos 6 meses.
DADOS (faturas): ${JSON.stringify(invoicesSummary)}
Retorne APENAS JSON: { "forecast": [ { "month": "Nome Mês Ano", "predicted_revenue": 0.00, "confidence": "high|medium|low" } ], "summary": "lógica usada", "trend": "up|down|stable" } (3 meses)`;
        try {
            const raw = await this.complete(prompt, 'Output only JSON.', 0.3);
            return raw.match(/\{[\s\S]*\}/)?.[0] || JSON.stringify({ forecast: [], summary: 'Sem dados suficientes.' });
        } catch (e: any) {
            log.error('LocalProvider generateSalesForecast Error', e?.message || e);
            return JSON.stringify({ forecast: [], summary: 'Erro na previsão.' });
        }
    }

    async analyzeCustomerSentiment(customer: any, invoices: any[]): Promise<string> {
        const relevant = (invoices || []).slice(0, 20).map((i) => ({ ref: i.ref, total: i.total_ttc, status: i.status, date: i.date }));
        const prompt = `Analise o relacionamento com este cliente.\nCLIENTE: ${customer?.name} | Status: ${customer?.status} | Desde: ${customer?.date_creation || 'N/A'}\nFATURAS: ${JSON.stringify(relevant)}\nRetorne APENAS JSON: { "score": 0-100, "label": "Positive|Neutral|Negative|At Risk", "insights": "...", "recommendations": ["..."] }`;
        try {
            const raw = await this.complete(prompt, 'Output only JSON.', 0.3);
            return raw.match(/\{[\s\S]*\}/)?.[0] || JSON.stringify({ score: 50, label: 'Neutral', insights: 'Sem dados.' });
        } catch (e: any) {
            log.error('LocalProvider analyzeCustomerSentiment Error', e?.message || e);
            return JSON.stringify({ score: 50, label: 'Error', insights: 'Erro na análise.' });
        }
    }

    async auditProposal(proposal: any): Promise<string> {
        const prompt = `Você é um auditor de propostas comerciais. Analise e aponte problemas/melhorias.\nPROPOSTA: ${JSON.stringify(proposal)}\nRetorne APENAS JSON: { "score": 0-100, "status": "Aprovada|Revisar|Rejeitada", "issues": ["..."], "suggestions": ["..."], "summary": "..." }`;
        try {
            const raw = await this.complete(prompt, 'Output only JSON.', 0.3);
            return raw.match(/\{[\s\S]*\}/)?.[0] || JSON.stringify({ score: 0, issues: ['Sem dados.'] });
        } catch (e: any) {
            log.error('LocalProvider auditProposal Error', e?.message || e);
            return JSON.stringify({ score: 0, issues: ['Erro na auditoria.'] });
        }
    }

    async auditProject(project: any, tasks?: any[], projectInvoices?: any[]): Promise<string> {
        const prompt = `Você é um gerente de projetos experiente. Analise a saúde do projeto e riscos.\nPROJETO: ${JSON.stringify(project)}\nTAREFAS (${tasks?.length || 0}): ${JSON.stringify(tasks?.slice(0, 20) || [])}\nFATURAS (${projectInvoices?.length || 0}): ${JSON.stringify(projectInvoices?.slice(0, 10) || [])}\nRetorne APENAS JSON: { "health": "Saudável|Atenção|Crítico", "score": 0-100, "risks": ["..."], "recommendations": ["..."], "summary": "..." }`;
        try {
            const raw = await this.complete(prompt, 'Output only JSON.', 0.3);
            return raw.match(/\{[\s\S]*\}/)?.[0] || JSON.stringify({ health: 'unknown', issues: ['Sem dados.'] });
        } catch (e: any) {
            log.error('LocalProvider auditProject Error', e?.message || e);
            return JSON.stringify({ health: 'unknown', issues: ['Erro na análise.'] });
        }
    }

    async analyzeSystemLogs(logs: any[]): Promise<string> {
        const summary = (logs || []).slice(0, 50).map((l) => ({ type: l.endpoint_or_task || l.type, status: l.status, duration: l.duration_ms, error: l.error_message }));
        const prompt = `Você é especialista em otimização de sistemas. Analise estes logs de API e sugira otimizações.\nLOGS: ${JSON.stringify(summary)}\nRetorne APENAS um JSON array: [ { "type": "error|performance|pattern", "title": "...", "description": "...", "suggestion": "...", "priority": "high|medium|low" } ]`;
        try {
            const raw = await this.complete(prompt, 'Output only a JSON array.', 0.3);
            return raw.match(/\[[\s\S]*\]/)?.[0] || '[]';
        } catch (e: any) {
            log.error('LocalProvider analyzeSystemLogs Error', e?.message || e);
            return '[]';
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
            return 'Erro ao analisar o relatório mensal.';
        }
    }
}

// --- Service Factory ---

let defaultProvider: AIProvider | null = null;

const glmVisionConfig = (apiKey?: string) => apiKey
    ? { baseUrl: (config as any).zaiVisionBaseUrl || 'https://api.z.ai/api/paas/v4', model: (config as any).zaiVisionModel || 'glm-4.6v' }
    : undefined;

function createProvider(name: string, url?: string, key?: string, modelName?: string): AIProvider {
    if (name === 'google') return new GoogleProvider(key || config.googleApiKey, modelName);
    if (name === 'glm') return new LocalProvider(url || config.zaiBaseUrl, modelName || config.zaiModel, key || config.zaiApiKey, glmVisionConfig(key || config.zaiApiKey));
    if (name === 'minimax') return new LocalProvider(url || config.minimaxBaseUrl, modelName || config.minimaxModel, key || config.minimaxApiKey);
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
const providerSupportsAudio = (p: AIProvider): boolean => p instanceof GoogleProvider;

// Provider multimodal de fallback (hoje só o Google). null se não houver chave.
const getMultimodalProvider = (): AIProvider | null => {
    if (config.googleApiKey) return new GoogleProvider(config.googleApiKey);
    return null;
};

export const aiService = {
    setConfig: (providerName: 'local' | 'google' | 'glm' | 'minimax', url?: string, key?: string, modelName?: string) => {
        defaultProvider = createProvider(providerName, url, key, modelName);
        log.info(`AI Provider set to: ${providerName} (Model: ${modelName})`);
    },

    getModels: async () => {
        const provider = getProvider();
        if (provider.getModels) {
            return await provider.getModels();
        }
        return [];
    },

    generateReply: async (conversationHistory: ChatMessage[], context: string, imageBase64?: string, moduleName: string = 'chat') => {
        // Injeta o endereço público (cloudflared) no contexto -> o agente sabe responder "qual o endereço de acesso?".
        try {
            const tunnelUrl = require('./tunnelService').tunnelService.getUrl();
            if (tunnelUrl) context = `${context}\n[INFRA] Endereço de acesso público atual (cloudflared): ${tunnelUrl}`;
        } catch { /* ignore */ }

        // Dynamic Config Lookup
        // We might want to import configService dynamically if needed, or assume it's available.
        // But since this is inside a function, we can use the imported instance.
        const { configService } = require('./configService');
        const moduleConfig = configService.getModuleConfig(moduleName);

        // Determine which provider to use for this Specific Request
        const providerName = moduleConfig.provider || config.llmProvider;
        const modelName = moduleConfig.model; // Specific model for this module

        // We can either switch the global provider (not thread safe) or get the specific provider instance.
        // Better: getProvider(providerName)
        let specificProvider = getProvider(providerName);

        if (!specificProvider) {
            // Fallback to default
            specificProvider = getProvider();
        }

        // Roteamento por capacidade: se há IMAGEM e o provider de texto (GLM/local)
        // não tem visão, atende ESTA resposta com o Google (mesmo conjunto de tools).
        if (imageBase64 && !providerSupportsVision(specificProvider)) {
            const mm = getMultimodalProvider();
            if (mm) {
                log.info(`generateReply: imagem presente e provider '${providerName}' sem visão -> roteando para Google.`);
                return mm.generateReply(conversationHistory, context, imageBase64, { provider: 'google', model: config.geminiModel });
            }
            log.warn(`generateReply: imagem presente mas nenhum provider com visão disponível (sem googleApiKey) -> seguindo com '${providerName}'.`);
        }

        return specificProvider.generateReply(conversationHistory, context, imageBase64, { provider: providerName, model: modelName });
    },

    analyzeSystem: async (query: string, rootPath: string = '../src') => {
        try {
            const fileContext = await readSystemContext(rootPath);
            return getProvider().analyzeSystem(query, fileContext);
        } catch (e: any) {
            log.error("Analysis Error", e);
            throw new Error("Falha na análise do sistema.");
        }
    },

    analyzeSentiment: async (message: string) => {
        return getProvider().analyzeSentiment(message);
    },

    extractReceiptData: async (imageBase64: string) => {
        // Visão (OCR de recibo): o GLM-4.6V (LocalProvider com visão) atende direto;
        // se o provider de texto não tem visão, roteia p/ Google (fallback multimodal).
        // NB: só o caminho de OCR usa a visão do GLM; o chat-com-imagem (generateReply)
        // continua no Google, pois o LocalProvider.generateReply não envia a imagem.
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
        return provider.extractReceiptData(imageBase64);
    },

    extractCustomerInfo: async (text: string) => {
        return getProvider().extractCustomerInfo(text);
    },

    analyzeFinancialHealth: async (data: any) => {
        return getProvider().analyzeFinancialHealth(data);
    },

    fixApiCall: async (logData: any) => {
        try {
            const context = await readSystemContext('../src');
            return getProvider().fixApiCall(logData, context);
        } catch (e) {
            log.error("fixApiCall Wrapper Error", e);
            return "Could not perform analysis.";
        }
    },

    generateCode: async (endpoint: string, method: string, description?: string) => {
        try {
            const context = await readSystemContext('../src');
            return getProvider().generateCode(endpoint, method, description, context);
        } catch (e) {
            return "// Wrapper Error";
        }
    },

    transcribeAudio: async (audioBase64: string, mimeType: string = 'audio/ogg') => {
        // Áudio: se o provider de texto (GLM/local) não transcreve, roteia p/ Google.
        let provider = getProvider();
        if (!providerSupportsAudio(provider)) {
            const mm = getMultimodalProvider();
            if (mm) {
                log.info("transcribeAudio: provider de texto sem áudio -> roteando para Google.");
                provider = mm;
            }
        }
        if ('transcribeAudio' in provider) {
            return (provider as any).transcribeAudio(audioBase64, mimeType);
        }
        return "[Transcrição não disponível]";
    },

    // New AI methods
    draftCollectionEmail: async (customer: any, amount: number) => {
        const provider = getProvider();
        if ('draftCollectionEmail' in provider && provider.draftCollectionEmail) {
            return provider.draftCollectionEmail(customer, amount);
        }
        return JSON.stringify({ subject: "N/A", body: "Método não disponível neste provider." });
    },

    generateSalesForecast: async (invoices: any[], context?: any) => {
        const provider = getProvider();
        if ('generateSalesForecast' in provider && provider.generateSalesForecast) {
            return provider.generateSalesForecast(invoices, context);
        }
        return JSON.stringify({ forecast: [], summary: "Método não disponível." });
    },

    analyzeCustomerSentiment: async (customer: any, invoices: any[]) => {
        const provider = getProvider();
        if ('analyzeCustomerSentiment' in provider && provider.analyzeCustomerSentiment) {
            return provider.analyzeCustomerSentiment(customer, invoices);
        }
        return JSON.stringify({ score: 50, label: "N/A", insights: "Método não disponível." });
    },

    auditProposal: async (proposal: any) => {
        const provider = getProvider();
        if ('auditProposal' in provider && provider.auditProposal) {
            return provider.auditProposal(proposal);
        }
        return JSON.stringify({ score: 0, issues: ["Método não disponível."] });
    },

    auditProject: async (project: any, tasks?: any[], projectInvoices?: any[]) => {
        const provider = getProvider();
        if ('auditProject' in provider && provider.auditProject) {
            return provider.auditProject(project, tasks, projectInvoices);
        }
        return JSON.stringify({ health: "unknown", issues: ["Método não disponível."] });
    },

    analyzeSystemLogs: async (logs: any[]) => {
        const provider = getProvider();
        if ('analyzeSystemLogs' in provider && provider.analyzeSystemLogs) {
            return provider.analyzeSystemLogs(logs);
        }
        return "[]";
    },

    analyzeMonthlyReport: async (data: any) => {
        const provider = getProvider();
        if ('analyzeMonthlyReport' in provider && provider.analyzeMonthlyReport) {
            return provider.analyzeMonthlyReport(data);
        }
        return "Método não disponível neste provider.";
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
