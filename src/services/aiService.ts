import axios from 'axios';
import { ThirdParty, Invoice, Project, Ticket } from '../types';

// Utility to get headers with Auth
const getAuthHeaders = () => {
    const savedConfigObj = JSON.parse(localStorage.getItem('doligen_config') || '{}');
    const token = savedConfigObj.apiKey || '';
    return {
        headers: {
            'Authorization': 'Bearer ' + token
        }
    };
};

// ChatMessage interface for AI conversations
export interface ChatMessage {
    role: 'user' | 'model' | 'system';
    text: string;
    isError?: boolean;
}

const API_URL = '/api/ai';

export const AiService = {

    generateTicketReply: async (ticketSubject: string, ticketMessage: string, history: string[]) => {
        try {
            const response = await axios.post(`${API_URL}/generate-reply`, {
                context: `Assunto: ${ticketSubject}. Msg Inicial: ${ticketMessage}`,
                history: history.map(h => ({ role: 'user', parts: h }))
            }, getAuthHeaders());
            return response.data.reply;
        } catch (error: any) {
            console.error("Erro AI Backend", error);
            return null;
        }
    },

    extractProjectInfo: async (text: string) => {
        try {
            const response = await axios.post(`${API_URL}/extract/customer`, { text }, getAuthHeaders());
            return response.data.result;
        } catch (error: any) {
            console.error("extractProjectInfo Error", error);
            return null;
        }
    },

    analyzeFinancialHealth: async (data: any) => {
        try {
            const response = await axios.post(`${API_URL}/analyze/financial`, { data }, getAuthHeaders());
            return response.data.result;
        } catch (error: any) {
            console.error("Financial Analysis Error", error);
            return "Erro ao processar análise.";
        }
    },

    logCorrection: async (logId: string, correction: string) => {
        console.log("Correction logged", logId, correction);
    },

    draftCollectionEmail: async (customer: ThirdParty, totalDue: number) => {
        try {
            const response = await axios.post(`${API_URL}/draft/collection-email`, {
                customer: { name: customer.name, email: customer.email, id: customer.id },
                amount: totalDue
            }, getAuthHeaders());
            return response.data.result;
        } catch (error: any) {
            console.error("draftCollectionEmail Error", error);
            return JSON.stringify({ subject: "Lembrete de Pagamento", body: "Erro ao gerar email." });
        }
    },

    generateSalesForecast: async (invoices: Invoice[]) => {
        try {
            const response = await axios.post(`${API_URL}/analyze/sales-forecast`, {
                invoices: invoices.slice(0, 100).map(i => ({
                    ref: i.ref,
                    total_ttc: i.total_ttc,
                    status: i.statut,
                    date: i.date
                }))
            }, getAuthHeaders());
            return response.data.result;
        } catch (error: any) {
            console.error("generateSalesForecast Error", error);
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
            console.error("analyzeCustomerSentiment Error", error);
            return null;
        }
    },

    extractReceiptData: async (base64: string) => {
        try {
            const response = await axios.post(`${API_URL}/extract/receipt`, { image: base64 }, getAuthHeaders());
            return response.data.result;
        } catch (error: any) {
            console.error("Receipt Extraction Error", error);
            return null;
        }
    },

    auditProposal: async (proposal: any) => {
        try {
            const response = await axios.post(`${API_URL}/audit/proposal`, { proposal }, getAuthHeaders());
            return response.data.result;
        } catch (error: any) {
            console.error("auditProposal Error", error);
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
            console.error("auditProject Error", error);
            return null;
        }
    },

    chatWithData: async (msg: string, history: ChatMessage[], userImage?: string) => {
        try {
            // Context is now handled by the backend (ReAct / Tools), but we inject basic temporal awareness
            const now = new Date();
            const dateStr = now.toLocaleDateString('pt-BR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
            const timeStr = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

            const dataContext = `[SISTEMA] Data atual: ${dateStr}. Hora: ${timeStr}. Usuário logado: Admin. Use ferramentas para buscar dados específicos.`;

            // Map frontend history to backend format (text -> parts)
            const backendHistory = history.map(m => ({
                role: m.role as 'user' | 'model' | 'system',
                parts: m.text
            }));

            // Append current message
            backendHistory.push({ role: 'user', parts: msg });

            const response = await axios.post(`${API_URL}/generate-reply`, {
                history: backendHistory,
                context: dataContext,
                image: userImage
            }, getAuthHeaders());

            return response.data.reply;

        } catch (error: any) {
            console.error("Chat Error", error);
            return "Erro de conexão com o Assistente Virtual.";
        }
    },

    analyzeSystemLogs: async (logs: any[]) => {
        try {
            const response = await axios.post(`${API_URL}/analyze/logs`, {
                logs: logs.slice(0, 50)
            }, getAuthHeaders());
            return response.data.result;
        } catch (error: any) {
            console.error("analyzeSystemLogs Error", error);
            return "[]";
        }
    },

    analyzeApiStructure: async (json: string) => {
        try {
            const response = await axios.post(`${API_URL}/analyze-system`, { query: `Analyze this API structure: ${json}` }, getAuthHeaders());
            return response.data.result;
        } catch (error: any) {
            console.error("analyzeApiStructure Error", error);
            return null;
        }
    },

    analyzeSystem: async (query: string) => {
        try {
            const response = await axios.post(`${API_URL}/analyze-system`, { query }, getAuthHeaders());
            return response.data.result;
        } catch (error: any) {
            console.error("System Analysis Error", error);
            return "Erro ao analisar sistema: " + (error.response?.data?.error || error.message);
        }
    },

    analyzeSentiment: async (text: string) => {
        try {
            const response = await axios.post(`${API_URL}/analyze-sentiment`, { text }, getAuthHeaders());
            return response.data;
        } catch (error: any) {
            console.error("Sentiment Analysis Error", error);
            return { score: 50, label: "Error" };
        }
    },

    extractCustomerInfo: async (text: string) => {
        try {
            const response = await axios.post(`${API_URL}/extract/customer`, { text }, getAuthHeaders());
            return response.data.result;
        } catch (error: any) {
            console.error("Extraction Error", error);
            return null;
        }
    },

    fixApiCallWithDocs: async (failedLog: any, doc: string) => {
        try {
            const response = await axios.post(`${API_URL}/fix/api-call`, { log: failedLog }, getAuthHeaders());
            return response.data.result;
        } catch (error: any) {
            console.error("Fix API Error", error);
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
            console.error("Transcription Error", error);
            return "[Erro na transcrição]";
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
            console.error("Data Quality Analysis Error", error);
            return null;
        }
    },

    generateActivityReport: async (context: string) => {
        try {
            // Using the generate-reply endpoint as a generic text generator
            const response = await axios.post(`${API_URL}/generate-reply`, {
                history: [{ role: 'user', parts: `Generate a detailed activity report based on the following logs and context. summarize by project or main activity type. Focus on what was actually accomplished.\n\n${context}` }],
                context: "You are a project manager assistant generating a work report."
            }, getAuthHeaders());
            return response.data.reply;
        } catch (error: any) {
            console.error("Activity Report Error", error);
            return "Erro ao gerar relatório. Verifique sua conexão ou tente novamente.";
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
                context: "You are a professional business assistant."
            }, getAuthHeaders());

            // The backend returns a string in 'reply'. We need to parse it if it's JSON.
            // But generate-reply returns text. We rely on the model obeying the JSON instruction.
            return response.data.reply;
        } catch (error: any) {
            console.error("draftMessage Error", error);
            return null;
        }
    }
};

