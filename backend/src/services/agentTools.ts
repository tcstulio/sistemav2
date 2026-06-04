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
        34. prepare_edit_ticket(id, subject?, message?, severity_code?) - Prepara EDIÇÃO de um ticket. Ache o id antes com list_tickets. severity_code: 'LOW', 'NORMAL', 'HIGH', 'BLOCKING'.
        35. prepare_create_customer(name, email?, phone?, address?, town?, zip?, client?) - Rascunho de novo cliente/prospect (client: '1'=cliente, '0' ou '2'=prospect).
        36. prepare_edit_customer(id, name?, email?, phone?, address?, town?, zip?, client?) - Prepara EDIÇÃO de um cliente existente. Ache o id antes com search_customer e informe APENAS os campos a mudar.
        37. prepare_create_project(title, ref?, socid?) - Rascunho de novo projeto. socid = id do cliente (ache com search_customer). ref = referência (ex.: PROJ-2025-001).
        38. prepare_edit_project(id, title) - Prepara EDIÇÃO de um projeto (ex.: renomear). Ache o id antes com list_projects.
        39. prepare_create_supplier(name, email?, phone?, address?, town?, zip?) - Rascunho de novo fornecedor.
        40. prepare_edit_supplier(id, name?, email?, phone?, address?, town?, zip?) - Prepara EDIÇÃO de um fornecedor. Ache o id antes com list_suppliers.
        41. prepare_create_task(label, project_id, description?, planned_workload?, date_start?, date_end?) - Rascunho de tarefa num projeto. project_id obrigatório (ache com list_projects). planned_workload em HORAS; datas em YYYY-MM-DD.
        42. prepare_edit_task(id, label?, description?, planned_workload?, date_start?, date_end?) - Prepara EDIÇÃO de uma tarefa. Ache o id antes com list_tasks. planned_workload em HORAS; datas em YYYY-MM-DD.
        43. prepare_create_category(label, type?, description?) - Rascunho de nova categoria (type: 'product' | 'customer' | 'supplier').
        44. prepare_edit_category(id, label?, type?, description?) - Prepara EDIÇÃO de uma categoria. Ache o id antes com list_categories.
        45. prepare_create_event(label, date_start, date_end?, type_code?, description?) - Rascunho de evento na agenda. date_start/date_end no formato "YYYY-MM-DDTHH:mm". type_code: AC_RDV (reunião), AC_TEL (ligação), AC_EMAIL, AC_OTH.
        46. prepare_edit_event(id, label?, date_start?, date_end?, description?, percentage?) - Prepara EDIÇÃO de um evento. Ache o id antes com list_events. date_start/date_end no formato "YYYY-MM-DDTHH:mm". percentage: 0-100 (progresso).
        47. prepare_create_intervention(socid, date?, description?, project_id?) - Rascunho de intervenção (serviço de campo). socid = id do cliente (ache com search_customer). date em YYYY-MM-DD.
        48. prepare_create_job(label, qty?, description?) - Rascunho de nova vaga de emprego (label = cargo; qty = quantidade).
        49. prepare_edit_job(id, label?, qty?, description?) - Prepara EDIÇÃO de uma vaga. Ache o id antes com list_job_positions.
        50. prepare_create_leave(fk_user, date_debut, date_fin, type?, description?) - Rascunho de solicitação de licença/férias. fk_user = id do funcionário (ache com list_users). Datas em YYYY-MM-DD. type: 'Paid Vacation', 'Sick Leave', 'Unpaid', 'Other'.
        51. prepare_edit_leave(id, date_debut?, date_fin?, type?, description?) - Prepara EDIÇÃO de uma licença/férias. Ache o id antes com list_leave_requests. Datas em YYYY-MM-DD. Não troca o funcionário (fk_user).
        52. prepare_create_contact(firstname, lastname, socid, email?, phone_mobile?, poste?) - Rascunho de novo contato. socid = id do cliente (ache com search_customer).
        53. prepare_edit_contact(id, firstname?, lastname?, email?, phone_mobile?, poste?) - Prepara EDIÇÃO de um contato. Ache o id antes com list_contacts.
        54. prepare_create_candidate(firstname, lastname, email, phone?, fk_job_position?, note_public?) - Rascunho de novo candidato (RH/Recrutamento). fk_job_position = id da vaga (ache com list_job_positions); omita para candidato espontâneo.
        55. prepare_edit_candidate(id, firstname?, lastname?, email?, phone?, fk_job_position?, note_public?) - Prepara EDIÇÃO de um candidato. Ache o id antes com list_candidates.
        56. prepare_create_invoice(socid, date?, lines?) - Rascunho de fatura de venda. socid = id do cliente (ache com search_customer). date em YYYY-MM-DD. lines = array de itens [{fk_product?, desc, qty, subprice, remise_percent?}] — fk_product = id do produto (opcional; ache com list_products), desc = descrição, qty = quantidade, subprice = preço unitário, remise_percent = % de desconto.
        57. prepare_create_proposal(socid, date?, project_id?, note_public?, lines?) - Rascunho de proposta comercial. socid = id do cliente. lines = mesma estrutura da fatura [{fk_product?, desc, qty, subprice, remise_percent?}].
        58. prepare_create_supplier_invoice(socid, date?, lines?) - Rascunho de fatura de fornecedor. socid = id do fornecedor (ache com list_suppliers). lines = [{desc, qty, subprice, remise_percent?}] (sem produto).
        59. prepare_create_supplier_proposal(socid, date?, project_id?, lines?) - Rascunho de solicitação de preço a fornecedor. socid = id do fornecedor. lines = [{fk_product?, desc, qty, subprice, remise_percent?}].
        60. prepare_create_order(socid, date?, lines?) - Rascunho de pedido de venda. socid = id do cliente (ache com search_customer). lines = [{fk_product?, desc, qty, subprice}].
        61. prepare_create_mo(product_to_produce_id, qty?, label?, project_id?, date_start?) - Rascunho de ordem de produção (MRP). product_to_produce_id = id do produto a produzir (ache com list_products). date_start em YYYY-MM-DD.
        62. prepare_create_bom(product_id, qty?, label?, duration?) - Rascunho de lista de materiais (BOM). product_id = id do produto final (ache com list_products). duration em segundos.
        63. prepare_edit_invoice(id, date?, lines?) - Prepara EDIÇÃO de uma fatura. Ache o id antes com list_invoices. date em YYYY-MM-DD. lines = itens a ACRESCENTAR [{fk_product?, desc, qty, subprice, remise_percent?}].
        64. prepare_edit_proposal(id, date?, note_public?, project_id?, lines?) - Prepara EDIÇÃO de uma proposta. Ache o id antes com list_proposals. lines = itens a ACRESCENTAR.
        65. prepare_edit_supplier_invoice(id, date?, lines?) - Prepara EDIÇÃO de uma fatura de fornecedor. lines = itens a ACRESCENTAR [{desc, qty, subprice, remise_percent?}].
        66. prepare_edit_supplier_proposal(id, date?, project_id?, lines?) - Prepara EDIÇÃO de uma solicitação de preço. lines = itens a ACRESCENTAR.
        67. prepare_create_product(ref, label, type?, price?, description?) - Rascunho de novo produto/serviço. ref = referência única; type: '0'=produto, '1'=serviço; price = preço unitário.
        68. prepare_edit_product(id, ref?, label?, type?, price?, description?) - Prepara EDIÇÃO de um produto/serviço. Ache o id antes com list_products.

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
    createFields?: string[];  // whitelist de campos escalares na criação
    editFields?: string[];    // whitelist de campos na edição
    required?: string[];      // obrigatórios na criação
    newRoute?: string;        // rota de criação (ex.: '/tickets/new')
    editRoute?: string;       // rota de edição com :id (ex.: '/customers/:id/edit')
    linesField?: string;      // nome do campo de LINHAS no prefill (ex.: 'lines') p/ entidades com itens
    lineFields?: string[];    // whitelist dos campos de cada linha (ex.: ['fk_product','desc','qty','subprice'])
}

