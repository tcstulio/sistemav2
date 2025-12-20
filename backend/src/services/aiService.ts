import { GoogleGenAI } from "@google/genai";
import axios from 'axios';
import { config } from '../config/env';
import fs from 'fs/promises';
import path from 'path';

// --- Interfaces ---

export interface ChatMessage {
    role: 'user' | 'model' | 'system';
    parts: string;
}

interface AIProvider {
    generateReply(conversationHistory: ChatMessage[], context: string): Promise<string>;
    analyzeSystem(query: string, fileContext: string): Promise<string>;
    analyzeSentiment(text: string): Promise<{ score: number; label: string }>;
    extractCustomerInfo(text: string): Promise<any>;
    extractReceiptData(imageBase64: string): Promise<any>;
    analyzeFinancialHealth(data: any): Promise<string>;
    fixApiCall(log: any, context?: string): Promise<string>;
    generateCode(endpoint: string, method: string, description?: string, context?: string): Promise<string>;
    getModels?(): Promise<string[]>; // Optional: Get available models
}

// --- Google GenAI Provider ---

class GoogleProvider implements AIProvider {
    private ai: GoogleGenAI | null = null;

    constructor(apiKey: string) {
        if (apiKey) {
            this.ai = new GoogleGenAI({ apiKey });
        } else {
            console.warn("GOOGLE_API_KEY missing. Google provider disabled.");
        }
    }

    async generateReply(conversationHistory: ChatMessage[], context: string): Promise<string> {
        if (!this.ai) throw new Error("Google AI not configured");

        // Format history nicely
        const historyText = conversationHistory.map(msg =>
            `${msg.role.toUpperCase()}: ${msg.parts}`
        ).join('\n');

        const prompt = `
            Você é um assistente de atendimento inteligente e assistente virtual do Dolibarr ERP.
            Responda de forma prestativa, profissional e concisa em Português do Brasil.
            
            CONTEXTO DE DADOS (Clientes, Faturas, Projetos):
            ${context}
            
            HISTÓRICO DA CONVERSA:
            ${historyText}
            
            Tarefa: Responda a última mensagem do usuário com base no contexto fornecido.
            
            IMPORTANTE: NÃO ASSINE A MENSAGEM (ex: ~ Assistente). O sistema adiciona a assinatura automaticamente.
            
            Se o usuário pedir para analisar dados que não estão no contexto, avise que você só tem acesso a um resumo limitado.
        `;

        const response = await this.ai.models.generateContent({
            model: 'gemini-2.0-flash-exp', // Updated to latest/faster model or keep 1.5
            contents: prompt,
        });
        return response.text || "";
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
            model: 'gemini-2.0-flash-exp',
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
                model: 'gemini-2.0-flash-exp',
                contents: prompt,
            });
            const raw = response.text || "{}";
            const jsonStr = raw.match(/\{[\s\S]*\}/)?.[0] || "{}";
            return JSON.parse(jsonStr);
        } catch (error) {
            console.error("Sentiment Error", error);
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
            const response = await this.ai.models.generateContent({ model: 'gemini-2.0-flash-exp', contents: prompt });
            const raw = response.text || "{}";
            const cleanJson = raw.replace(/```json|```/g, '').trim();
            return JSON.parse(cleanJson);
        } catch (e) {
            console.error("Gemini Extract Error", e);
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
            - items: array of { description, quantity, unit_price, total_price }
            - category: string (suggested expense category)

            Return ONLY raw JSON.
            `;

            const result = await this.ai.models.generateContent({
                model: "gemini-2.0-flash-exp",
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
            console.error("Gemini Vision Error:", error);
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
                model: 'gemini-2.0-flash-exp',
                contents: prompt
            });
            return result.text || "";
        } catch (error) {
            console.error("Gemini Finance Analysis Error:", error);
            return "Não foi possível gerar a análise financeira no momento.";
        }
    }

    async fixApiCall(log: any, context?: string): Promise<string> {
        if (!this.ai) return "Service Unavailable";
        const prompt = `
        You are a Senior TypeScript/React Developer.
        Analyze this failed API call log and provide a solution.

        SYSTEM CONTEXT:
        ${context || 'No context provided.'}

        FAILED REQUEST LOG:
        ${JSON.stringify(log, null, 2)}

        Task: Explain failure and provide corrected code.
        `;
        try {
            const result = await this.ai.models.generateContent({
                model: 'gemini-2.0-flash-exp',
                contents: prompt
            });
            return result.text || "";
        } catch (e) {
            console.error("Gemini fixApiCall Error", e);
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
                model: 'gemini-2.0-flash-exp',
                contents: prompt
            });
            return result.text || "";
        } catch (e) {
            console.error("Gemini CodeGen Error", e);
            return "// Generation failed";
        }
    }
}

// --- Local LLM Provider (OpenAI Compatible) ---

class LocalProvider implements AIProvider {
    private baseUrl: string;
    private modelName: string;

    constructor(baseUrl: string, modelName: string = 'llama3') {
        this.baseUrl = baseUrl;
        this.modelName = modelName;
    }

    async getModels(): Promise<string[]> {
        try {
            // Ollama/OpenAI Compatible /v1/models endpoint
            const response = await axios.get(`${this.baseUrl}/models`);
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
            console.error("Failed to fetch local models:", error);
            return [];
        }
    }

    async generateReply(conversationHistory: ChatMessage[], context: string): Promise<string> {
        // Format for Local LLM (Llama3 expects [INST] or standard chat format)
        // We will map to standard OpenAI messages format

        let messages = [
            { role: 'system', content: `Você é um assistente virtual útil de ERP. Contexto: ${context}. IMPORTANTE: NÃO adicione assinaturas (ex: ~ Nome) ao final da mensagem, pois o sistema já faz isso.` },
            ...conversationHistory.map(msg => ({
                role: msg.role === 'model' ? 'assistant' : msg.role, // OpenAI uses 'assistant' not 'model'
                content: msg.parts
            }))
        ];

        // [ANTIGRAVITY] Fix for strict templates (Mistral/Llama):
        // The first message after 'system' MUST be 'user'.
        // If the history starts with 'assistant', we must remove it.
        // We iterate and remove leading assistants until we find a user or run out.
        // Note: index 0 is system. index 1 is first msg.
        while (messages.length > 1 && messages[1].role === 'assistant') {
            console.log("LocalProvider: Removing leading assistant message to satisfy prompt template constraints.");
            messages.splice(1, 1);
        }

        try {
            // DEBUG: Log payload to see what's wrong
            console.log("Local LLM Payload:", JSON.stringify({
                model: this.modelName,
                messages: messages
            }, null, 2));

            const response = await axios.post(`${this.baseUrl}/chat/completions`, {
                model: this.modelName, // User configured model
                messages: messages,
                temperature: 0.7
            });
            return response.data.choices[0].message.content;
        } catch (error: any) {
            console.error("Local LLM Error Message:", error.message);
            if (error.response) {
                console.error("Local LLM Response Data:", JSON.stringify(error.response.data, null, 2));
                console.error("Local LLM Response Status:", error.response.status);
            }
            return `Erro LLM Local (${error.response?.status || 'Unknown'}): ${error.response?.data?.error?.message || error.message || 'Verifique o modelo configurado.'}`;
        }
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
            });
            return response.data.choices[0].message.content;
        } catch (error: any) {
            console.error("Local LLM Error:", error.message);
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
            });
            const content = response.data.choices[0].message.content;
            const jsonStr = content.match(/\{[\s\S]*\}/)?.[0] || "{}";
            return JSON.parse(jsonStr);
        } catch (error: any) {
            console.error("Local LLM Error:", error.message);
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
            });
            const content = response.data.choices[0].message.content;
            const jsonStr = content.match(/\{[\s\S]*\}/)?.[0] || "{}";
            return JSON.parse(jsonStr);
        } catch (error: any) {
            console.error("Local LLM Error:", error.message);
            return {};
        }
    }

    async extractReceiptData(imageBase64: string): Promise<any> {
        console.warn("LocalProvider does not support extractReceiptData directly.");
        return null;
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
            });
            return response.data.choices[0].message.content;
        } catch (error: any) {
            console.error("Local LLM Error:", error.message);
            return "Erro ao gerar análise financeira local.";
        }
    }

    async fixApiCall(log: any, context?: string): Promise<string> {
        const prompt = `
            [INST]
            You are a Senior Developer. Analyze this failed API log and fix it.
            
            CONTEXT:
            ${context ? context.substring(0, 3000) : "N/A"}

            LOG:
            ${JSON.stringify(log)}

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
            });
            return response.data.choices[0].message.content;
        } catch (error: any) {
            console.error("Local LLM fixApiCall Error", error);
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
            });
            return response.data.choices[0].message.content;
        } catch (error: any) {
            return "// Local Gen Failed";
        }
    }
}

