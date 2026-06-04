// Registro UNIFICADO de ferramentas do agente.
// Antes, GoogleProvider e LocalProvider tinham switches separados (Gemini: 32 tools;
// GLM/Ollama: 5 "Lite"). Agora ambos usam TOOLS_PROMPT + executeTool daqui — então
// qualquer provider tem o mesmo conjunto completo de ferramentas.
import { dolibarrService } from './dolibarrService';
import { ScraperService } from './scraperService';
import { isValidExternalUrl } from '../utils/urlValidation';
import { logger } from '../utils/logger';
import { signDeeplink } from '../utils/deeplinkToken';

const log = logger.child('AgentTools');

export const TOOLS_PROMPT = `
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
        30. list_job_positions() - Lista vagas de emprego abertas.
        31. search_web(query: string) - Pesquisa preços e fornecedores na internet (Google via Serper).
        32. extract_from_url(url: string) - Acessa um link e extrai o conteúdo da página.

        FERRAMENTAS DE AÇÃO (escrita com confirmação na tela; devolvem um LINK):
        33. prepare_create_ticket(subject, message, type_code?, severity_code?, socid?) - Rascunho de ticket de suporte. Se souber o cliente, ache o id antes com search_customer e passe em socid.
        34. prepare_create_customer(name, email?, phone?, address?, town?, zip?, client?) - Rascunho de novo cliente/prospect (client: '1'=cliente, '0' ou '2'=prospect).
        35. prepare_edit_customer(id, name?, email?, phone?, address?, town?, zip?, client?) - Prepara EDIÇÃO de um cliente existente. Ache o id antes com search_customer e informe APENAS os campos a mudar.
        36. prepare_create_project(title, ref?, socid?) - Rascunho de novo projeto. socid = id do cliente (ache com search_customer). ref = referência (ex.: PROJ-2025-001).
        37. prepare_edit_project(id, title) - Prepara EDIÇÃO de um projeto (ex.: renomear). Ache o id antes com list_projects.
        38. prepare_create_supplier(name, email?, phone?, address?, town?, zip?) - Rascunho de novo fornecedor.
        39. prepare_edit_supplier(id, name?, email?, phone?, address?, town?, zip?) - Prepara EDIÇÃO de um fornecedor. Ache o id antes com list_suppliers.
        40. prepare_create_task(label, project_id, description?, planned_workload?, date_start?, date_end?) - Rascunho de tarefa num projeto. project_id obrigatório (ache com list_projects). planned_workload em HORAS; datas em YYYY-MM-DD.
        41. prepare_edit_task(id, label?, description?, planned_workload?, date_start?, date_end?) - Prepara EDIÇÃO de uma tarefa. Ache o id antes com list_tasks. planned_workload em HORAS; datas em YYYY-MM-DD.
        42. prepare_create_category(label, type?, description?) - Rascunho de nova categoria (type: 'product' | 'customer' | 'supplier').
        43. prepare_edit_category(id, label?, type?, description?) - Prepara EDIÇÃO de uma categoria. Ache o id antes com list_categories.

        REGRA PARA AÇÕES (prepare_*): essas ferramentas devolvem um LINK e NÃO alteram nada sozinhas — o usuário revisa e confirma na tela.
        Ao responder ao usuário, inclua o link EXATAMENTE como recebido (não altere o token) e peça para ele clicar para revisar e confirmar.

        EXEMPLO:
        User: "Detalhes do cliente 123"
        Assistant: { "tool": "get_customer_details", "args": { "id": "123" } }
        User: (Sistema retorna detalhes)
        Assistant: "O Cliente X tem 3 faturas em aberto..."
        `;

// --- AÇÕES HITL via deeplink (#57 Peça 2/3) ---
// Registro de entidades que o agente pode propor criar/editar. Adicionar uma entidade =
// uma entrada aqui + (no frontend) ler o prefill na tela correspondente. O agente NUNCA
// escreve direto: gera um deeplink assinado; o usuário revisa e confirma na tela (com a auth dele).
interface DeeplinkEntity {
    label: string;            // nome amigável p/ a mensagem
    createFields?: string[];  // whitelist de campos na criação
    editFields?: string[];    // whitelist de campos na edição
    required?: string[];      // obrigatórios na criação
    newRoute?: string;        // rota de criação (ex.: '/tickets/new')
    editRoute?: string;       // rota de edição com :id (ex.: '/customers/:id/edit')
}