const DEEPLINK_ENTITIES: Record<string, DeeplinkEntity> = {
    ticket: {
        label: 'ticket',
        createFields: ['subject', 'message', 'type_code', 'severity_code', 'socid'],
        editFields: ['subject', 'message', 'severity_code'],
        required: ['subject', 'message'],
        newRoute: '/tickets/new',
        editRoute: '/tickets/:id/edit',
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
    event: {
        label: 'evento',
        createFields: ['label', 'date_start', 'date_end', 'type_code', 'description'],
        // edição é feita no AgendaEntryDetail (campos visíveis no form: título, datas, descrição, progresso).
        editFields: ['label', 'date_start', 'date_end', 'description', 'percentage'],
        required: ['label', 'date_start'],
        newRoute: '/agenda/new',
        editRoute: '/agenda/:id/edit',
    },
    intervention: {
        label: 'intervenção',
        // modal de edição ainda não existe — por ora só criação.
        createFields: ['socid', 'project_id', 'date', 'description'],
        required: ['socid'],
        newRoute: '/interventions/new',
    },
    job: {
        label: 'vaga',
        createFields: ['label', 'qty', 'description'],
        editFields: ['label', 'qty', 'description'],
        required: ['label'],
        newRoute: '/hr/jobs/new',
        editRoute: '/hr/jobs/:id/edit',
    },
    leave: {
        label: 'licença/férias',
        createFields: ['fk_user', 'date_debut', 'date_fin', 'type', 'description'],
        // fk_user é imutável após criação (não troca o funcionário da licença).
        editFields: ['date_debut', 'date_fin', 'type', 'description'],
        required: ['fk_user', 'date_debut', 'date_fin'],
        newRoute: '/hr/leaves/new',
        editRoute: '/hr/leaves/:id/edit',
    },
    contact: {
        label: 'contato',
        createFields: ['firstname', 'lastname', 'email', 'phone_mobile', 'poste', 'socid'],
        editFields: ['firstname', 'lastname', 'email', 'phone_mobile', 'poste'],
        required: ['firstname', 'lastname', 'socid'],
        newRoute: '/contacts/new',
        editRoute: '/contacts/:id/edit',
    },
    candidate: {
        label: 'candidato',
        createFields: ['firstname', 'lastname', 'email', 'phone', 'fk_job_position', 'note_public'],
        editFields: ['firstname', 'lastname', 'email', 'phone', 'fk_job_position', 'note_public'],
        required: ['firstname', 'lastname', 'email'],
        newRoute: '/hr/candidates/new',
        editRoute: '/hr/candidates/:id/edit',
    },
    invoice: {
        label: 'fatura',
        createFields: ['socid', 'date'],
        // edição: campos escalares + linhas extras a ACRESCENTAR (o modal já faz o diff).
        editFields: ['date'],
        required: ['socid'],
        newRoute: '/invoices/new',
        editRoute: '/invoices/:id/edit',
        // entidade com linhas de produto (o modal exibe os itens p/ revisão):
        linesField: 'lines',
        lineFields: ['fk_product', 'desc', 'qty', 'subprice', 'remise_percent'],
    },
    proposal: {
        label: 'proposta comercial',
        createFields: ['socid', 'date', 'project_id', 'note_public'],
        editFields: ['date', 'note_public', 'project_id'],
        required: ['socid'],
        newRoute: '/proposals/new',
        editRoute: '/proposals/:id/edit',
        linesField: 'lines',
        lineFields: ['fk_product', 'desc', 'qty', 'subprice', 'remise_percent'],
    },
    supplier_invoice: {
        label: 'fatura de fornecedor',
        createFields: ['socid', 'date'],
        editFields: ['date'],
        required: ['socid'],
        newRoute: '/supplier_invoices/new',
        editRoute: '/supplier_invoices/:id/edit',
        linesField: 'lines',
        lineFields: ['desc', 'qty', 'subprice', 'remise_percent'], // sem produto (linhas livres)
    },
    supplier_proposal: {
        label: 'solicitação de preço',
        createFields: ['socid', 'date', 'project_id'],
        editFields: ['date', 'project_id'],
        required: ['socid'],
        newRoute: '/supplier_proposals/new',
        editRoute: '/supplier_proposals/:id/edit',
        linesField: 'lines',
        lineFields: ['fk_product', 'desc', 'qty', 'subprice', 'remise_percent'],
    },
    order: {
        label: 'pedido de venda',
        createFields: ['socid', 'date'],
        required: ['socid'],
        newRoute: '/orders/new',
        linesField: 'lines',
        lineFields: ['fk_product', 'desc', 'qty', 'subprice'],
    },
    mo: {
        label: 'ordem de produção',
        createFields: ['label', 'product_to_produce_id', 'qty', 'project_id', 'date_start'],
        required: ['product_to_produce_id'],
        newRoute: '/manufacturing/mo/new',
    },
    bom: {
        label: 'lista de materiais (BOM)',
        createFields: ['label', 'product_id', 'qty', 'duration'],
        required: ['product_id'],
        newRoute: '/manufacturing/bom/new',
    },
    product: {
        label: 'produto/serviço',
        createFields: ['ref', 'label', 'type', 'price', 'description'],
        editFields: ['ref', 'label', 'type', 'price', 'description'],
        required: ['ref', 'label'],
        newRoute: '/products/new',
        editRoute: '/products/:id/edit',
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

// Extrai e normaliza as LINHAS de itens (entidades com produtos). Campos textuais
// (fk_product/desc) viram string; numéricos (qty/subprice/remise_percent/tva_tx) viram Number.
function pickLines(args: any, ent: DeeplinkEntity): any[] | undefined {
    if (!ent.linesField || !ent.lineFields) return undefined;
    const arr = args?.[ent.linesField];
    if (!Array.isArray(arr)) return undefined;
    const textFields = new Set(['fk_product', 'desc', 'description']);
    return arr
        .map((raw: any) => {
            const line: Record<string, any> = {};
            for (const f of ent.lineFields!) {
                const v = raw?.[f];
                if (v === undefined || v === null || v === '') continue;
                line[f] = textFields.has(f) ? String(v) : Number(v);
            }
            return line;
        })
        .filter((l: Record<string, any>) => Object.keys(l).length > 0);
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
        const prefill: Record<string, any> = pickFields(args, ent.createFields || []);
        const lines = pickLines(args, ent);
        if (lines && lines.length > 0 && ent.linesField) prefill[ent.linesField] = lines;
        const token = signDeeplink(`create_${create[1]}`, prefill, 1800); // 30 min
        const deeplink = `${ent.newRoute}?prefill=${token}`;
        return `Preparei o rascunho do ${ent.label}. Clique para revisar e confirmar a criação na tela: ${deeplink}`;
    }

    const edit = tool.match(/^prepare_edit_(.+)$/);
    if (edit) {
        const ent = DEEPLINK_ENTITIES[edit[1]];
        if (!ent?.editRoute) return `Entidade '${edit[1]}' não suporta edição via deeplink.`;
        if (!args?.id) throw new Error("Parâmetro 'id' ausente (id do registro a editar).");
        const changes: Record<string, any> = pickFields(args, ent.editFields || []);
        const lines = pickLines(args, ent); // entidades com itens: linhas extras a ACRESCENTAR
        if (lines && lines.length > 0 && ent.linesField) changes[ent.linesField] = lines;
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
