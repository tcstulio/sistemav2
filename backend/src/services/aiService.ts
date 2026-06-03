import { GoogleGenAI } from "@google/genai";
import axios from 'axios';
import { dolibarrService } from './dolibarrService';
import { config } from '../config/env';
import fs from 'fs/promises';
import path from 'path';
import { ScraperService } from './scraperService';
import { logger } from '../utils/logger';
import { isValidExternalUrl } from '../utils/urlValidation';

const log = logger.child('AiService');

// --- Interfaces ---

export interface ChatMessage {
    role: 'user' | 'model' | 'system';
    parts: string;
}

interface AIProvider {
    generateReply(conversationHistory: ChatMessage[], context: string, imageBase64?: string, options?: { provider?: string, model?: string }): Promise<string>;
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

    async generateReply(conversationHistory: ChatMessage[], context: string, imageBase64?: string, options?: { provider?: string, model?: string }): Promise<string> {
        if (!this.ai) {
            log.error('Google AI not configured.');
            throw new Error("Google AI not configured.");
        }

        // const { dolibarrService } = require('./dolibarrService'); // Replaced by static import

        // Tool Definitions
        const toolsPrompt = `
        FERRAMENTAS DISPONÍVEIS:
        Você pode buscar dados em tempo real se necessário. Para usar uma ferramenta, responda APENAS com um JSON no seguinte formato:
        { "tool": "nome_da_ferramenta", "args": { ... } }

        Ferramentas:
        1. search_customer(query: string) - Busca clientes por nome, email ou alias.
        2. get_customer_details(id: string) - Traz faturas, projetos e agenda de um cliente específico.
        3. list_invoices(status: 'unpaid' | 'paid' | 'draft', limit: number) - Lista faturas de clientes.
        4. list_projects(search: string) - Lista projetos.
        5. list_orders(status: 'draft'|'validated'|'processed', search: string) - Lista pedidos de venda.
        6. list_proposals(status: 'draft'|'open'|'signed', search: string) - Lista propostas comerciais.
        7. list_tickets(search: string) - Lista tickets de suporte.
        8. list_products(search: string) - Lista produtos e serviços.
        9. list_bank_accounts() - Lista contas bancárias e saldos.
        10. list_contracts(search: string) - Lista contratos ativos/recentes.
        11. list_shipments(search: string) - Lista envios/expedições.
        12. list_supplier_invoices(status: 'unpaid'|'paid') - Lista faturas de fornecedor.
        13. list_expense_reports(status: 'approved'|'paid') - Lista relatórios de despesas.
        14. list_users(search: string) - Lista usuários/funcionários.
        15. list_warehouses() - Lista estoques/armazéns.
        16. list_tasks(projectId: string) - Lista tarefas de um projeto.
        17. list_events(limit: number) - Lista eventos da agenda.
        18. list_contacts(search: string) - Lista contatos (pessoas de contato).
        19. list_categories(type: string) - Lista categorias (customer, product, etc).
        20. list_suppliers(search: string) - Lista fornecedores.
        21. list_supplier_orders(status: 'draft'|'validated') - Lista pedidos de compra.
        22. list_payments(limit: number) - Lista pagamentos recebidos.
        23. list_bank_lines(accountId: string, limit: number) - Lista linhas/movimentações de conta bancária.
        24. list_stock_movements(productId: string) - Lista movimentações de estoque.
        25. list_interventions(search: string) - Lista intervenções/serviços em campo.
        26. list_leave_requests(status: string) - Lista solicitações de férias/ausências.
        27. list_boms(search: string) - Lista listas técnicas (BOM).
        28. list_manufacturing_orders(status: 'draft'|'validated'|'inprogress') - Lista ordens de produção.
        29. list_candidates(search: string) - Lista candidatos (RH/Recrutamento).
        29. list_candidates(search: string) - Lista candidatos (RH/Recrutamento).
        30. list_job_positions() - Lista vagas de emprego abertas.
        31. search_web(query: string) - Pesquisa preços e fornecedores na internet (Google via Serper).
        32. extract_from_url(url: string) - Acessa um link e extrai o conteúdo da página.

        EXEMPLO:
        User: "Preço do item X no link Y"
        Assistant: { "tool": "extract_from_url", "args": { "url": "https://loja.com/produto" } }
        User: (Sistema retorna lista de clientes)
        Assistant: { "tool": "get_customer_details", "args": { "id": "123" } }
        User: (Sistema retorna detalhes)
        Assistant: "O Cliente X tem 3 faturas em aberto..."
        `;

        let currentHistory = [...conversationHistory];
        let currentContext = context;
        let iterations = 0;
        const MAX_ITERATIONS = 5;

        while (iterations < MAX_ITERATIONS) {

            // Format history
            const historyText = currentHistory.map(msg =>
                `${msg.role.toUpperCase()}: ${msg.parts}`
            ).join('\n');

            const prompt = `
                Você é um assistente de atendimento inteligente e assistente virtual do Dolibarr ERP.
                Responda de forma prestativa, profissional e concisa em Português do Brasil.
                
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

            // Check for tool call JSON
            const toolMatch = textResponse.match(/\{[\s\S]*"tool"[\s\S]*\}/);

            if (toolMatch) {
                try {
                    const jsonBlock = toolMatch[0];
                    const toolCall = JSON.parse(jsonBlock);

                    log.info(`Tool Call: ${toolCall.tool}`, toolCall.args);

                    let toolResult = "";

                    switch (toolCall.tool) {
                        case 'search_customer':
                            if (!toolCall.args?.query) throw new Error("Parâmetro 'query' ausente.");
                            const customers = await dolibarrService.searchThirdParty(toolCall.args.query);
                            toolResult = `Resultado da busca: ${JSON.stringify(customers.map((c: any) => ({ id: c.id, name: c.name, email: c.email })))}`;
                            break;
                        case 'get_customer_details':
                            if (!toolCall.args?.id) throw new Error("Parâmetro 'id' ausente.");
                            toolResult = await dolibarrService.getCustomerContext(toolCall.args.id);
                            break;
                        case 'list_invoices':
                            const invs = await dolibarrService.listInvoices(toolCall.args || {});
                            toolResult = `Faturas: ${JSON.stringify(invs.map((i: any) => ({ ref: i.ref, total: i.total_ttc, status: i.statut, date: i.date })))}`;
                            break;
                        case 'list_projects':
                            const projs = await dolibarrService.listProjects(toolCall.args?.search || '');
                            toolResult = `Projetos: ${JSON.stringify(projs.map((p: any) => ({ ref: p.ref, title: p.title, status: p.statut })))}`;
                            break;
                        case 'list_orders':
                            const orders = await dolibarrService.listOrders(toolCall.args);
                            toolResult = `Pedidos: ${JSON.stringify(orders.map((o: any) => ({ ref: o.ref, total: o.total_ttc, status: o.statut, date: o.date_commande })))}`;
                            break;
                        case 'list_proposals':
                            const props = await dolibarrService.listProposals(toolCall.args);
                            toolResult = `Propostas: ${JSON.stringify(props.map((p: any) => ({ ref: p.ref, total: p.total_ttc, status: p.statut, date: p.datep })))}`;
                            break;
                        case 'list_tickets':
                            const tickets = await dolibarrService.listTickets(toolCall.args);
                            toolResult = `Tickets: ${JSON.stringify(tickets.map((t: any) => ({ track_id: t.track_id, subject: t.subject, message: t.message, date: t.datec })))}`;
                            break;
                        case 'list_products':
                            const prods = await dolibarrService.listProducts(toolCall.args.search);
                            toolResult = `Produtos: ${JSON.stringify(prods.map((p: any) => ({ ref: p.ref, label: p.label, price: p.price })))}`;
                            break;
                        case 'list_bank_accounts':
                            const banks = await dolibarrService.listBankAccounts();
                            toolResult = `Contas Bancárias: ${JSON.stringify(banks.map((b: any) => ({ label: b.label, balance: b.solde, currency: b.currency_code })))}`;
                            break;
                        case 'list_contracts':
                            const contracts = await dolibarrService.listContracts(toolCall.args.search);
                            toolResult = `Contratos: ${JSON.stringify(contracts.map((c: any) => ({ ref: c.ref, status: c.statut, date: c.date_contrat })))}`;
                            break;
                        case 'list_shipments':
                            const ships = await dolibarrService.listShipments(toolCall.args.search);
                            toolResult = `Expedições: ${JSON.stringify(ships.map((s: any) => ({ ref: s.ref, status: s.statut, date: s.date_creation })))}`;
                            break;
                        case 'list_supplier_invoices':
                            const supInvs = await dolibarrService.listSupplierInvoices(toolCall.args.status);
                            toolResult = `Faturas Fornecedor: ${JSON.stringify(supInvs.map((i: any) => ({ ref: i.ref, total: i.total_ttc, status: i.statut, date: i.datef })))}`;
                            break;
                        case 'list_expense_reports':
                            const expenses = await dolibarrService.listExpenseReports(toolCall.args.status);
                            toolResult = `Despesas: ${JSON.stringify(expenses.map((e: any) => ({ ref: e.ref, total: e.total_ttc, status: e.statut, date: e.date_debut })))}`;
                            break;
                        case 'list_users':
                            const users = await dolibarrService.listUsers(toolCall.args.search);
                            toolResult = `Usuários: ${JSON.stringify(users.map((u: any) => ({ id: u.id, name: u.lastname + ' ' + u.firstname, email: u.email, job: u.job })))}`;
                            break;
                        case 'list_warehouses':
                            const warehouses = await dolibarrService.listWarehouses();
                            toolResult = `Armazéns: ${JSON.stringify(warehouses.map((w: any) => ({ label: w.label, description: w.description })))}`;
                            break;
                        case 'list_tasks':
                            const tasks = await dolibarrService.listTasks(toolCall.args.projectId);
                            toolResult = `Tarefas: ${JSON.stringify(tasks.map((t: any) => ({ ref: t.ref, label: t.label, progress: t.progress, dateo: t.dateo })))}`;
                            break;
                        case 'list_events':
                            const events = await dolibarrService.listEvents(toolCall.args.limit);
                            toolResult = `Eventos: ${JSON.stringify(events.map((e: any) => ({ label: e.label, datep: e.datep, datef: e.datef, type: e.type_code })))}`;
                            break;
                        case 'list_contacts':
                            const contacts = await dolibarrService.listContacts(toolCall.args.search);
                            toolResult = `Contatos: ${JSON.stringify(contacts.map((c: any) => ({ id: c.id, name: c.lastname + ' ' + c.firstname, email: c.email, phone: c.phone_mobile })))}`;
                            break;
                        case 'list_categories':
                            const cats = await dolibarrService.listCategories(toolCall.args.type);
                            toolResult = `Categorias: ${JSON.stringify(cats.map((c: any) => ({ id: c.id, label: c.label, type: c.type })))}`;
                            break;
                        case 'list_suppliers':
                            const suppliers = await dolibarrService.listSuppliers(toolCall.args.search);
                            toolResult = `Fornecedores: ${JSON.stringify(suppliers.map((s: any) => ({ id: s.id, name: s.name, email: s.email })))}`;
                            break;
                        case 'list_supplier_orders':
                            const supOrders = await dolibarrService.listSupplierOrders(toolCall.args.status);
                            toolResult = `Pedidos Compra: ${JSON.stringify(supOrders.map((o: any) => ({ ref: o.ref, total: o.total_ttc, status: o.statut, date: o.date_commande })))}`;
                            break;
                        case 'list_payments':
                            const payments = await dolibarrService.listPayments(toolCall.args.limit);
                            toolResult = `Pagamentos: ${JSON.stringify(payments.map((p: any) => ({ id: p.id, amount: p.amount, date: p.datep })))}`;
                            break;
                        case 'list_bank_lines':
                            const bankLines = await dolibarrService.listBankLines(toolCall.args.accountId, toolCall.args.limit);
                            toolResult = `Movimentações Banco: ${JSON.stringify(bankLines.map((l: any) => ({ label: l.label, amount: l.amount, date: l.dateo })))}`;
                            break;
                        case 'list_stock_movements':
                            const stockMoves = await dolibarrService.listStockMovements(toolCall.args.productId);
                            toolResult = `Movimentações Estoque: ${JSON.stringify(stockMoves.map((m: any) => ({ product: m.fk_product, qty: m.qty, date: m.datem })))}`;
                            break;
                        case 'list_interventions':
                            const interventions = await dolibarrService.listInterventions(toolCall.args.search);
                            toolResult = `Intervenções: ${JSON.stringify(interventions.map((i: any) => ({ ref: i.ref, description: i.description, date: i.datec })))}`;
                            break;
                        case 'list_leave_requests':
                            const leaves = await dolibarrService.listLeaveRequests(toolCall.args.status);
                            toolResult = `Solicitações Férias: ${JSON.stringify(leaves.map((l: any) => ({ ref: l.ref, status: l.statut, date_debut: l.date_debut })))}`;
                            break;
                        case 'list_boms':
                            const boms = await dolibarrService.listBOMs(toolCall.args.search);
                            toolResult = `BOMs: ${JSON.stringify(boms.map((b: any) => ({ ref: b.ref, label: b.label, status: b.status })))}`;
                            break;
                        case 'list_manufacturing_orders':
                            const mos = await dolibarrService.listManufacturingOrders(toolCall.args.status);
                            toolResult = `Ordens Produção: ${JSON.stringify(mos.map((m: any) => ({ ref: m.ref, qty: m.qty, status: m.status, date_start: m.date_start_planned })))}`;
                            break;
                        case 'list_candidates':
                            const candidates = await dolibarrService.listCandidates(toolCall.args.search);
                            toolResult = `Candidatos: ${JSON.stringify(candidates.map((c: any) => ({ id: c.id, name: c.lastname + ' ' + c.firstname, email: c.email })))}`;
                            break;
                        case 'list_job_positions':
                            const jobs = await dolibarrService.listJobPositions(true);
                            toolResult = jobs.length > 0
                                ? `Vagas ABERTAS: ${JSON.stringify(jobs.map((j: any) => ({ ref: j.ref, label: j.label, status: j.status, qty: j.qty })))}`
                                : 'Nenhuma vaga aberta no momento.';
                            break;
                        case 'search_web':
                            const searchResults = await ScraperService.searchGoogle(toolCall.args.query);
                            toolResult = `[WEB SEARCH RESULTS]:\n${JSON.stringify(searchResults)}`;
                            break;
                        case 'extract_from_url':
                            if (!isValidExternalUrl(toolCall.args?.url)) {
                                toolResult = 'Erro: URL inválida ou bloqueada (IPs privados/internos não são permitidos).';
                                break;
                            }
                            const pageContent = await ScraperService.fetchPageContent(toolCall.args.url);
                            toolResult = `[PAGE CONTENT for ${toolCall.args.url}]:\n${pageContent ? pageContent.substring(0, 10000) : 'Falha ao acessar página or conteúdo vazio'}`;
                            break;
                        default:
                            toolResult = "Ferramenta desconhecida.";
                    }

                    // Add tool result to history (simulated as System or User input with data)
                    // We append it to the context for the next turn
                    currentContext += `\n\n[DADOS OBTIDOS VIA ${toolCall.tool}]:\n${toolResult}\n`;

                    // Also strictly append to history or just let the prompt reconstruction handle it via context update
                    // But to prevent loops, we must ensure the model sees the result.
                    // The simplest way here is updating 'currentContext' which is injected in the prompt.

                    iterations++;
                    continue; // Loop again

                } catch (e: any) {
                    log.error("Tool execution failed", e);
                    const errorMsg = `Erro na execução da ferramenta ${toolMatch ? (JSON.parse(toolMatch[0]).tool || 'desconhecida') : 'desconhecida'}: ${e.message}`;
                    // Continue to next iteration so LLM can see the error
                    currentContext += `\n\n[ERRO NA EXECUÇÃO]:\n${errorMsg}\n`;
                    iterations++;
                    continue;
                }
            }

            // No tool call, return final response
            return textResponse;
        }

        return "Desculpe, não consegui obter todas as informações necessárias após várias tentativas.";
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

class LocalProvider implements AIProvider {
    private baseUrl: string;
    private modelName: string;
    private apiKey?: string;

    constructor(baseUrl: string, modelName: string = 'llama3', apiKey?: string) {
        this.baseUrl = (baseUrl || '').replace(/\/+$/, ''); // remove barra final -> evita //chat/completions
        this.modelName = modelName;
        this.apiKey = apiKey;
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

    async generateReply(conversationHistory: ChatMessage[], context: string, imageBase64?: string, options?: { provider?: string, model?: string }): Promise<string> {
        // Reuse same tools prompt as Google Provider
        // We need to implement the ReAct loop here too because standard OpenAI interface doesn't automate this
        // unless we use the Function Calling API. But for generic Local LLM compatibility, prompting is safer.

        // const { dolibarrService } = require('./dolibarrService'); // Replaced by static import

        const toolsPrompt = `
        FERRAMENTAS DISPONÍVEIS:
        Responda APENAS com um JSON no formato: { "tool": "nome", "args": { ... } } se precisar de dados.
        Caso contrário, responda normalmente.

        1. search_customer(query: string)
        2. get_customer_details(id: string)
        3. list_invoices(status: string)
        ... (outras ferramentas omitidas para brevidade, assumindo que o modelo conhece o contexto)
        `;

        // Simplify for Local LLM context window
        const toolsLite = `
        TOOLS:
        - search_customer(query)
        - get_customer_details(id)
        - list_invoices(status)
        - list_projects(search)
        - search_web(query)
        - extract_from_url(url)
        
        To use a tool, REPLY ONLY JSON: { "tool": "name", "args": {} }
        Example: { "tool": "search_customer", "args": { "query": "Cliente" } }
        `;

        let currentHistory = [...conversationHistory];
        let currentContext = context;
        let iterations = 0;
        const MAX_ITERATIONS = 5;

        while (iterations < MAX_ITERATIONS) {
            let messages = [
                { role: 'system', content: `Você é um assistente ERP. Use Português. ${currentContext}. \n${toolsLite}` },
                ...currentHistory.map(msg => ({
                    role: msg.role === 'model' ? 'assistant' : msg.role,
                    content: msg.parts
                }))
            ];

            // Template fix
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

                const reply = response.data.choices[0].message.content;

                // Check for Tool Call
                const toolMatch = reply.match(/\{[\s\S]*"tool"[\s\S]*\}/);

                if (toolMatch) {
                    try {
                        const jsonBlock = toolMatch[0];
                        const toolCall = JSON.parse(jsonBlock);
                        log.info(`Local LLM Tool Call: ${toolCall.tool}`, toolCall.args);

                        let toolResult = "";

                        // Execute Tool (Shared logic - simplified copy)
                        // In a real refactor, we would move the switch case to a shared helper function
                        switch (toolCall.tool) {
                            case 'search_customer':
                                const customers = await dolibarrService.searchThirdParty(toolCall.args?.query || '');
                                toolResult = `Result: ${JSON.stringify(customers.slice(0, 5).map((c: any) => ({ id: c.id, name: c.name })))}`;
                                break;
                            case 'get_customer_details':
                                toolResult = await dolibarrService.getCustomerContext(toolCall.args?.id || '');
                                break;
                            case 'list_invoices':
                                const invs = await dolibarrService.listInvoices(toolCall.args || {});
                                toolResult = `Faturas: ${JSON.stringify(invs.map((i: any) => ({ ref: i.ref, total: i.total_ttc, status: i.statut })))}`;
                                break;

                            case 'search_web':
                                const searchRes = await ScraperService.searchGoogle(toolCall.args?.query || '');
                                toolResult = `Search Results: ${JSON.stringify(searchRes)}`;
                                break;
                            case 'extract_from_url':
                                if (!isValidExternalUrl(toolCall.args?.url)) {
                                    toolResult = 'Erro: URL inválida ou bloqueada (IPs privados/internos não são permitidos).';
                                    break;
                                }
                                const pageContent = await ScraperService.fetchPageContent(toolCall.args?.url || '');
                                toolResult = `Page Content: ${pageContent ? pageContent.substring(0, 5000) : 'Failed'}`;
                                break;
                            default:
                                toolResult = "Tool not found or not supported in Lite mode.";
                        }

                        // Update Context & History for next turn
                        currentContext += `\n\n[TOOL RESULT]: ${toolResult}`;
                        iterations++;
                        continue;

                    } catch (e: any) {
                        log.error("Local LLM Tool Error", e);
                        // If invalid JSON, maybe it's just text. Return it.
                        return reply;
                    }
                }

                return reply;

            } catch (error: any) {
                const detail = error?.response
                    ? `HTTP ${error.response.status} ${JSON.stringify(error.response.data)?.slice(0, 300)}`
                    : (error?.code || error?.message || String(error));
                log.error(`Local LLM Error [url=${this.baseUrl}/chat/completions model=${this.modelName}]: ${detail}`);
                return `Erro LLM Local: ${detail}`;
            }
        }
        return "Max iterations reached.";
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
        log.warn("LocalProvider does not support extractReceiptData directly.");
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
}

// --- Service Factory ---

let currentProvider: AIProvider | null = null;

const getProvider = (specificProviderName?: string): AIProvider => {
    if (specificProviderName) {
        if (specificProviderName === 'google') {
            return new GoogleProvider(config.googleApiKey);
        } else if (specificProviderName === 'local') {
            return new LocalProvider(config.localLlmUrl, config.localModelName);
        } else if (specificProviderName === 'glm') {
            return new LocalProvider(config.zaiBaseUrl, config.zaiModel, config.zaiApiKey);
        } else if (specificProviderName === 'minimax') {
            return new LocalProvider(config.minimaxBaseUrl, config.minimaxModel, config.minimaxApiKey);
        }
    }

    if (currentProvider) return currentProvider;

    if (config.llmProvider === 'local') {
        currentProvider = new LocalProvider(config.localLlmUrl, config.localModelName);
    } else if (config.llmProvider === 'glm') {
        currentProvider = new LocalProvider(config.zaiBaseUrl, config.zaiModel, config.zaiApiKey);
    } else if (config.llmProvider === 'minimax') {
        currentProvider = new LocalProvider(config.minimaxBaseUrl, config.minimaxModel, config.minimaxApiKey);
    } else {
        currentProvider = new GoogleProvider(config.googleApiKey);
    }
    return currentProvider!;
};

export const aiService = {
    setConfig: (providerName: 'local' | 'google' | 'glm' | 'minimax', url?: string, key?: string, modelName?: string) => {
        if (providerName === 'google') {
            currentProvider = new GoogleProvider(key || config.googleApiKey, modelName);
        } else if (providerName === 'glm') {
            currentProvider = new LocalProvider(url || config.zaiBaseUrl, modelName || config.zaiModel, key || config.zaiApiKey);
        } else if (providerName === 'minimax') {
            currentProvider = new LocalProvider(url || config.minimaxBaseUrl, modelName || config.minimaxModel, key || config.minimaxApiKey);
        } else {
            currentProvider = new LocalProvider(url || config.localLlmUrl, modelName || config.localModelName);
        }
        log.info(`AI Provider switched to: ${providerName} (Model: ${modelName})`);
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
        return getProvider().extractReceiptData(imageBase64);
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
        const provider = getProvider();
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