const DEEPLINK_ENTITIES: Record<string, DeeplinkEntity> = {
    ticket: {
        label: 'ticket',
        createFields: ['subject', 'message', 'type_code', 'severity_code', 'socid'],
        required: ['subject', 'message'],
        newRoute: '/tickets/new',
    },
    customer: {
        label: 'cliente',
        createFields: ['name', 'email', 'phone', 'address', 'town', 'zip', 'client'],
        editFields: ['name', 'email', 'phone', 'address', 'town', 'zip', 'client'],
        required: ['name'],
        newRoute: '/customers/new',
        editRoute: '/customers/:id/edit',
    },
    project: {
        label: 'projeto',
        createFields: ['ref', 'title', 'socid'],
        editFields: ['title'],
        required: ['title'],
        newRoute: '/projects/new',
        editRoute: '/projects/:id/edit',
    },
    supplier: {
        label: 'fornecedor',
        createFields: ['name', 'email', 'phone', 'address', 'town', 'zip'],
        editFields: ['name', 'email', 'phone', 'address', 'town', 'zip'],
        required: ['name'],
        newRoute: '/suppliers/new',
        editRoute: '/suppliers/:id/edit',
    },
    task: {
        label: 'tarefa',
        createFields: ['label', 'description', 'project_id', 'planned_workload', 'date_start', 'date_end'],
        editFields: ['label', 'description', 'planned_workload', 'date_start', 'date_end'],
        required: ['label', 'project_id'],
        newRoute: '/tasks/new',
        editRoute: '/tasks/:id/edit',
    },
    category: {
        label: 'categoria',
        createFields: ['label', 'type', 'description'],
        editFields: ['label', 'type', 'description'],
        required: ['label'],
        newRoute: '/categories/new',
        editRoute: '/categories/:id/edit',
    },
};

function pickFields(args: any, fields: string[]): Record<string, string> {
    const out: Record<string, string> = {};
    for (const f of fields) {
        const v = args?.[f];
        if (v !== undefined && v !== null && v !== '') out[f] = String(v);
    }
    return out;
}

// Trata prepare_create_<entity> e prepare_edit_<entity>. Retorna a msg com o deeplink,
// ou null se 'tool' não for uma ferramenta de ação (aí o switch segue p/ "desconhecida").
function tryPrepareDeeplink(tool: string, args: any): string | null {
    const create = tool.match(/^prepare_create_(.+)$/);
    if (create) {
        const ent = DEEPLINK_ENTITIES[create[1]];
        if (!ent?.newRoute) return `Entidade '${create[1]}' não suporta criação via deeplink.`;
        for (const r of ent.required || []) {
            if (!args?.[r]) throw new Error(`Parâmetro '${r}' ausente.`);
        }
        const prefill = pickFields(args, ent.createFields || []);
        const token = signDeeplink(`create_${create[1]}`, prefill, 1800); // 30 min
        const deeplink = `${ent.newRoute}?prefill=${token}`;
        return `Preparei o rascunho do ${ent.label}. Clique para revisar e confirmar a criação na tela: ${deeplink}`;
    }

    const edit = tool.match(/^prepare_edit_(.+)$/);
    if (edit) {
        const ent = DEEPLINK_ENTITIES[edit[1]];
        if (!ent?.editRoute) return `Entidade '${edit[1]}' não suporta edição via deeplink.`;
        if (!args?.id) throw new Error("Parâmetro 'id' ausente (id do registro a editar).");
        const changes = pickFields(args, ent.editFields || []);
        if (Object.keys(changes).length === 0) throw new Error('Nenhum campo para alterar foi informado.');
        const data = { id: String(args.id), ...changes };
        const token = signDeeplink(`edit_${edit[1]}`, data, 1800);
        const deeplink = `${ent.editRoute.replace(':id', String(args.id))}?prefill=${token}`;
        return `Preparei as mudanças no ${ent.label} #${args.id}. Clique para revisar e salvar na tela: ${deeplink}`;
    }

    return null;
}

