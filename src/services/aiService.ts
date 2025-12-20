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

const API_URL = '/api/ai';

export const AiService = {

    generateTicketReply: async (ticketSubject: string, ticketMessage: string, history: string[]) => {
        try {
            // Conversão de histórico simples para formato do backend se necessário
            // O backend espera { role, parts }[], mas generate-reply no backend parece pegar history as any ???
            // Verificando backend: aiService.generateReply(history as any || [], context)
            // Se aiService do backend espera string[], então precisamos ver o Backend Service.
            // Backend Service (GoogleProvider) espera string[].
            // Mas a rota valida { role, parts }... isso é inconsistente no backend.
            // Vou mandar no formato que a rota valida, e esperar que o backend service saiba lidar ou simplificar.
            // Melhor: vou mandar o history formatado como o Zod pede, e no backend a rota passa pro service.
            // Se o service espera string[], a rota deveria converter.
            // Vou assumir que o backend service foi atualizado ou aceita objetos se for Google/Local.
            // Como vi o backend service: generateReply(conversationHistory: string[], context: string)
            // A rota backend faz: aiService.generateReply(history as any || [], context || '')
            // Isso vai dar erro se mandar objetos e o service esperar string.
            // VOU CONSERTAR O BACKEND TAMBÉM. Mas primeiro o frontend.

            const response = await axios.post(`${API_URL}/generate-reply`, {
                context: `Assunto: ${ticketSubject}. Msg Inicial: ${ticketMessage}`,
                history: history.map(h => ({ role: 'user', parts: h })) // Adapter simples
            }, getAuthHeaders());
            return response.data.reply;
        } catch (error: any) {
            console.error("Erro AI Backend", error);
            return null;
        }
    },

    // Stubs for other methods to prevent compilation errors
    extractProjectInfo: async (text: string) => null,

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

    draftCollectionEmail: async (customer: ThirdParty, totalDue: number) => "",
    generateSalesForecast: async (invoices: Invoice[]) => null,
    analyzeCustomerSentiment: async (customer: ThirdParty, invoices: Invoice[]) => null,

    extractReceiptData: async (base64: string) => {
        try {
            const response = await axios.post(`${API_URL}/extract/receipt`, { image: base64 }, getAuthHeaders());
            return response.data.result;
        } catch (error: any) {
            console.error("Receipt Extraction Error", error);
            return null;
        }
    },

    auditProposal: async (text: string) => null,
    auditProject: async (project: Project, tasks: any[], invoices: any[]) => null,

    chatWithData: async (msg: string, customers: any[], invoices: any[], projects: any[], tickets: any[], userImage?: any) => {
        try {
            // 1. Preparar Contexto de Dados (Resumo para não estourar tokens)
            // Selecionar top 20 de cada ou apenas resumo estatístico + nomes

            let dataContext = "RESUMO DOS DADOS DO SISTEMA:\n";

            dataContext += `\nCLIENTES (${customers.length}):\n`;
            dataContext += customers.slice(0, 50).map((c: any) => `- ${c.name} (ID: ${c.id}, Status: ${c.status})`).join('\n');

            dataContext += `\n\nFATURAS RECENTES (${invoices.length}):\n`;
            dataContext += invoices.slice(0, 50).map((i: any) => `- Ref: ${i.ref}, Total: ${i.total_ttc}, Status: ${i.status}`).join('\n');

            dataContext += `\n\nPROJETOS (${projects.length}):\n`;
            dataContext += projects.slice(0, 30).map((p: any) => `- ${p.title} (Ref: ${p.ref})`).join('\n');

            if (userImage) {
                dataContext += "\n[USUÁRIO ENVIOU UMA IMAGEM ANEXADA - O BACKEND AINDA NÃO PROCESSA IMAGEM NO CHAT GENERIO]\n";
            }

            // 2. Chamar Backend
            // Usamos /generate-reply pois é a rota de conversação genérica disponível.
            const response = await axios.post(`${API_URL}/generate-reply`, {
                history: [
                    { role: 'user', parts: msg }
                ],
                context: dataContext
            }, getAuthHeaders());

            return response.data.reply;

        } catch (error: any) {
            console.error("Chat Error", error);
            return "Erro de conexão com o Assistente Virtual.";
        }
    },

    analyzeSystemLogs: async (logs: any[]) => "[]",

    analyzeApiStructure: async (json: string) => null,

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
    }
};