// --- Service Factory ---

let currentProvider: AIProvider | null = null;

const getProvider = (): AIProvider => {
    if (currentProvider) return currentProvider;

    // Initialize default
    if (config.llmProvider === 'local') {
        currentProvider = new LocalProvider(config.localLlmUrl, config.localModelName);
    } else {
        currentProvider = new GoogleProvider(config.googleApiKey);
    }
    return currentProvider!;
};

export const aiService = {
    setConfig: (provider: 'local' | 'google', url?: string, key?: string, modelName: string = 'llama3') => {
        if (provider === 'local') {
            currentProvider = new LocalProvider(url || config.localLlmUrl, modelName || config.localModelName);
        } else {
            currentProvider = new GoogleProvider(key || config.googleApiKey);
        }
        console.log(`AI Provider switched to: ${provider} (Model: ${modelName})`);
    },

    getModels: async () => {
        const provider = getProvider();
        if (provider instanceof LocalProvider) {
            return await provider.getModels();
        }
        return [];
    },

    generateReply: async (conversationHistory: ChatMessage[], context: string) => {
        return getProvider().generateReply(conversationHistory, context);
    },

    analyzeSystem: async (query: string, rootPath: string = '../src') => {
        try {
            const fileContext = await readSystemContext(rootPath);
            return getProvider().analyzeSystem(query, fileContext);
        } catch (e: any) {
            console.error("Analysis Error:", e);
            throw new Error("Falha na análise do sistema.");
        }
    },

    analyzeSentiment: async (message: string) => {
        return getProvider().analyzeSentiment(message);
    },

    extractReceiptData: async (imageBase64: string) => {
        return getProvider().extractReceiptData(imageBase64);
    },

    extractCustomerInfo: async (text: string) => {
        return getProvider().extractCustomerInfo(text);
    },

    analyzeFinancialHealth: async (data: any) => {
        return getProvider().analyzeFinancialHealth(data);
    },

    fixApiCall: async (log: any) => {
        try {
            const context = await readSystemContext('../src');
            return getProvider().fixApiCall(log, context);
        } catch (e) {
            console.error("fixApiCall Wrapper Error", e);
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