/** Executa uma ferramenta do agente e retorna o resultado já formatado como string. */
export async function executeTool(tool: string, args: any = {}): Promise<string> {
    log.info(`Tool Call: ${tool}`, args);
    switch (tool) {
        case 'search_customer': {
            if (!args?.query) throw new Error("Parâmetro 'query' ausente.");
            const customers = await dolibarrService.searchThirdParty(args.query);
            return `Resultado da busca: ${JSON.stringify(customers.map((c: any) => ({ id: c.id, name: c.name, email: c.email })))}`;
        }
        case 'get_customer_details': {
            if (!args?.id) throw new Error("Parâmetro 'id' ausente.");
            return await dolibarrService.getCustomerContext(args.id);
        }
        case 'list_invoices': {
            const invs = await dolibarrService.listInvoices(args || {});
            return `Faturas: ${JSON.stringify(invs.map((i: any) => ({ ref: i.ref, total: i.total_ttc, status: i.statut, date: i.date })))}`;
        }
        case 'list_projects': {
            const projs = await dolibarrService.listProjects(args?.search || '');
            return `Projetos: ${JSON.stringify(projs.map((p: any) => ({ ref: p.ref, title: p.title, status: p.statut })))}`;
        }
        case 'list_orders': {
            const orders = await dolibarrService.listOrders(args);
            return `Pedidos: ${JSON.stringify(orders.map((o: any) => ({ ref: o.ref, total: o.total_ttc, status: o.statut, date: o.date_commande })))}`;
        }
        case 'list_proposals': {
            const props = await dolibarrService.listProposals(args);
            return `Propostas: ${JSON.stringify(props.map((p: any) => ({ ref: p.ref, total: p.total_ttc, status: p.statut, date: p.datep })))}`;
        }
        case 'list_tickets': {
            const tickets = await dolibarrService.listTickets(args);
            return `Tickets: ${JSON.stringify(tickets.map((t: any) => ({ track_id: t.track_id, subject: t.subject, message: t.message, date: t.datec })))}`;
        }
        case 'list_products': {
            const prods = await dolibarrService.listProducts(args?.search);
            return `Produtos: ${JSON.stringify(prods.map((p: any) => ({ ref: p.ref, label: p.label, price: p.price })))}`;
        }
        case 'list_bank_accounts': {
            const banks = await dolibarrService.listBankAccounts();
            return `Contas Bancárias: ${JSON.stringify(banks.map((b: any) => ({ label: b.label, balance: b.solde, currency: b.currency_code })))}`;
        }
        case 'list_contracts': {
            const contracts = await dolibarrService.listContracts(args?.search);
            return `Contratos: ${JSON.stringify(contracts.map((c: any) => ({ ref: c.ref, status: c.statut, date: c.date_contrat })))}`;
        }
        case 'list_shipments': {
            const ships = await dolibarrService.listShipments(args?.search);
            return `Expedições: ${JSON.stringify(ships.map((s: any) => ({ ref: s.ref, status: s.statut, date: s.date_creation })))}`;
        }
        case 'list_supplier_invoices': {
            const supInvs = await dolibarrService.listSupplierInvoices(args?.status);
            return `Faturas Fornecedor: ${JSON.stringify(supInvs.map((i: any) => ({ ref: i.ref, total: i.total_ttc, status: i.statut, date: i.datef })))}`;
        }
        case 'list_expense_reports': {
            const expenses = await dolibarrService.listExpenseReports(args?.status);
            return `Despesas: ${JSON.stringify(expenses.map((e: any) => ({ ref: e.ref, total: e.total_ttc, status: e.statut, date: e.date_debut })))}`;
        }
        case 'list_users': {
            const users = await dolibarrService.listUsers(args?.search);
            return `Usuários: ${JSON.stringify(users.map((u: any) => ({ id: u.id, name: u.lastname + ' ' + u.firstname, email: u.email, job: u.job })))}`;
        }
        case 'list_warehouses': {
            const warehouses = await dolibarrService.listWarehouses();
            return `Armazéns: ${JSON.stringify(warehouses.map((w: any) => ({ label: w.label, description: w.description })))}`;
        }
        case 'list_tasks': {
            const tasks = await dolibarrService.listTasks(args?.projectId);
            return `Tarefas: ${JSON.stringify(tasks.map((t: any) => ({ ref: t.ref, label: t.label, progress: t.progress, dateo: t.dateo })))}`;
        }
        case 'list_events': {
            const events = await dolibarrService.listEvents(args?.limit);
            return `Eventos: ${JSON.stringify(events.map((e: any) => ({ label: e.label, datep: e.datep, datef: e.datef, type: e.type_code })))}`;
        }
        case 'list_contacts': {
            const contacts = await dolibarrService.listContacts(args?.search);
            return `Contatos: ${JSON.stringify(contacts.map((c: any) => ({ id: c.id, name: c.lastname + ' ' + c.firstname, email: c.email, phone: c.phone_mobile })))}`;
        }
        case 'list_categories': {
            const cats = await dolibarrService.listCategories(args?.type);
            return `Categorias: ${JSON.stringify(cats.map((c: any) => ({ id: c.id, label: c.label, type: c.type })))}`;
        }
        case 'list_suppliers': {
            const suppliers = await dolibarrService.listSuppliers(args?.search);
            return `Fornecedores: ${JSON.stringify(suppliers.map((s: any) => ({ id: s.id, name: s.name, email: s.email })))}`;
        }
        case 'list_supplier_orders': {
            const supOrders = await dolibarrService.listSupplierOrders(args?.status);
            return `Pedidos Compra: ${JSON.stringify(supOrders.map((o: any) => ({ ref: o.ref, total: o.total_ttc, status: o.statut, date: o.date_commande })))}`;
        }
        case 'list_payments': {
            const payments = await dolibarrService.listPayments(args?.limit);
            return `Pagamentos: ${JSON.stringify(payments.map((p: any) => ({ id: p.id, amount: p.amount, date: p.datep })))}`;
        }
        case 'list_bank_lines': {
            const bankLines = await dolibarrService.listBankLines(args?.accountId, args?.limit);
            return `Movimentações Banco: ${JSON.stringify(bankLines.map((l: any) => ({ label: l.label, amount: l.amount, date: l.dateo })))}`;
        }
        case 'list_stock_movements': {
            const stockMoves = await dolibarrService.listStockMovements(args?.productId);
            return `Movimentações Estoque: ${JSON.stringify(stockMoves.map((m: any) => ({ product: m.fk_product, qty: m.qty, date: m.datem })))}`;
        }
        case 'list_interventions': {
            const interventions = await dolibarrService.listInterventions(args?.search);
            return `Intervenções: ${JSON.stringify(interventions.map((i: any) => ({ ref: i.ref, description: i.description, date: i.datec })))}`;
        }
        case 'list_leave_requests': {
            const leaves = await dolibarrService.listLeaveRequests(args?.status);
            return `Solicitações Férias: ${JSON.stringify(leaves.map((l: any) => ({ ref: l.ref, status: l.statut, date_debut: l.date_debut })))}`;
        }
        case 'list_boms': {
            const boms = await dolibarrService.listBOMs(args?.search);
            return `BOMs: ${JSON.stringify(boms.map((b: any) => ({ ref: b.ref, label: b.label, status: b.status })))}`;
        }
        case 'list_manufacturing_orders': {
            const mos = await dolibarrService.listManufacturingOrders(args?.status);
            return `Ordens Produção: ${JSON.stringify(mos.map((m: any) => ({ ref: m.ref, qty: m.qty, status: m.status, date_start: m.date_start_planned })))}`;
        }
        case 'list_candidates': {
            const candidates = await dolibarrService.listCandidates(args?.search);
            return `Candidatos: ${JSON.stringify(candidates.map((c: any) => ({ id: c.id, name: c.lastname + ' ' + c.firstname, email: c.email })))}`;
        }
        case 'list_job_positions': {
            const jobs = await dolibarrService.listJobPositions(true);
            return jobs.length > 0
                ? `Vagas ABERTAS: ${JSON.stringify(jobs.map((j: any) => ({ ref: j.ref, label: j.label, status: j.status, qty: j.qty })))}`
                : 'Nenhuma vaga aberta no momento.';
        }
        case 'search_web': {
            const searchResults = await ScraperService.searchGoogle(args?.query);
            return `[WEB SEARCH RESULTS]:\n${JSON.stringify(searchResults)}`;
        }
        case 'extract_from_url': {
            if (!isValidExternalUrl(args?.url)) {
                return 'Erro: URL inválida ou bloqueada (IPs privados/internos não são permitidos).';
            }
            const pageContent = await ScraperService.fetchPageContent(args.url);
            return `[PAGE CONTENT for ${args.url}]:\n${pageContent ? pageContent.substring(0, 10000) : 'Falha ao acessar página ou conteúdo vazio'}`;
        }

        // AÇÕES HITL (prepare_create_*/prepare_edit_*) caem no dispatch genérico abaixo.
        default: {
            const deeplinkMsg = tryPrepareDeeplink(tool, args);
            if (deeplinkMsg !== null) return deeplinkMsg;
            return `Ferramenta desconhecida: ${tool}`;
        }
    }
}
