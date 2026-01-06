import axios from 'axios';
import { ThirdParty, Invoice, Project, Ticket } from '../types';

// Utility to get headers with Auth
const getAuthHeaders = () => {
    const savedConfigObj = JSON.parse(localStorage.getItem('coolgroove_config') || '{}');
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
                context: "You are a project manager. Output JSON only."
            }, getAuthHeaders());

            // The backend returns a string. We attempt to parse it if the model wrapped it in code blocks or just text.
            let reply = response.data.reply;
            // Basic cleanup if md blocks are present
            reply = reply.replace(/```json/g, '').replace(/```/g, '').trim();
            return JSON.parse(reply);
        } catch (error: any) {
            console.error("generateProjectTasks Error", error);
            return [];
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
            // Intelligent Data Selection for Seasonality
            const now = new Date();
            console.log("DEBUG: Reference Date (Front) =", now.toString());
            console.log("DEBUG: Context sent to AI =", { referenceDate: now.toISOString() });

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

            const response = await axios.post(`${API_URL}/analyze/sales-forecast`, {
                invoices: relevantInvoices.map(i => ({
                    ref: i.ref,
                    total_ttc: i.total_ttc,
                    status: i.statut,
                    date: i.date
                })),
                context: {
                    referenceDate: now.toISOString(),
                    targetMonths: targetMonths // Inform backend which months we are targeting
                }
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

    analyzeMonthlyReport: async (data: any) => {
        try {
            const response = await axios.post(`${API_URL}/analyze/monthly-report`, { data }, getAuthHeaders());
            return response.data.result;
        } catch (error: any) {
            console.error("Monthly Report Analysis Error", error);
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

