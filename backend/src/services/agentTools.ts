// Registro UNIFICADO de ferramentas do agente.
// Antes, GoogleProvider e LocalProvider tinham switches separados (Gemini: 32 tools;
// GLM/Ollama: 5 "Lite"). Agora ambos usam TOOLS_PROMPT + executeTool daqui — então
// qualquer provider tem o mesmo conjunto completo de ferramentas.
import { AsyncLocalStorage } from 'async_hooks';
import { dolibarrService } from './dolibarrService';
import { ScraperService } from './scraperService';
import { isValidExternalUrl } from '../utils/urlValidation';
import { logger } from '../utils/logger';
import { signDeeplink } from '../utils/deeplinkToken';
import { minimaxService } from './minimaxService';
import { zaiSearchService } from './zaiSearchService';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import { getRecentLogs } from '../utils/logger';
import { agentConfigService } from './agentConfigService';
import { channelRouter } from './channelRouter';

const execFileAsync = promisify(execFile);
const PROJECT_ROOT = path.resolve(__dirname, '../../..');

const log = logger.child('AgentTools');

export class AskUserInterrupt extends Error {
    constructor(public readonly question: string) {
        super(question);
        this.name = 'AskUserInterrupt';
    }
}

type ToolCallListener = (tool: string, args: Record<string, any>, result: string, durationMs: number) => void;

interface ToolContext {
    listener: ToolCallListener | null;
    userId?: string;
    userLogin?: string;
    isAdmin?: boolean;
    permissionProfile?: import('./userPermissionsService').UserPermissionProfile | null;
    /**
     * Quando true, bloqueia TODA ferramenta que escreve ou tem efeito externo, independente
     * de profile/admin. Usado para entrada não-confiável (ex.: bot de WhatsApp respondendo a
     * mensagens externas), onde o agente deve ser estritamente somente-leitura.
     */
    readOnly?: boolean;
}

const toolContextStore = new AsyncLocalStorage<ToolContext>();

const DEFAULT_TOOL_CONTEXT: ToolContext = { listener: null };

export function setToolCallListener(fn: ToolCallListener | null) {
    const store = toolContextStore.getStore();
    if (store) {
        store.listener = fn;
    } else {
        DEFAULT_TOOL_CONTEXT.listener = fn;
    }
}

export function runWithToolContext<T>(ctx: Partial<ToolContext>, fn: () => Promise<T>): Promise<T> {
    const merged: ToolContext = { ...DEFAULT_TOOL_CONTEXT, ...ctx };
    return toolContextStore.run(merged, fn);
}

export function getToolContext(): ToolContext {
    return toolContextStore.getStore() || DEFAULT_TOOL_CONTEXT;
}

export const TOOLS_PROMPT = `
        FERRAMENTAS DISPONÍVEIS:
        Você pode buscar dados em tempo real se necessário. Para usar uma ferramenta, responda APENAS com um JSON no seguinte formato:
        { "tool": "nome_da_ferramenta", "args": { ... } }

        MODELO DE DADOS (relações entre entidades):
        Cliente (thirdparty) ──fk_soc──→ Projeto ──fk_projet──→ Tarefa
        Cliente ──fk_soc──→ Fatura, Pedido, Proposta, Contrato
        Projeto ──fk_project──→ Tarefa ──fk_task──→ TimeSpent
        Tarefa ──fk_user_assign──→ Usuário
        Use a tool \`search\` quando quiser encontrar entidades relacionadas.

        FERRAMENTA DE BUSCA UNIFICADA (use como primeira escolha):
        1. search(query: string) - Busca cruzada em TODAS as entidades (clientes, projetos, tarefas, faturas, pedidos, propostas). Retorna o grafo de relacionamentos automaticamente. Exemplo: search("carvalhos") encontra o cliente, seus projetos, tarefas e faturas.

        FERRAMENTAS DE DETALHE (use quando já tem o ID):
        2. search_customer(query: string) - Busca clientes por nome, email ou alias.
        3. get_customer_details(id: string) - Traz faturas, projetos e agenda de um cliente específico.
        4. list_invoices(status: 'unpaid' | 'paid' | 'draft', limit: number) - Lista faturas de clientes.
        5. list_projects(search: string, socid: string) - Lista projetos. socid = id do cliente para filtrar projetos de um cliente específico.
        6. list_orders(status: 'draft'|'validated'|'processed', search: string) - Lista pedidos de venda.
        7. list_proposals(status: 'draft'|'open'|'signed', search: string) - Lista propostas comerciais.
        8. list_tickets(search: string) - Lista tickets de suporte.
        9. list_products(search: string) - Lista produtos e serviços.
        10. list_bank_accounts() - Lista contas bancárias e saldos.
        11. list_contracts(search: string) - Lista contratos ativos/recentes.
        12. list_shipments(search: string) - Lista envios/expedições.
        13. list_supplier_invoices(status: 'unpaid'|'paid') - Lista faturas de fornecedor.
        14. list_expense_reports(status: 'approved'|'paid') - Lista relatórios de despesas.
        15. list_users(search: string) - Lista usuários/funcionários.
        16. list_warehouses() - Lista estoques/armazéns.
        17. list_tasks(projectId: string) - Lista tarefas de um projeto.
        18. list_user_tasks(userId?: string) - Lista as tarefas atribuídas a um usuário. Omita userId para listar as tarefas do PRÓPRIO usuário logado ("minhas tarefas").
        19. list_events(limit: number) - Lista eventos da agenda.
        20. list_contacts(search: string) - Lista contatos (pessoas de contato).
        21. list_categories(type: string) - Lista categorias (customer, product, etc).
        22. list_suppliers(search: string) - Lista fornecedores.
        23. list_supplier_orders(status: 'draft'|'validated') - Lista pedidos de compra.
        24. list_payments(limit: number) - Lista pagamentos recebidos.
        25. list_bank_lines(accountId: string, limit: number) - Lista linhas/movimentações de conta bancária.
        26. list_stock_movements(productId: string) - Lista movimentações de estoque.
        27. list_interventions(search: string) - Lista intervenções/serviços em campo.
        28. list_leave_requests(status: string) - Lista solicitações de férias/ausências.
        29. list_boms(search: string) - Lista listas técnicas (BOM).
        30. list_manufacturing_orders(status: 'draft'|'validated'|'inprogress') - Lista ordens de produção.
        31. list_candidates(search: string) - Lista candidatos (RH/Recrutamento).
        32. list_job_positions() - Lista vagas de emprego abertas.
        33. search_web(query: string) - Pesquisa preços e fornecedores na internet (Google via Serper).
        34. extract_from_url(url: string) - Acessa um link e extrai o conteúdo da página.

        FERRAMENTAS DE AÇÃO (escrita com confirmação na tela; devolvem um LINK):
        33. prepare_create_ticket(subject, message, type_code?, severity_code?, socid?) - Rascunho de ticket de suporte. Se souber o cliente, ache o id antes com search_customer e passe em socid.
        34. prepare_edit_ticket(id, subject?, message?, severity_code?) - Prepara EDIÇÃO de um ticket. Ache o id antes com list_tickets. severity_code: 'LOW', 'NORMAL', 'HIGH', 'BLOCKING'.
        35. prepare_create_customer(name, email?, phone?, phone_mobile?, fax?, url?, idprof1?, typent_id?, name_alias?, address?, town?, zip?, client?, array_options?) - Rascunho de novo cliente/prospect (client: '1'=cliente, '0' ou '2'=prospect; typent_id: '8'=PF, '5'=PJ; idprof1=CNPJ/CPF; array_options.options_assinante=responsável legal PJ).
        36. prepare_edit_customer(id, name?, email?, phone?, phone_mobile?, fax?, url?, idprof1?, typent_id?, name_alias?, address?, town?, zip?, client?, array_options?) - Prepara EDIÇÃO de um cliente existente. Ache o id antes com search_customer e informe APENAS os campos a mudar.
        37. prepare_create_project(title, ref?, socid?) - Rascunho de novo projeto. socid = id do cliente (ache com search_customer). ref = referência (ex.: PROJ-2025-001).
        38. prepare_edit_project(id, title) - Prepara EDIÇÃO de um projeto (ex.: renomear). Ache o id antes com list_projects.
        39. prepare_create_supplier(name, email?, phone?, phone_mobile?, fax?, url?, idprof1?, typent_id?, name_alias?, address?, town?, zip?, code_fournisseur?, array_options?) - Rascunho de novo fornecedor (typent_id: '8'=PF, '5'=PJ; idprof1=CNPJ/CPF; array_options.options_assinante=responsável legal PJ).
        40. prepare_edit_supplier(id, name?, email?, phone?, phone_mobile?, fax?, url?, idprof1?, typent_id?, name_alias?, address?, town?, zip?, code_fournisseur?, array_options?) - Prepara EDIÇÃO de um fornecedor. Ache o id antes com list_suppliers.
        41. prepare_create_task(label, project_id, description?, planned_workload?, date_start?, date_end?, fk_user_assign?) - Rascunho de tarefa num projeto. project_id obrigatório (ache com list_projects). planned_workload em HORAS; datas em YYYY-MM-DD. fk_user_assign = id do usuário responsável (ache com list_users).
        42. prepare_edit_task(id, label?, description?, planned_workload?, date_start?, date_end?) - Prepara EDIÇÃO de uma tarefa. Ache o id antes com list_tasks. planned_workload em HORAS; datas em YYYY-MM-DD.
        42b. prepare_create_delegation(label, project_id, fk_user_assign, date_end?, criterio?, description?) - Cria uma DELEGAÇÃO: tarefa + responsável + critério de pronto, pedindo o ACEITE do responsável. Use quando alguém PEDE algo a outra pessoa ("peça pro fulano entregar X até sexta"). project_id e fk_user_assign obrigatórios (ache com list_projects/list_users). date_end (prazo) em YYYY-MM-DD. criterio = como saber que terminou. O solicitante é quem confirmar.
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
        69. prepare_create_user(login, email, firstname?, lastname?, job?, supervisor_id?) - Rascunho de novo usuário do sistema. login e email obrigatórios. supervisor_id = id do gestor (ache com list_users).
        70. prepare_edit_user(id, firstname?, lastname?, email?, job?, supervisor_id?) - Prepara EDIÇÃO de um usuário. Ache o id antes com list_users. Não troca o login.
        71. prepare_create_group(name, note?) - Rascunho de novo grupo de usuários.
        72. prepare_edit_group(id, name?, note?) - Prepara EDIÇÃO de um grupo. Ache o id antes com a lista de grupos.
        73. prepare_create_contract(socid, date_contrat?, date_fin_validite?, note_public?) - Rascunho de novo contrato. socid = id do cliente. Datas em YYYY-MM-DD.
        74. prepare_edit_contract(id, date_contrat?, date_fin_validite?, note_public?) - Prepara EDIÇÃO de um contrato. Ache o id antes com list_contracts. Datas em YYYY-MM-DD.
        75. prepare_edit_intervention(id, description?, date?, project_id?) - Prepara EDIÇÃO de uma intervenção. Ache o id antes com list_interventions. date em YYYY-MM-DD.
        76. prepare_create_expense(fk_user_author, date_debut, date_fin, total_ttc?, note_public?) - Rascunho de relatório de despesa. fk_user_author = id do funcionário (ache com list_users). Datas em YYYY-MM-DD. total_ttc = valor total.
        77. prepare_edit_expense(id, date_debut?, date_fin?, total_ttc?, note_public?) - Prepara EDIÇÃO de um relatório de despesa. Ache o id antes com list_expense_reports. Não troca o funcionário.
        78. prepare_edit_bom(id, label?, qty?, duration?) - Prepara EDIÇÃO de uma lista de materiais (BOM). Ache o id antes com list_boms. duration em segundos. Não troca o produto final.
        79. prepare_edit_mo(id, label?, qty?) - Prepara EDIÇÃO de uma ordem de produção (MRP). Ache o id antes com list_manufacturing_orders. Não troca o produto a produzir.
        80. prepare_edit_order(id, date?) - Prepara EDIÇÃO do cabeçalho de um pedido de venda. Ache o id antes com list_orders. date em YYYY-MM-DD. Não troca o cliente nem os itens (só o cabeçalho).

        FERRAMENTA DE LOTE (criar VÁRIOS de uma vez, numa única tela de confirmação):
        85. prepare_batch_create(entity, items) - Cria EM LOTE vários itens da MESMA entidade. entity = tipo ('customer','contact','product','project','supplier','task','ticket','invoice','proposal','order',...); items = array onde cada elemento tem os campos daquele tipo (os mesmos do prepare_create_<entity>), incluindo 'lines' (array) para entidades com itens (fatura/proposta/pedido/etc.). Devolve UM ÚNICO link de revisão em lote. Use quando o usuário pedir para criar vários registros de uma vez. Máx. 50 itens.

        FERRAMENTAS DE MÍDIA (geram um arquivo e devolvem um LINK válido por ~24h):
        81. generate_speech(text, voice_id?) - Gera ÁUDIO (TTS) do texto e devolve o link do mp3. Use quando o usuário pedir áudio/voz/narração.
        82. generate_image(prompt, aspect_ratio?) - Gera uma IMAGEM a partir da descrição e devolve o link. aspect_ratio ex.: '1:1', '16:9', '9:16'.
        83. generate_video(prompt, duration?, resolution?) - Inicia a geração de um VÍDEO (assíncrono) e devolve um task_id. duration: 6 ou 10 (seg); resolution: '768P' ou '1080P'. O vídeo NÃO fica pronto na hora.
        84. check_video(task_id) - Verifica o status do vídeo iniciado por generate_video. Quando pronto, devolve o link. Senão, informa que ainda está processando.

        FERRAMENTA DE PESQUISA NA WEB:
        86. web_search(query) - Pesquisa na INTERNET e devolve os principais resultados (título, link e trecho). Use para informações externas ao sistema: cotações de moedas, notícias, dados de empresas/CNPJ, endereços, preços de mercado, fatos atuais. NÃO use para dados internos (clientes, faturas, tarefas — para esses use as ferramentas do sistema). Cite os links relevantes na resposta.

        REGRA PARA MÍDIA (generate_*): devolvem um LINK pronto. Inclua o link na resposta para o usuário ouvir/ver.
        REGRA PARA VÍDEO: generate_video devolve um task_id e demora minutos; avise o usuário e use check_video(task_id) depois (ex.: quando ele pedir o resultado) para obter o link.

        FERRAMENTAS DE VALIDAÇÃO (confirma entidades do Dolibarr — ação imediata, sem deeplink):
        108. validate_invoice(invoice_id) - Valida (confirma) uma fatura de venda em rascunho. invoice_id = id da fatura (ache com list_invoices). Muda status de rascunho para validada.
        109. validate_order(order_id) - Valida (confirma) um pedido de venda em rascunho. order_id = id do pedido (ache com list_orders). Muda status de rascunho para validado.
        110. validate_proposal(proposal_id) - Valida (confirma) uma proposta comercial em rascunho. proposal_id = id da proposta (ache com list_proposals). Muda status de rascunho para validada.

        FERRAMENTAS DE DOCUMENTO (PDF):
        111. get_document_pdf(entity_type, entity_id) - Obtém o PDF de um documento Dolibarr e retorna como base64. entity_type: 'invoice', 'order', 'proposal', 'supplier_order', 'supplier_invoice', 'intervention', 'contract', 'shipment'. entity_id = id do documento (ache com list_invoices, list_orders, etc.). Retorna o PDF em base64 para download ou envio.

        FERRAMENTAS FINANCEIRAS:
        112. get_financial_summary() - Resumo financeiro geral: saldo bancário total, contas a receber, contas a pagar, propostas abertas, posição líquida. Use quando o usuário perguntar "como está a saúde financeira?", "qual o saldo?", "quanto devemos?", "quanto temos a receber?".
        113. get_bank_balance(account_id?) - Saldo bancário. Sem account_id retorna todas as contas. Com account_id retorna apenas aquela conta. Use quando o usuário perguntar "qual o saldo do Inter?".
        114. get_accounts_receivable(date_from?, date_to?) - Faturas a receber (não pagas). Opcionalmente filtra por período de vencimento (YYYY-MM-DD). Mostra valor, vencimento, se está atrasada, e cliente. Use quando o usuário perguntar "o que temos a receber?", "quais faturas estão atrasadas?".
        115. get_accounts_payable(date_from?, date_to?) - Contas a pagar: faturas de fornecedor não pagas + despesas pendentes. Opcionalmente filtra por período. Use quando o usuário perguntar "o que temos a pagar?", "quais contas vencem essa semana?".
        116. get_cash_flow_forecast(date_from, date_to) - Fluxo de caixa projetado semanal. Mostra receitas previstas - despesas previstas por semana, com acumulado. date_from e date_to obrigatórios (YYYY-MM-DD). Use quando o usuário perguntar "como fica o fluxo de caixa até o fim do mês?", "previsão de caixa".

        FERRAMENTAS DE SETUP/CONFIGURAÇÃO:
        117. get_company_info() - Dados da empresa (nome, CNPJ, endereço, email, telefone, site, moeda, idioma). Use quando precisar de dados da empresa para preencher formulários ou responder perguntas sobre a empresa.
        118. list_payment_types() - Métodos de pagamento disponíveis no sistema (ex.: PIX, boleto, cartão). Use para saber quais formas de pagamento oferecer ao cliente.
        119. list_tax_rates() - Taxas de imposto cadastradas (ICMS, PIS, COFINS, etc.). Use para verificar qual alíquota aplicar.
        120. list_currencies() - Moedas disponíveis no sistema com cotações.
        121. list_countries() - Países disponíveis com códigos ISO.

        FERRAMENTAS DE VERIFICAÇÃO E COMUNICAÇÃO:
        99. read_project_file(file_path, offset?, limit?) - Lê um arquivo de código-fonte do projeto. Use para VERIFICAR se um bug é real antes de criar uma issue. file_path é relativo à raiz (ex.: 'src/components/InterventionList.tsx', 'backend/src/routes/interventionRoutes.ts'). Retorna até 500 linhas. Use offset (linha inicial) e limit (max linhas) para paginar.
        100. ask_user(question) - Faz uma pergunta ao usuário e PARA a execução para aguardar a resposta. Use quando: (a) não tem certeza se algo é um bug real, (b) precisa de mais detalhes antes de criar uma issue, (c) quer confirmar se deve prosseguir com uma ação destrutiva. SEMPRE prefira perguntar a assumir.
        101. search_code(pattern, path?) - Busca um texto/regex em todos os arquivos do projeto (grep). Retorna os arquivos e linhas onde encontrou. Use para ENCONTRAR qual arquivo contém um componente, função ou trecho de código antes de ler o arquivo completo. pattern = texto ou regex (ex.: 'ConfirmDelete', 'function deleteIntervention', 'ArrowLeft'). path = subdiretório opcional (ex.: 'src/components').
        102. project_structure(path?) - Lista a árvore de diretórios do projeto. path = subdiretório opcional (ex.: 'src/components'). Use para ENTENDER a estrutura do projeto antes de procurar arquivos.
        103. read_logs(lines?) - Lê as últimas linhas do log do backend (erros, warnings, requests). lines = quantas linhas (padrão 50, máx 200). Use para VERIFICAR erros reais de runtime antes de criar bug reports.
        104. git_recent(limit?) - Lista os últimos commits do repositório. limit = quantos (padrão 10). Mostra hash, mensagem e data. Use para entender O QUE MUDOU recentemente e correlacionar com bugs.

        FERRAMENTAS DE NOTIFICAÇÃO:
        105. notify_team(message, priority?) - Manda uma notificação in-app pra toda a equipe. Use quando faz algo que os outros precisam saber (criou fatura, validou pedido, etc.).
        106. notify_person(name, phone?, email?, message, channels?) - Manda notificação pra uma pessoa específica (cliente, fornecedor, membro da equipe). channels = array com "whatsapp" e/ou "email" e/ou "in-app". Precisa de phone pra WhatsApp, email pra email.
        107. send_whatsapp(phone, message) - Manda WhatsApp direto pra qualquer número. phone = número com código país (ex.: "5511999999999").

        FERRAMENTA DE GESTÃO DO PROJETO:
        90. create_github_issue(title, body, labels?) - Cria um issue no GitHub do projeto (tcstulio/sistemav2). Use quando o usuário reportar um bug, solicitar uma feature, ou pedir para registrar algo. labels opcionais: 'bug', 'enhancement', 'security', 'question' (pode ser string ou array). IMPORTANTE: antes de criar, SEMPRE use list_github_issues para verificar se já existe um issue similar aberto. NÃO crie duplicatas.
        91. list_github_issues(state?, label?, limit?) - Lista issues do GitHub do projeto. state: 'open' (padrão), 'closed', 'all'. label: filtrar por label (ex.: 'bug', 'enhancement'). limit: máx de issues (padrão 20). Retorna número, título, estado, labels e link.
        92. create_bug_report(title, error_message, route, component?) - Cria um issue de bug com contexto de erro (rota, componente, stack trace). Use quando o usuário reportar um erro visual ou crash. Preencha title, error_message e route automaticamente.

        FERRAMENTA DE AJUDA DE TELA:
        93. get_screen_help(route) - Retorna a descrição completa de uma tela do sistema (label, descrição, ações, campos, dicas). Use quando o usuário perguntar "o que essa tela faz?", "como uso essa tela?" ou "onde faço X?". route = caminho da tela (ex.: '/customers', '/invoices').

        FERRAMENTAS DE TASK RUNNER (automação opencode):
        94. create_opencode_task(title, body, labels?) - Cria uma issue com label "opencode-task" para execução automática pelo opencode. Use quando o usuário pedir para implementar algo, corrigir algo, ou qualquer tarefa de código. Retorna o link da task criada. IMPORTANTE: antes de criar, SEMPRE use list_github_issues ou list_opencode_tasks para verificar se já existe um issue/task similar aberto. NÃO crie duplicatas. Chame esta ferramenta NO MÁXIMO UMA VEZ por solicitação do usuário.
        95. list_opencode_tasks(status?) - Lista tasks do board opencode. status: 'pending', 'running', 'reviewing', 'approved', 'merged', 'rejected', 'failed'. Sem status = todas. Retorna número, título, status, score do judge e PR.
        96. start_opencode_task(issueNumber) - Inicia a execução automática de uma task (opencode implementa e abre PR). Use quando o usuário disser "iniciar task", "executar" ou "começar". Retorna status atualizado.
        97. opencode_task_feedback(issueNumber, feedback) - Envia instrução adicional para corrigir uma task em andamento. Use quando o usuário disser para ajustar algo na task.
        98. merge_opencode_task(issueNumber) - Mergea o PR da task e fecha a issue. Use quando o usuário aprovar o resultado.

        REGRA PARA AÇÕES (prepare_*): essas ferramentas devolvem um LINK e NÃO alteram nada sozinhas — o usuário revisa e confirma na tela.
        Ao responder ao usuário, inclua o link EXATAMENTE como recebido (não altere o token) e peça para ele clicar para revisar e confirmar.

        REGRAS OBRIGATÓRIAS:
        1. NUNCA passe query vazia em search_customer ou search — sempre use um termo específico. Se o usuário não disse o nome, pergunte antes de buscar.
        2. Sempre que possível, use a tool "search" (busca unificada) como PRIMEIRA ESCOLHA — ela já traz entidades relacionadas automaticamente.
        3. Para criar/editar registros, SEMPRE busque o ID antes (use search, list_*, ou search_customer). Nunca invente IDs.
        4. Os resultados das ferramentas contêm LINKS navegáveis (HTML). Inclua-os na resposta para o usuário clicar.
        5. Se uma ferramenta retornar "nenhum resultado", informe o usuário e sugira alternativas (mudar o termo, buscar outra entidade).
        6. **NUNCA crie issues de bug sem VERIFICAR o código primeiro** — use search_code para encontrar o arquivo, read_project_file para ler, e read_logs para ver erros reais. Se não tiver certeza, use ask_user para perguntar o usuário antes de criar a issue.
        7. **NUNCA crie issues em sequência sobre o mesmo tema** — se criou uma issue sobre "delete intervenção", NÃO crie outra sobre "excluir intervenção" ou "apagar intervenção". Uma issue por problema.
        8. **Se o usuário não pediu explicitamente para criar uma issue, NÃO crie** — apenas informe o problema e pergunte se deseja registrar.
        9. **NUNCA assuma que algo está quebrado sem evidência** — um erro de API pode ser temporário; uma tela que você não viu pode funcionar normalmente. Quando em dúvida, use ask_user.

        EXEMPLOS DE FORMATO (OBRIGATÓRIO usar EXATAMENTE este formato JSON):
        User: "Quais faturas estão em aberto?"
        Assistant: { "tool": "list_invoices", "args": { "status": "unpaid", "limit": 10 } }
        User: (Sistema retorna dados)
        Assistant: "Encontrei 3 faturas em aberto..."

        User: "Crie uma issue de bug no login"
        Assistant: { "tool": "create_github_issue", "args": { "title": "Bug no login", "body": "Erro ao fazer login na tela principal", "labels": ["bug"] } }

        User: "Liste as issues abertas"
        Assistant: { "tool": "list_github_issues", "args": { "state": "open", "limit": 20 } }

        IMPORTANTE: Use SEMPRE o formato {"tool": "nome_exato", "args": {...}}. NÃO use <tool_call:> ou outros formatos.

        REGRA CRÍTICA — NUNCA "anuncie e pare": se você VAI usar uma ferramenta, emita o JSON dela
        AGORA, na MESMA resposta (só o JSON, sem texto antes). É PROIBIDO dizer coisas como "vou
        verificar os logs:", "deixa eu investigar...", "vou começar checando o código..." e encerrar
        sem o JSON — isso trava a tarefa, pois o sistema NÃO continua sozinho após uma resposta em
        texto. Ou você chama a ferramenta imediatamente (JSON), ou já responde direto ao usuário.

        SOBRE VOCÊ:
        - Você é o assistente virtual do CoolGroove (sistemav2), um ERP baseado em Dolibarr.
        - O contexto da conversa inclui a IDENTIDADE DO USUÁRIO (login, nome, email, cargo, admin). Use isso para personalizar respostas.
        - Se o usuário é admin, você pode sugerir ações administrativas. Se não é admin, limite-se ao que ele pode fazer.
        - O sistema roda em Express+TypeScript (backend) e React+Vite (frontend). O repositório é tcstulio/sistemav2.
        - Você NÃO deve criar issues, tasks ou bugs por conta própria — SEMPRE confirme com o usuário antes.
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
    editAddsLines?: boolean;  // default true p/ entidades com linesField; false = edição é header-only (não acrescenta linhas, ex.: pedido)
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
        createFields: ['name', 'name_alias', 'email', 'phone', 'phone_mobile', 'fax', 'url', 'idprof1', 'typent_id', 'address', 'town', 'zip', 'client', 'array_options'],
        editFields: ['name', 'name_alias', 'email', 'phone', 'phone_mobile', 'fax', 'url', 'idprof1', 'typent_id', 'address', 'town', 'zip', 'client', 'array_options'],
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
        createFields: ['name', 'name_alias', 'email', 'phone', 'phone_mobile', 'fax', 'url', 'idprof1', 'typent_id', 'address', 'town', 'zip', 'code_fournisseur', 'array_options'],
        editFields: ['name', 'name_alias', 'email', 'phone', 'phone_mobile', 'fax', 'url', 'idprof1', 'typent_id', 'address', 'town', 'zip', 'code_fournisseur', 'array_options'],
        required: ['name'],
        newRoute: '/suppliers/new',
        editRoute: '/suppliers/:id/edit',
    },
    task: {
        label: 'tarefa',
        createFields: ['label', 'description', 'project_id', 'planned_workload', 'date_start', 'date_end', 'fk_user_assign'],
        editFields: ['label', 'description', 'planned_workload', 'date_start', 'date_end'],
        required: ['label', 'project_id'],
        newRoute: '/tasks/new',
        editRoute: '/tasks/:id/edit',
    },
    delegation: {
        // Delegação = tarefa + responsável + critério de pronto, com pedido de aceite (Fase 1.5).
        // Reusa a tela de nova tarefa (/tasks/new); o frontend trata o kind 'create_delegation'.
        label: 'delegação',
        createFields: ['label', 'description', 'project_id', 'date_end', 'fk_user_assign', 'criterio'],
        required: ['label', 'project_id', 'fk_user_assign'],
        newRoute: '/tasks/new',
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
        createFields: ['socid', 'project_id', 'date', 'description'],
        // edição requer o endpoint custom PUT /interventions/{id} (api_interventions.class.php no Dolibarr).
        editFields: ['project_id', 'date', 'description'],
        required: ['socid'],
        newRoute: '/interventions/new',
        editRoute: '/interventions/:id/edit',
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
        // edição cobre só o cabeçalho (data); cliente e itens são imutáveis na tela de edição.
        editFields: ['date'],
        required: ['socid'],
        newRoute: '/orders/new',
        editRoute: '/orders/:id/edit',
        linesField: 'lines',
        lineFields: ['fk_product', 'desc', 'qty', 'subprice'],
        editAddsLines: false, // edição do pedido é header-only (não acrescenta itens)
    },
    mo: {
        label: 'ordem de produção',
        createFields: ['label', 'product_to_produce_id', 'qty', 'project_id', 'date_start'],
        // produto a produzir é imutável; edição cobre só os campos padrão seguros (rótulo/quantidade).
        editFields: ['label', 'qty'],
        required: ['product_to_produce_id'],
        newRoute: '/manufacturing/mo/new',
        editRoute: '/manufacturing/mo/:id/edit',
    },
    bom: {
        label: 'lista de materiais (BOM)',
        createFields: ['label', 'product_id', 'qty', 'duration'],
        // product_id (produto final) é imutável na edição.
        editFields: ['label', 'qty', 'duration'],
        required: ['product_id'],
        newRoute: '/manufacturing/bom/new',
        editRoute: '/manufacturing/bom/:id/edit',
    },
    product: {
        label: 'produto/serviço',
        createFields: ['ref', 'label', 'type', 'price', 'description'],
        editFields: ['ref', 'label', 'type', 'price', 'description'],
        required: ['ref', 'label'],
        newRoute: '/products/new',
        editRoute: '/products/:id/edit',
    },
    user: {
        label: 'usuário',
        createFields: ['login', 'firstname', 'lastname', 'email', 'job', 'supervisor_id'],
        // login é imutável após a criação.
        editFields: ['firstname', 'lastname', 'email', 'job', 'supervisor_id'],
        required: ['login', 'email'],
        newRoute: '/hr/users/new',
        editRoute: '/hr/users/:id/edit',
    },
    group: {
        label: 'grupo de usuários',
        createFields: ['name', 'note'],
        editFields: ['name', 'note'],
        required: ['name'],
        newRoute: '/hr/groups/new',
        editRoute: '/hr/groups/:id/edit',
    },
    contract: {
        label: 'contrato',
        createFields: ['socid', 'date_contrat', 'date_fin_validite', 'note_public'],
        editFields: ['date_contrat', 'date_fin_validite', 'note_public'],
        required: ['socid'],
        newRoute: '/contracts/new',
        editRoute: '/contracts/:id/edit',
    },
    expense: {
        label: 'relatório de despesa',
        createFields: ['fk_user_author', 'date_debut', 'date_fin', 'total_ttc', 'note_public'],
        // fk_user_author é imutável após a criação.
        editFields: ['date_debut', 'date_fin', 'total_ttc', 'note_public'],
        required: ['fk_user_author', 'date_debut', 'date_fin'],
        newRoute: '/hr/expenses/new',
        editRoute: '/hr/expenses/:id/edit',
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
        // entidades com itens acrescentam linhas na edição — exceto as header-only (editAddsLines === false).
        if (ent.editAddsLines !== false) {
            const lines = pickLines(args, ent); // linhas extras a ACRESCENTAR
            if (lines && lines.length > 0 && ent.linesField) changes[ent.linesField] = lines;
        }
        if (Object.keys(changes).length === 0) throw new Error('Nenhum campo para alterar foi informado.');
        const data = { id: String(args.id), ...changes };
        const token = signDeeplink(`edit_${edit[1]}`, data, 1800);
        const deeplink = `${ent.editRoute.replace(':id', String(args.id))}?prefill=${token}`;
        return `Preparei as mudanças no ${ent.label} #${args.id}. Clique para revisar e salvar na tela: ${deeplink}`;
    }

    return null;
}

// Trata prepare_batch_create(entity, items): gera UM deeplink de lote (kind batch_create)
// carregando um array de itens da MESMA entidade (cada item com campos + linhas opcionais).
// Retorna a msg com o link, null se não for a tool de lote, ou lança em erro de validação.
function tryPrepareBatch(tool: string, args: any): string | null {
    if (tool !== 'prepare_batch_create') return null;
    const entKey = String(args?.entity || '');
    const ent = DEEPLINK_ENTITIES[entKey];
    if (!ent?.newRoute) return `Entidade '${entKey}' não suporta criação via deeplink.`;

    const rawItems = Array.isArray(args?.items) ? args.items : [];
    if (rawItems.length === 0) throw new Error("Parâmetro 'items' (array) ausente ou vazio.");
    if (rawItems.length > 50) throw new Error('Lote muito grande (máximo de 50 itens por vez).');

    const items = rawItems.map((raw: any) => {
        const item: Record<string, any> = pickFields(raw, ent.createFields || []);
        const lines = pickLines(raw, ent);
        if (lines && lines.length > 0 && ent.linesField) item[ent.linesField] = lines;
        return item;
    });

    const token = signDeeplink('batch_create', { entity: entKey, items }, 1800);
    const deeplink = `/batch/new?prefill=${token}`;
    return `Preparei um lote de ${items.length} ${ent.label}(s). Clique para revisar e confirmar a criação de todos de uma vez: ${deeplink}`;
}

/** Executa uma ferramenta do agente e retorna o resultado já formatado como string. */
const TOOL_ALIASES: Record<string, string> = {
    create_issue: 'create_github_issue',
    list_issues: 'list_github_issues',
    search_customer: 'search_customer',
    get_customer: 'get_customer_details',
    list_customers: 'search_customer',
    create_ticket: 'create_github_issue',
    bug_report: 'create_bug_report',
    report_bug: 'create_bug_report',
    create_task: 'create_opencode_task',
    start_task: 'start_opencode_task',
    list_opencode_task: 'list_opencode_tasks',
    merge_task: 'merge_opencode_task',
    task_feedback: 'opencode_task_feedback',
    read_file: 'read_project_file',
    read_code: 'read_project_file',
    verify_code: 'read_project_file',
    grep: 'search_code',
    search_file: 'search_code',
    find_code: 'search_code',
    find_in_files: 'search_code',
    list_files: 'project_structure',
    tree: 'project_structure',
    ls: 'project_structure',
    logs: 'read_logs',
    show_logs: 'read_logs',
    recent_commits: 'git_recent',
    git_log: 'git_recent',
    send_notification: 'notify_team',
    alert_team: 'notify_team',
    send_message: 'notify_person',
    whatsapp: 'send_whatsapp',
    pergunta: 'ask_user',
    confirmar: 'ask_user',
};

const WRITE_TOOLS: Record<string, string> = {
    prepare_create: 'canCreate',
    prepare_edit: 'canEdit',
    validate_invoice: 'canValidate',
    validate_order: 'canValidate',
    validate_proposal: 'canValidate',
    notify_team: 'canSendEmail',
    notify_person: 'canSendEmail',
    send_whatsapp: 'canSendWhatsapp',
    get_financial_summary: 'canAccessFinancial',
    get_bank_balance: 'canAccessFinancial',
    get_accounts_receivable: 'canAccessFinancial',
    get_accounts_payable: 'canAccessFinancial',
    get_cash_flow_forecast: 'canAccessFinancial',
    create_github_issue: 'canCreateIssues',
    list_github_issues: 'canCreateIssues',
    create_bug_report: 'canCreateIssues',
    create_opencode_task: 'canStartTasks',
    start_opencode_task: 'canStartTasks',
    merge_opencode_task: 'canMergePRs',
};

function getWritePermissionKey(tool: string): string | null {
    if (WRITE_TOOLS[tool]) return WRITE_TOOLS[tool];
    for (const prefix of ['prepare_create_', 'prepare_edit_']) {
        if (tool.startsWith(prefix)) return WRITE_TOOLS[prefix.slice(0, -1)];
    }
    return null;
}

// Ferramentas que escrevem ou têm efeito externo — bloqueadas em contexto read-only.
const MUTATING_TOOLS = new Set([
    'validate_invoice', 'validate_order', 'validate_proposal',
    'notify_team', 'notify_person', 'send_whatsapp',
    'create_github_issue', 'create_bug_report',
    'create_opencode_task', 'start_opencode_task', 'merge_opencode_task',
]);

/** True se a ferramenta escreve/dispara efeito externo (deve ser bloqueada em read-only). */
function isMutatingTool(tool: string): boolean {
    return MUTATING_TOOLS.has(tool)
        || tool.startsWith('prepare_create')
        || tool.startsWith('prepare_edit')
        || tool.startsWith('prepare_batch');
}

const ENTITY_MAP: Record<string, string> = {
    ticket: 'ticket', customer: 'customer', supplier: 'supplier', project: 'project',
    task: 'task', delegation: 'task', category: 'category', event: 'event',
    intervention: 'intervention', job: 'job', leave: 'leave', contact: 'contact',
    candidate: 'candidate', invoice: 'invoice', proposal: 'proposal',
    supplier_invoice: 'invoice', supplier_proposal: 'proposal', order: 'order',
    mo: 'mo', bom: 'bom', product: 'product', user: 'user', group: 'user',
    contract: 'contract', expense: 'expense',
};

function getEntityFromTool(tool: string): string | null {
    const createMatch = tool.match(/^prepare_create_(.+)$/);
    const editMatch = tool.match(/^prepare_edit_(.+)$/);
    const key = createMatch?.[1] || editMatch?.[1];
    return key ? (ENTITY_MAP[key] || null) : null;
}

/** Soma o total de um array de linhas de documento: Σ qty × subprice × (1 − desconto%). */
function computeLinesTotal(lines: any): number {
    if (!Array.isArray(lines)) return 0;
    return lines.reduce((sum: number, l: any) => {
        const qty = Number(l?.qty) || 0;
        const subprice = Number(l?.subprice) || 0;
        const remise = Number(l?.remise_percent) || 0;
        return sum + qty * subprice * (1 - remise / 100);
    }, 0);
}

export async function executeTool(tool: string, args: any = {}): Promise<string> {
    const resolvedTool = TOOL_ALIASES[tool] || tool;
    log.info(`Tool Call: ${tool}${resolvedTool !== tool ? ` -> ${resolvedTool}` : ''}`, args);

    if (agentConfigService.isToolBlocked(resolvedTool)) {
        const msg = `Ferramenta "${resolvedTool}" está bloqueada pela configuração do agente. Peça ao administrador para liberar.`;
        log.warn(`Blocked tool: ${resolvedTool}`);
        return msg;
    }

    const ctx = getToolContext();
    // Contexto somente-leitura (ex.: bot WhatsApp com entrada externa): bloqueia escrita/efeito
    // externo antes de qualquer checagem de profile — vale inclusive sem profile e para admin.
    // web_search também: entrada não-confiável não deve disparar requisições à internet
    // (risco de exfiltração via prompt injection de contato externo).
    if (ctx.readOnly && (isMutatingTool(resolvedTool) || resolvedTool === 'web_search')) {
        log.warn(`Read-only context blocked mutating tool: ${resolvedTool}`);
        return `A ferramenta "${resolvedTool}" não está disponível neste contexto (somente leitura).`;
    }
    if (ctx.permissionProfile && !ctx.isAdmin) {
        const permKey = getWritePermissionKey(resolvedTool);
        if (permKey && !ctx.permissionProfile.agent[permKey as keyof typeof ctx.permissionProfile.agent]) {
            log.warn(`Permission denied: user=${ctx.userLogin} tool=${resolvedTool} required=${permKey}`);
            return `Você não tem permissão para usar a ferramenta "${resolvedTool}". Solicite ao administrador.`;
        }
        const entity = getEntityFromTool(resolvedTool);
        if (entity) {
            const isCreate = resolvedTool.startsWith('prepare_create_');
            const isEdit = resolvedTool.startsWith('prepare_edit_');
            if (isCreate && !ctx.permissionProfile.agent.canCreate.includes(entity) && !ctx.permissionProfile.agent.canCreate.includes('all')) {
                log.warn(`Permission denied: user=${ctx.userLogin} cannot create ${entity}`);
                return `Você não tem permissão para criar ${entity}. Solicite ao administrador.`;
            }
            if (isEdit && !ctx.permissionProfile.agent.canEdit.includes(entity) && !ctx.permissionProfile.agent.canEdit.includes('all')) {
                log.warn(`Permission denied: user=${ctx.userLogin} cannot edit ${entity}`);
                return `Você não tem permissão para editar ${entity}. Solicite ao administrador.`;
            }
        }

        // Caps configuráveis pelo admin (opt-in: default null/[] = sem efeito).
        const agent = ctx.permissionProfile.agent;

        // Allowlist de cliente: se configurada, só permite agir sobre esses socids.
        if (agent.restrictedCustomers?.length > 0 && args?.socid != null
            && !agent.restrictedCustomers.includes(String(args.socid))) {
            log.warn(`Permission denied: user=${ctx.userLogin} cliente ${args.socid} fora da allowlist`);
            return `Você não tem permissão para agir sobre o cliente ${args.socid}. Solicite ao administrador.`;
        }
        // Allowlist de projeto.
        const projectId = args?.project_id ?? args?.fk_project;
        if (agent.restrictedProjects?.length > 0 && projectId != null
            && !agent.restrictedProjects.includes(String(projectId))) {
            log.warn(`Permission denied: user=${ctx.userLogin} projeto ${projectId} fora da allowlist`);
            return `Você não tem permissão para agir sobre o projeto ${projectId}. Solicite ao administrador.`;
        }
        // Teto de valor em faturas/pedidos (create/edit). O valor vem de total_ttc ou da soma das linhas.
        const isInvoiceTool = /(?:create|edit)_(?:supplier_)?invoice$/.test(resolvedTool);
        const isOrderTool = /(?:create|edit)_order$/.test(resolvedTool);
        const amountLimit = isInvoiceTool ? agent.maxInvoiceAmount : isOrderTool ? agent.maxOrderAmount : null;
        if (amountLimit != null) {
            const total = args?.total_ttc != null ? Number(args.total_ttc) : computeLinesTotal(args?.lines);
            if (total > amountLimit) {
                log.warn(`Permission denied: user=${ctx.userLogin} valor ${total} > limite ${amountLimit} (${resolvedTool})`);
                return `Valor (R$ ${total.toFixed(2)}) excede o limite permitido (R$ ${amountLimit.toFixed(2)}). Solicite a um administrador.`;
            }
        }
    }

    // #954: executeToolInner LANÇA em params inválidos/HTTP 5xx. Não engolimos aqui (mantém o
    // contrato testado); quem trata é o loop do agente (catch por-chamada injeta o erro e CONTINUA
    // em vez de abortar o turno — ver LocalProvider.generateReply e GoogleProvider).
    const t0 = Date.now();
    const result = await executeToolInner(resolvedTool, args);
    const listener = ctx.listener || DEFAULT_TOOL_CONTEXT.listener;
    if (listener) {
        try { listener(tool, args, result, Date.now() - t0); } catch { /* ignore */ }
    }
    return result;
}

async function executeToolInner(tool: string, args: any): Promise<string> {
    switch (tool) {
        case 'search': {
            if (!args?.query) throw new Error("Parâmetro 'query' ausente.");
            const q = args.query;
            const [customers, projects, tasks, invoices, orders, proposals] = await Promise.all([
                dolibarrService.searchThirdParty(q).catch(() => []),
                dolibarrService.listProjects({ search: q }).catch(() => []),
                dolibarrService.listTasks().catch(() => []),
                dolibarrService.listInvoices({}).catch(() => []),
                dolibarrService.listOrders({ search: q }).catch(() => []),
                dolibarrService.listProposals({ search: q }).catch(() => []),
            ]);

            const customerIds = customers.map((c: any) => String(c.id));
            let relatedProjects: any[] = [];
            if (customerIds.length > 0) {
                const allCustProjs = await Promise.all(
                    customerIds.map(id => dolibarrService.listProjects({ socid: id }).catch(() => []))
                );
                relatedProjects = allCustProjs.flat();
            }

            const allProjects = [...projects, ...relatedProjects];
            const projIds = allProjects.map((p: any) => String(p.id));
            let relatedTasks: any[] = [];
            if (projIds.length > 0) {
                const allProjTasks = await Promise.all(
                    projIds.slice(0, 5).map(id => dolibarrService.listTasks(id).catch(() => []))
                );
                relatedTasks = allProjTasks.flat();
            }

            const parts: string[] = [];

            if (customers.length > 0) {
                parts.push('<h3>👥 Clientes</h3><ul>' +
                    customers.map((c: any) =>
                        `<li><a href="/customers/${c.id}" class="text-blue-600 underline font-semibold">${c.name}</a> — ${c.email || 'sem email'} (ID: ${c.id})</li>`
                    ).join('') + '</ul>');
            }

            if (allProjects.length > 0) {
                const statusLabel = (s: any) => s == 1 ? '🟢 Aberto' : s == 0 ? '⚪ Rascunho' : '🔴 Fechado';
                parts.push('<h3>📁 Projetos</h3><ul>' +
                    allProjects.map((p: any) =>
                        `<li><a href="/projects/${p.id}" class="text-blue-600 underline font-semibold">${p.ref} — ${p.title}</a> ${statusLabel(p.statut)}</li>`
                    ).join('') + '</ul>');
            }

            if (relatedTasks.length > 0) {
                parts.push('<h3>📋 Tarefas dos projetos</h3><ul>' +
                    relatedTasks.slice(0, 15).map((t: any) =>
                        `<li><a href="/tasks/${t.id}" class="text-blue-600 underline">${t.ref} — ${t.label}</a> — ${t.progress || 0}%</li>`
                    ).join('') + '</ul>');
            }

            if (invoices.length > 0) {
                const statusInv = (s: any) => s == 1 ? '✅' : s == 0 ? '📝' : '❌';
                parts.push('<h3>💰 Faturas</h3><ul>' +
                    invoices.slice(0, 5).map((i: any) =>
                        `<li><a href="/invoices/${i.id}" class="text-blue-600 underline">${i.ref}</a> — R$ ${parseFloat(i.total_ttc || 0).toFixed(2)} ${statusInv(i.statut)}</li>`
                    ).join('') + '</ul>');
            }

            if (orders.length > 0) {
                parts.push('<h3>📦 Pedidos</h3><ul>' +
                    orders.slice(0, 5).map((o: any) =>
                        `<li><a href="/orders/${o.id}" class="text-blue-600 underline font-semibold">${o.ref}</a> — R$ ${parseFloat(o.total_ttc || 0).toFixed(2)}</li>`
                    ).join('') + '</ul>');
            }

            if (proposals.length > 0) {
                parts.push('<h3>📄 Propostas</h3><ul>' +
                    proposals.slice(0, 5).map((p: any) =>
                        `<li><a href="/proposals/${p.id}" class="text-blue-600 underline font-semibold">${p.ref}</a> — R$ ${parseFloat(p.total_ttc || 0).toFixed(2)}</li>`
                    ).join('') + '</ul>');
            }

            if (parts.length === 0) return `Nenhum resultado encontrado para "${q}".`;
            return `Resultados para "<strong>${q}</strong>":<br/><br/>${parts.join('<br/>')}`;
        }
        case 'web_search': {
            if (!args?.query || String(args.query).trim() === '') {
                return 'Especifique o que pesquisar na web (query não pode ser vazio).';
            }
            try {
                const results = await zaiSearchService.search(String(args.query), 5);
                if (results.length === 0) return `Nenhum resultado na web para "${args.query}".`;
                return `<h3>🌐 Resultados da web para "${args.query}"</h3>\n` +
                    results.map((r, i) =>
                        `${i + 1}. **${r.title}**\n   ${r.content}\n   Fonte: ${r.link}`
                    ).join('\n\n');
            } catch (e: any) {
                log.error('web_search falhou', e?.message || e);
                return `A pesquisa na web falhou: ${e?.message || 'erro desconhecido'}. Responda com o que souber e avise o usuário.`;
            }
        }
        case 'search_customer': {
            if (!args?.query || String(args.query).trim() === '') {
                return 'Especifique um nome ou termo para buscar clientes (query não pode ser vazio).';
            }
            const customers = await dolibarrService.searchThirdParty(args.query);
            if (customers.length === 0) return `Nenhum cliente encontrado para "${args.query}".`;
            return '<h3>👥 Clientes encontrados</h3><ul>' +
                customers.map((c: any) =>
                    `<li><a href="/customers/${c.id}" class="text-blue-600 underline font-semibold">${c.name}</a> — ${c.email || 'sem email'} (ID: ${c.id})</li>`
                ).join('') + '</ul>';
        }
        case 'get_customer_details': {
            if (!args?.id) throw new Error("Parâmetro 'id' ausente.");
            const context = await dolibarrService.getCustomerContext(args.id);
            return `<a href="/customers/${args.id}" class="text-blue-600 underline font-semibold">Abrir ficha do cliente</a>\n\n${context}`;
        }
        case 'list_invoices': {
            const invs = await dolibarrService.listInvoices(args || {});
            if (invs.length === 0) return 'Nenhuma fatura encontrada.';
            const statusLabel = (s: any) => s == 1 ? '✅ Paga' : s == 0 ? '📝 Rascunho' : '❌ Não paga';
            return '<h3>🧾 Faturas</h3><ul>' +
                invs.map((i: any) =>
                    `<li><a href="/invoices/${i.id}" class="text-blue-600 underline font-semibold">${i.ref}</a> — R$ ${parseFloat(i.total_ttc || 0).toFixed(2)} ${statusLabel(i.statut)}</li>`
                ).join('') + '</ul>';
        }
        case 'list_projects': {
            const projs = await dolibarrService.listProjects(args);
            if (projs.length === 0) return 'Nenhum projeto encontrado.';
            const statusLabel = (s: any) => s == 1 ? '🟢 Aberto' : s == 0 ? '⚪ Rascunho' : '🔴 Fechado';
            return '<h3>📁 Projetos</h3><ul>' +
                projs.map((p: any) =>
                    `<li><a href="/projects/${p.id}" class="text-blue-600 underline font-semibold">${p.ref} — ${p.title}</a> ${statusLabel(p.statut)}</li>`
                ).join('') + '</ul>';
        }
        case 'list_orders': {
            const orders = await dolibarrService.listOrders(args);
            if (orders.length === 0) return 'Nenhum pedido encontrado.';
            return '<h3>📦 Pedidos de Venda</h3><ul>' +
                orders.map((o: any) =>
                    `<li><a href="/orders/${o.id}" class="text-blue-600 underline font-semibold">${o.ref}</a> — R$ ${parseFloat(o.total_ttc || 0).toFixed(2)}</li>`
                ).join('') + '</ul>';
        }
        case 'list_proposals': {
            const props = await dolibarrService.listProposals(args);
            if (props.length === 0) return 'Nenhuma proposta encontrada.';
            return '<h3>📄 Propostas</h3><ul>' +
                props.map((p: any) =>
                    `<li><a href="/proposals/${p.id}" class="text-blue-600 underline font-semibold">${p.ref}</a> — R$ ${parseFloat(p.total_ttc || 0).toFixed(2)}</li>`
                ).join('') + '</ul>';
        }
        case 'list_tickets': {
            const tickets = await dolibarrService.listTickets(args);
            if (tickets.length === 0) return 'Nenhum ticket encontrado.';
            return '<h3>🎫 Tickets</h3><ul>' +
                tickets.map((t: any) =>
                    `<li><a href="/tickets/${t.id}" class="text-blue-600 underline font-semibold">${t.subject}</a> — ${t.track_id || ''}</li>`
                ).join('') + '</ul>';
        }
        case 'list_products': {
            const prods = await dolibarrService.listProducts(args?.search);
            if (prods.length === 0) return 'Nenhum produto encontrado.';
            return '<h3>📦 Produtos</h3><ul>' +
                prods.map((p: any) =>
                    `<li><a href="/products/${p.id}" class="text-blue-600 underline font-semibold">${p.ref} — ${p.label}</a> — R$ ${parseFloat(p.price || 0).toFixed(2)}</li>`
                ).join('') + '</ul>';
        }
        case 'list_bank_accounts': {
            const banks = await dolibarrService.listBankAccounts();
            if (banks.length === 0) return 'Nenhuma conta bancária encontrada.';
            return '<h3>🏦 Contas Bancárias</h3><ul>' +
                banks.map((b: any) =>
                    `<li><a href="/bank_accounts" class="text-blue-600 underline font-semibold">${b.label || b.ref}</a> — Saldo: R$ ${parseFloat(b.solde || 0).toFixed(2)} ${b.currency_code || ''}</li>`
                ).join('') + '</ul>';
        }
        case 'list_contracts': {
            const contracts = await dolibarrService.listContracts(args?.search);
            if (contracts.length === 0) return 'Nenhum contrato encontrado.';
            return '<h3>📑 Contratos</h3><ul>' +
                contracts.map((c: any) =>
                    `<li><a href="/contracts" class="text-blue-600 underline font-semibold">${c.ref}</a></li>`
                ).join('') + '</ul>';
        }
        case 'list_shipments': {
            const ships = await dolibarrService.listShipments(args?.search);
            if (ships.length === 0) return 'Nenhum envio encontrado.';
            return '<h3>🚚 Envios</h3><ul>' +
                ships.map((s: any) =>
                    `<li><a href="/shipments" class="text-blue-600 underline font-semibold">${s.ref}</a></li>`
                ).join('') + '</ul>';
        }
        case 'list_supplier_invoices': {
            const supInvs = await dolibarrService.listSupplierInvoices(args?.status);
            if (supInvs.length === 0) return 'Nenhuma fatura de fornecedor encontrada.';
            return '<h3>🧾 Faturas de Fornecedor</h3><ul>' +
                supInvs.map((i: any) =>
                    `<li><a href="/supplier_invoices/${i.id}" class="text-blue-600 underline font-semibold">${i.ref}</a> — R$ ${parseFloat(i.total_ttc || 0).toFixed(2)}</li>`
                ).join('') + '</ul>';
        }
        case 'list_expense_reports': {
            const expenses = await dolibarrService.listExpenseReports(args?.status);
            if (expenses.length === 0) return 'Nenhum relatório de despesa encontrado.';
            return '<h3>💰 Despesas</h3><ul>' +
                expenses.map((e: any) =>
                    `<li><a href="/hr/expenses" class="text-blue-600 underline font-semibold">${e.ref}</a> — R$ ${parseFloat(e.total_ttc || 0).toFixed(2)}</li>`
                ).join('') + '</ul>';
        }
        case 'list_users': {
            const users = await dolibarrService.listUsers(args?.search);
            if (users.length === 0) return 'Nenhum usuário encontrado.';
            return '<h3>👥 Usuários</h3><ul>' +
                users.map((u: any) =>
                    `<li><a href="/hr/${u.id}" class="text-blue-600 underline font-semibold">${u.lastname} ${u.firstname}</a> — ${u.email || ''} ${u.job ? '(' + u.job + ')' : ''}</li>`
                ).join('') + '</ul>';
        }
        case 'list_warehouses': {
            const warehouses = await dolibarrService.listWarehouses();
            if (warehouses.length === 0) return 'Nenhum armazém encontrado.';
            return '<h3>🏭 Armazéns</h3><ul>' +
                warehouses.map((w: any) =>
                    `<li><a href="/warehouses" class="text-blue-600 underline font-semibold">${w.label}</a>${w.description ? ' — ' + w.description : ''}</li>`
                ).join('') + '</ul>';
        }
        case 'list_tasks': {
            const tasks = await dolibarrService.listTasks(args?.projectId);
            if (tasks.length === 0) return 'Nenhuma tarefa encontrada.';
            return '<h3>📋 Tarefas</h3><ul>' +
                tasks.map((t: any) =>
                    `<li><a href="/tasks/${t.id}" class="text-blue-600 underline font-semibold">${t.ref} — ${t.label}</a> — ${t.progress || 0}%</li>`
                ).join('') + '</ul>';
        }
        case 'list_user_tasks': {
            // Fallback p/ o usuário logado (ctx.userId) quando o LLM não informa o id (#300).
            const targetUserId = args?.userId || getToolContext().userId;
            if (!targetUserId) throw new Error("Parâmetro 'userId' ausente e o usuário atual não tem ID Dolibarr vinculado.");
            const userTasks = await dolibarrService.listUserTasks(targetUserId);
            if (userTasks.length === 0) return 'Nenhuma tarefa encontrada para este usuário.';
            return '<h3>📋 Tarefas do Usuário</h3><ul>' +
                userTasks.map((t: any) =>
                    `<li><a href="/tasks/${t.id}" class="text-blue-600 underline font-semibold">${t.ref} — ${t.label}</a> — ${t.progress || 0}%</li>`
                ).join('') + '</ul>';
        }
        case 'list_events': {
            const events = await dolibarrService.listEvents(args?.limit);
            if (events.length === 0) return 'Nenhum evento encontrado.';
            return '<h3>📅 Eventos</h3><ul>' +
                events.map((e: any) =>
                    `<li><a href="/agenda/${e.id}" class="text-blue-600 underline font-semibold">${e.label}</a> — ${e.datep || ''}</li>`
                ).join('') + '</ul>';
        }
        case 'list_contacts': {
            const contacts = await dolibarrService.listContacts(args?.search);
            if (contacts.length === 0) return 'Nenhum contato encontrado.';
            return '<h3>📇 Contatos</h3><ul>' +
                contacts.map((c: any) =>
                    `<li><a href="/contacts/${c.id}" class="text-blue-600 underline font-semibold">${c.lastname} ${c.firstname}</a> — ${c.email || ''} ${c.phone_mobile ? '| ' + c.phone_mobile : ''}</li>`
                ).join('') + '</ul>';
        }
        case 'list_categories': {
            const cats = await dolibarrService.listCategories(args?.type);
            if (cats.length === 0) return 'Nenhuma categoria encontrada.';
            return '<h3>🏷️ Categorias</h3><ul>' +
                cats.map((c: any) =>
                    `<li><a href="/categories" class="text-blue-600 underline font-semibold">${c.label}</a> (${c.type || ''})</li>`
                ).join('') + '</ul>';
        }
        case 'list_suppliers': {
            const suppliers = await dolibarrService.listSuppliers(args?.search);
            if (suppliers.length === 0) return 'Nenhum fornecedor encontrado.';
            return '<h3>🏭 Fornecedores</h3><ul>' +
                suppliers.map((s: any) =>
                    `<li><a href="/suppliers/${s.id}" class="text-blue-600 underline font-semibold">${s.name}</a> — ${s.email || 'sem email'}</li>`
                ).join('') + '</ul>';
        }
        case 'list_supplier_orders': {
            const supOrders = await dolibarrService.listSupplierOrders(args?.status);
            if (supOrders.length === 0) return 'Nenhum pedido de compra encontrado.';
            return '<h3>📦 Pedidos de Compra</h3><ul>' +
                supOrders.map((o: any) =>
                    `<li><a href="/supplier_orders" class="text-blue-600 underline font-semibold">${o.ref}</a> — R$ ${parseFloat(o.total_ttc || 0).toFixed(2)}</li>`
                ).join('') + '</ul>';
        }
        case 'list_payments': {
            const payments = await dolibarrService.listPayments(args?.limit);
            if (payments.length === 0) return 'Nenhum pagamento encontrado.';
            return '<h3>💳 Pagamentos</h3><ul>' +
                payments.map((p: any) =>
                    `<li><a href="/payments/${p.id}" class="text-blue-600 underline font-semibold">Pagamento #${p.id}</a> — R$ ${parseFloat(p.amount || 0).toFixed(2)}</li>`
                ).join('') + '</ul>';
        }
        case 'list_bank_lines': {
            const bankLines = await dolibarrService.listBankLines(args?.accountId, args?.limit);
            if (bankLines.length === 0) return 'Nenhuma movimentação encontrada.';
            return '<h3>🏦 Movimentações Bancárias</h3><ul>' +
                bankLines.map((l: any) =>
                    `<li>${l.label || ''} — R$ ${parseFloat(l.amount || 0).toFixed(2)} (${l.dateo || ''})</li>`
                ).join('') + '</ul>';
        }
        case 'list_stock_movements': {
            const stockMoves = await dolibarrService.listStockMovements(args?.productId);
            if (stockMoves.length === 0) return 'Nenhuma movimentação de estoque encontrada.';
            return '<h3>📦 Movimentações de Estoque</h3><ul>' +
                stockMoves.map((m: any) =>
                    `<li><a href="/products/${m.fk_product}" class="text-blue-600 underline font-semibold">Produto ${m.fk_product}</a> — Qty: ${m.qty} (${m.datem || ''})</li>`
                ).join('') + '</ul>';
        }
        case 'list_interventions': {
            const interventions = await dolibarrService.listInterventions(args?.search);
            if (interventions.length === 0) return 'Nenhuma intervenção encontrada.';
            return '<h3>🔧 Intervenções</h3><ul>' +
                interventions.map((i: any) =>
                    `<li><a href="/interventions" class="text-blue-600 underline font-semibold">${i.ref}</a>${i.description ? ' — ' + i.description : ''}</li>`
                ).join('') + '</ul>';
        }
        case 'list_leave_requests': {
            const leaves = await dolibarrService.listLeaveRequests(args?.status);
            if (leaves.length === 0) return 'Nenhuma solicitação de férias encontrada.';
            return '<h3>🏖️ Solicitações de Férias</h3><ul>' +
                leaves.map((l: any) =>
                    `<li><a href="/hr/leaves" class="text-blue-600 underline font-semibold">${l.ref}</a> — ${l.date_debut || ''}</li>`
                ).join('') + '</ul>';
        }
        case 'list_boms': {
            const boms = await dolibarrService.listBOMs(args?.search);
            if (boms.length === 0) return 'Nenhum BOM encontrado.';
            return '<h3>🔩 Listas Técnicas (BOM)</h3><ul>' +
                boms.map((b: any) =>
                    `<li><a href="/manufacturing" class="text-blue-600 underline font-semibold">${b.ref} — ${b.label}</a></li>`
                ).join('') + '</ul>';
        }
        case 'list_manufacturing_orders': {
            const mos = await dolibarrService.listManufacturingOrders(args?.status);
            if (mos.length === 0) return 'Nenhuma ordem de produção encontrada.';
            return '<h3>🏭 Ordens de Produção</h3><ul>' +
                mos.map((m: any) =>
                    `<li><a href="/manufacturing" class="text-blue-600 underline font-semibold">${m.ref}</a> — Qty: ${m.qty}</li>`
                ).join('') + '</ul>';
        }
        case 'list_candidates': {
            const candidates = await dolibarrService.listCandidates(args?.search);
            if (candidates.length === 0) return 'Nenhum candidato encontrado.';
            return '<h3>👤 Candidatos</h3><ul>' +
                candidates.map((c: any) =>
                    `<li><a href="/hr/candidates" class="text-blue-600 underline font-semibold">${c.lastname} ${c.firstname}</a> — ${c.email || ''}</li>`
                ).join('') + '</ul>';
        }
        case 'list_job_positions': {
            const jobs = await dolibarrService.listJobPositions(true);
            if (jobs.length === 0) return 'Nenhuma vaga aberta no momento.';
            return '<h3>💼 Vagas Abertas</h3><ul>' +
                jobs.map((j: any) =>
                    `<li><a href="/hr/jobs" class="text-blue-600 underline font-semibold">${j.ref} — ${j.label}</a> (Qty: ${j.qty || 1})</li>`
                ).join('') + '</ul>';
        }
        case 'search_web': {
            const searchResults = await ScraperService.searchGoogle(args?.query);
            if (!searchResults || searchResults.length === 0) return `Nenhum resultado encontrado para "${args?.query}".`;
            return '<h3>🔍 Resultados da Web</h3><ul>' +
                searchResults.map((r: any) =>
                    `<li><a href="${r.link || '#'}" class="text-blue-600 underline font-semibold">${r.title || 'Sem título'}</a> — ${r.snippet || ''}</li>`
                ).join('') + '</ul>';
        }
        case 'extract_from_url': {
            if (!isValidExternalUrl(args?.url)) {
                return 'Erro: URL inválida ou bloqueada (IPs privados/internos não são permitidos).';
            }
            const pageContent = await ScraperService.fetchPageContent(args.url);
            if (!pageContent) return 'Falha ao acessar página ou conteúdo vazio.';
            return `<h3>📄 Conteúdo extraído de <a href="${args.url}" class="text-blue-600 underline">${args.url}</a></h3><div>${pageContent.substring(0, 10000)}</div>`;
        }

        // --- MÍDIA (geração via MiniMax; devolvem URL ~24h) ---
        case 'generate_speech': {
            if (!args?.text) throw new Error("Parâmetro 'text' ausente.");
            const { url } = await minimaxService.generateSpeech(String(args.text), { voiceId: args.voice_id ? String(args.voice_id) : undefined });
            return `Áudio gerado (mp3, válido ~24h): ${url}`;
        }
        case 'generate_image': {
            if (!args?.prompt) throw new Error("Parâmetro 'prompt' ausente.");
            const { urls } = await minimaxService.generateImage(String(args.prompt), { aspectRatio: args.aspect_ratio ? String(args.aspect_ratio) : undefined });
            return `Imagem gerada (válida ~24h): ${urls.join(' , ')}`;
        }
        case 'generate_video': {
            if (!args?.prompt) throw new Error("Parâmetro 'prompt' ausente.");
            const { taskId } = await minimaxService.submitVideo(String(args.prompt), {
                duration: args.duration ? Number(args.duration) : undefined,
                resolution: args.resolution ? String(args.resolution) : undefined,
            });
            return `Geração de vídeo iniciada (leva alguns minutos). task_id: ${taskId}. Use check_video com esse task_id para pegar o link quando estiver pronto.`;
        }
        case 'check_video': {
            if (!args?.task_id) throw new Error("Parâmetro 'task_id' ausente.");
            const { status, url } = await minimaxService.getVideoStatus(String(args.task_id));
            if (url) return `Vídeo pronto (válido ~24h): ${url}`;
            if (status === 'Fail') return `A geração do vídeo (task_id ${args.task_id}) falhou.`;
            return `Vídeo ainda processando (status: ${status}). Tente novamente em instantes com o mesmo task_id.`;
        }

        case 'create_github_issue': {
            if (!args?.title) throw new Error("Parâmetro 'title' ausente.");
            const title = String(args.title);
            const body = String(args.body || '');
            let labels = args.labels;
            if (typeof labels === 'string') labels = [labels];

            try {
                const { stdout: searchOut } = await execFileAsync('gh', [
                    'issue', 'list',
                    '--repo', 'tcstulio/sistemav2',
                    '--state', 'open',
                    '--limit', '30',
                    '--json', 'number,title'
                ], { timeout: 15000 });
                const existing: Array<{ number: number; title: string }> = JSON.parse(searchOut);
                const normalized = title.toLowerCase().replace(/[^a-z0-9]/g, '');
                const dupe = existing.find(e => {
                    const eNorm = e.title.toLowerCase().replace(/[^a-z0-9]/g, '');
                    return eNorm === normalized || (eNorm.length > 20 && normalized.length > 20 && (eNorm.includes(normalized.substring(0, 20)) || normalized.includes(eNorm.substring(0, 20))));
                });
                if (dupe) {
                    return `Já existe um issue aberto com título similar: #${dupe.number} "${dupe.title}". NÃO criei duplicata. Use add_github_issue_comment ou reference este issue existente.`;
                }

                const labelArgs = labels && labels.length > 0 ? labels.flatMap((l: string) => ['--label', l]) : [];
                const allArgs = ['issue', 'create', '--repo', 'tcstulio/sistemav2', '--title', title, '--body', body, ...labelArgs];
                const { stdout } = await execFileAsync('gh', allArgs, { timeout: 15000 });
                const issueUrl = stdout.trim();
                return `Issue criado com sucesso: ${issueUrl}`;
            } catch (e: any) {
                log.error('create_github_issue failed', e);
                return `Erro ao criar issue: ${e.message}`;
            }
        }

        case 'list_github_issues': {
            const state = String(args?.state || 'open');
            const label = args?.label ? String(args.label) : undefined;
            const limit = String(args?.limit || 20);
            const listArgs = [
                'issue', 'list',
                '--repo', 'tcstulio/sistemav2',
                '--state', state,
                '--json', 'number,title,state,labels,createdAt,url',
                '--limit', limit
            ];
            if (label) {
                listArgs.push('--label', label);
            }
            try {
                const { stdout } = await execFileAsync('gh', listArgs, { timeout: 15000 });
                const issues = JSON.parse(stdout);
                if (issues.length === 0) return `Nenhum issue encontrado (state=${state}).`;
                return '<h3>📋 Issues do Projeto</h3><ul>' +
                    issues.map((i: any) => {
                        const labelStr = (i.labels || []).map((l: any) => l.name).join(', ');
                        return `<li><a href="${i.url}" class="text-blue-600 underline font-semibold">#${i.number}</a> ${i.title} ${labelStr ? `<span class="text-gray-500">[${labelStr}]</span>` : ''}</li>`;
                    }).join('') +
                    '</ul>';
            } catch (e: any) {
                log.error('list_github_issues failed', e);
                return `Erro ao listar issues: ${e.message}`;
            }
        }

        case 'create_bug_report': {
            const errTitle = args?.title || 'Bug reportado via assistente';
            const errorMsg = args?.error_message || 'Sem detalhes';
            const route = args?.route || 'Desconhecida';
            const component = args?.component || '';
            const body = `## Bug Reportado via Assistente Virtual\n\n**Rota:** \`${route}\`\n${component ? `**Componente:** \`${component}\`\n` : ''}**Erro:** ${errorMsg}\n\n_Criado automaticamente pelo assistente IA._`;
            try {
                const { stdout } = await execFileAsync('gh', [
                    'issue', 'create',
                    '--repo', 'tcstulio/sistemav2',
                    '--title', String(errTitle),
                    '--body', body,
                    '--label', 'bug'
                ], { timeout: 15000 });
                return `Bug report criado: ${stdout.trim()}`;
            } catch (e: any) {
                log.error('create_bug_report failed', e);
                return `Erro ao criar bug report: ${e.message}`;
            }
        }

        case 'get_screen_help': {
            const screenRoute = String(args?.route || '').trim();
            if (!screenRoute) return 'Informe a rota da tela (ex.: /customers, /invoices).';
            const normalized = screenRoute.replace(/\/+$/, '') || '/';
            const VIEW_HELP: Record<string, { label: string; description: string; actions: string[]; fields?: string[]; tips?: string[] }> = {
                '/': { label: 'Dashboard', description: 'Painel principal com indicadores do sistema.', actions: ['ver resumo financeiro', 'ver tickets recentes', 'navegar para telas'] },
                '/customers': { label: 'Clientes', description: 'Lista clientes e prospects. Permite buscar, criar, editar e ver detalhes.', actions: ['listar', 'buscar', 'criar', 'editar', 'ver detalhes'], fields: ['nome', 'email', 'telefone', 'endereço', 'cidade', 'tipo'], tips: ['Use search_customer para buscar. Use get_customer_details para ver faturas e projetos.'] },
                '/contacts': { label: 'Contatos', description: 'Lista pessoas de contato associadas a clientes.', actions: ['listar', 'criar', 'editar'], fields: ['nome', 'sobrenome', 'email', 'telefone', 'cargo'] },
                '/suppliers': { label: 'Fornecedores', description: 'Lista fornecedores cadastrados.', actions: ['listar', 'buscar', 'criar', 'editar'], fields: ['nome', 'email', 'telefone', 'endereço'] },
                '/invoices': { label: 'Faturas', description: 'Lista faturas de venda. Filtrar por status, criar e editar.', actions: ['listar', 'filtrar', 'criar', 'editar'], fields: ['cliente', 'data', 'status', 'itens', 'total'], tips: ['Use list_invoices com status "unpaid" para faturas em aberto.'] },
                '/supplier_invoices': { label: 'Faturas de Fornecedor', description: 'Lista faturas recebidas de fornecedores.', actions: ['listar', 'criar', 'editar'], fields: ['fornecedor', 'data', 'status', 'itens'] },
                '/proposals': { label: 'Propostas Comerciais', description: 'Lista propostas a clientes com status.', actions: ['listar', 'criar', 'editar'], fields: ['cliente', 'data', 'status', 'itens'] },
                '/supplier_proposals': { label: 'Solicitações de Preço', description: 'Lista solicitações de preço a fornecedores.', actions: ['listar', 'criar', 'editar'], fields: ['fornecedor', 'data', 'itens'] },
                '/orders': { label: 'Pedidos de Venda', description: 'Lista pedidos de venda com itens.', actions: ['listar', 'criar', 'editar'], fields: ['cliente', 'data', 'status', 'itens'] },
                '/projects': { label: 'Projetos', description: 'Lista projetos com tarefas e progresso.', actions: ['listar', 'criar', 'editar', 'ver tarefas'], fields: ['título', 'referência', 'cliente', 'status'] },
                '/tasks': { label: 'Tarefas', description: 'Detalhe de tarefa com prazo e responsável.', actions: ['ver detalhes', 'atualizar status', 'editar'], fields: ['título', 'projeto', 'responsável', 'prazo'] },
                '/tickets': { label: 'Tickets de Suporte', description: 'Lista tickets com severidade e tipo.', actions: ['listar', 'criar', 'editar'], fields: ['assunto', 'mensagem', 'tipo', 'severidade', 'cliente'] },
                '/products': { label: 'Produtos', description: 'Lista produtos com estoque e preço.', actions: ['listar', 'buscar', 'criar', 'editar'], fields: ['referência', 'nome', 'preço', 'descrição'] },
                '/services': { label: 'Serviços', description: 'Lista serviços cadastrados.', actions: ['listar', 'criar', 'editar'], fields: ['referência', 'nome', 'preço'] },
                '/categories': { label: 'Categorias', description: 'Categorias de produtos, clientes e fornecedores.', actions: ['listar', 'criar', 'editar'], fields: ['nome', 'tipo', 'descrição'] },
                '/inventory': { label: 'Estoque', description: 'Visão geral do estoque por armazém.', actions: ['ver estoque', 'filtrar', 'ver movimentações'], fields: ['produto', 'armazém', 'quantidade'] },
                '/manufacturing': { label: 'Manufatura', description: 'Ordens de produção e listas de materiais.', actions: ['listar ordens', 'criar ordem', 'listar BOMs'], fields: ['produto', 'quantidade', 'status'] },
                '/interventions': { label: 'Intervenções', description: 'Serviços de campo.', actions: ['listar', 'criar', 'editar'], fields: ['cliente', 'data', 'descrição'] },
                '/contracts': { label: 'Contratos', description: 'Contratos ativos com datas de vigência.', actions: ['listar', 'criar', 'editar'], fields: ['cliente', 'data início', 'data fim'] },
                '/hr': { label: 'Recursos Humanos', description: 'Hub de RH: funcionários, vagas, candidatos, licenças.', actions: ['listar funcionários', 'criar vaga', 'listar candidatos'], fields: ['módulos: usuários, vagas, candidatos, licenças'] },
                '/agenda': { label: 'Agenda', description: 'Calendário de eventos e compromissos.', actions: ['ver agenda', 'criar evento', 'editar'], fields: ['título', 'data', 'tipo'] },
                '/payments': { label: 'Pagamentos', description: 'Pagamentos recebidos de clientes.', actions: ['listar', 'ver detalhes'], fields: ['cliente', 'valor', 'data'] },
                '/bank_accounts': { label: 'Contas Bancárias', description: 'Contas bancárias com saldos.', actions: ['listar', 'ver saldo'], fields: ['banco', 'saldo'] },
                '/reports': { label: 'Relatórios', description: 'Hub de relatórios.', actions: ['ver relatórios', 'gerar mensal'] },
                '/simulator': { label: 'Simulador Financeiro', description: 'Simulação de cenários financeiros.', actions: ['criar simulação', 'ver resultados'], fields: ['drivers', 'receita', 'custos'] },
                '/settings': { label: 'Configurações', description: 'Configurações gerais do sistema.', actions: ['editar perfil', 'alterar config'] },
                '/chat': { label: 'Chat', description: 'Chat direto com contatos.', actions: ['ver conversas', 'enviar mensagem'] },
                '/whatsapp': { label: 'WhatsApp', description: 'Conversas WhatsApp integradas.', actions: ['ver conversas', 'enviar mensagem'] },
                '/email': { label: 'E-mail', description: 'Gerenciamento de emails.', actions: ['ver emails', 'enviar email'] },
            };
            const baseRoute = '/' + normalized.split('/').filter(Boolean)[0];
            const info = VIEW_HELP[normalized] || VIEW_HELP[baseRoute];
            if (!info) return `Tela "${screenRoute}" não encontrada. Telas disponíveis: ${Object.keys(VIEW_HELP).join(', ')}`;
            let help = `Tela: ${info.label}\nDescrição: ${info.description}\nAções: ${info.actions.join(', ')}`;
            if (info.fields) help += `\nCampos: ${info.fields.join(', ')}`;
            if (info.tips) help += `\nDicas: ${info.tips.join(' ')}`;
            return help;
        }

        case 'create_opencode_task': {
            const tTitle = String(args?.title || 'Task');
            const tBody = String(args?.body || '');
            let tLabels = args?.labels || ['enhancement'];
            if (typeof tLabels === 'string') tLabels = [tLabels];
            if (!tLabels.includes('opencode-task')) tLabels.push('opencode-task');
            const labelArgs = ([] as string[]).concat(...tLabels.map((l: string) => ['--label', l]));
            try {
                const { stdout: searchOut } = await execFileAsync('gh', [
                    'issue', 'list',
                    '--repo', 'tcstulio/sistemav2',
                    '--state', 'open',
                    '--limit', '30',
                    '--json', 'number,title'
                ], { timeout: 15000 });
                const existing: Array<{ number: number; title: string }> = JSON.parse(searchOut);
                const normalized = tTitle.toLowerCase().replace(/[^a-z0-9]/g, '');
                const dupe = existing.find(e => {
                    const eNorm = e.title.toLowerCase().replace(/[^a-z0-9]/g, '');
                    return eNorm === normalized || (eNorm.length > 20 && normalized.length > 20 && (eNorm.includes(normalized.substring(0, 20)) || normalized.includes(eNorm.substring(0, 20))));
                });
                if (dupe) {
                    return `Já existe um issue aberto com título similar: #${dupe.number} "${dupe.title}". NÃO criei duplicata. Use start_opencode_task para executar a task existente.`;
                }

                const { stdout } = await execFileAsync('gh', [
                    'issue', 'create', '--repo', 'tcstulio/sistemav2',
                    '--title', tTitle, '--body', tBody,
                    ...labelArgs
                ], { timeout: 15000 });
                return `Task criada: ${stdout.trim()}\nAcesse /tasks no sistema para iniciar a execução automática.`;
            } catch (e: any) {
                return `Erro ao criar task: ${e.message}`;
            }
        }

        case 'list_opencode_tasks': {
            try {
                const { taskRunnerService } = require('./taskRunnerService');
                const tasks = await taskRunnerService.syncTasks();
                const filterStatus = args?.status;
                const filtered = filterStatus ? tasks.filter((t: any) => t.status === filterStatus) : tasks;
                if (filtered.length === 0) return 'Nenhuma task encontrada.';
                return filtered.slice(0, 20).map((t: any) =>
                    `#${t.issueNumber} [${t.status}] ${t.title}${t.prNumber ? ` (PR #${t.prNumber})` : ''}${t.judgeScore !== undefined ? ` Judge: ${t.judgeScore}/10` : ''}`
                ).join('\n');
            } catch (e: any) {
                return `Erro ao listar tasks: ${e.message}`;
            }
        }

        case 'start_opencode_task': {
            const issueNum = Number(args?.issueNumber);
            if (!issueNum) return 'Informe o número da issue (issueNumber).';
            try {
                const { taskRunnerService } = require('./taskRunnerService');
                await taskRunnerService.syncTasks();
                const task = await taskRunnerService.startTask(issueNum);
                return `Task #${issueNum} iniciada! Branch: ${task.branch}. O opencode está implementando. Acompanhe em /tasks.`;
            } catch (e: any) {
                return `Erro ao iniciar task #${issueNum}: ${e.message}`;
            }
        }

        case 'opencode_task_feedback': {
            const fbIssue = Number(args?.issueNumber);
            const fbText = String(args?.feedback || '');
            if (!fbIssue || !fbText) return 'Informe issueNumber e feedback.';
            try {
                const { taskRunnerService } = require('./taskRunnerService');
                const task = await taskRunnerService.addFeedback(fbIssue, fbText);
                return `Feedback enviado para task #${fbIssue}. Status: ${task.status}. O opencode vai corrigir.`;
            } catch (e: any) {
                return `Erro ao enviar feedback: ${e.message}`;
            }
        }

        case 'merge_opencode_task': {
            const mergeIssue = Number(args?.issueNumber);
            if (!mergeIssue) return 'Informe o número da issue (issueNumber).';
            try {
                const { taskRunnerService } = require('./taskRunnerService');
                const task = await taskRunnerService.mergeTask(mergeIssue);
                return `Task #${mergeIssue} merged! PR #${task.prNumber} mergeado e issue fechada.`;
            } catch (e: any) {
                return `Erro ao fazer merge: ${e.message}`;
            }
        }

        case 'read_project_file': {
            const filePath = String(args?.file_path || '').trim();
            if (!filePath) return 'Informe o caminho do arquivo (ex.: src/components/InterventionList.tsx).';
            const normalizedPath = filePath.replace(/\\/g, '/').replace(/^\//, '');
            const fullPath = path.resolve(PROJECT_ROOT, normalizedPath);
            if (!fullPath.startsWith(PROJECT_ROOT)) return 'Caminho fora do projeto não permitido.';
            if (!fs.existsSync(fullPath)) return `Arquivo não encontrado: ${normalizedPath}. Verifique o caminho.`;
            try {
                const stat = fs.statSync(fullPath);
                if (stat.isDirectory()) {
                    const entries = fs.readdirSync(fullPath).slice(0, 50);
                    return `Diretório "${normalizedPath}" contém ${entries.length} itens:\n${entries.join('\n')}`;
                }
                const content = fs.readFileSync(fullPath, 'utf-8');
                const lines = content.split('\n');
                const offset = Math.max(0, Number(args?.offset || 0));
                const limit = Math.min(500, Number(args?.limit || 500));
                const selected = lines.slice(offset, offset + limit);
                const header = `Arquivo: ${normalizedPath} (${lines.length} linhas totais, mostrando ${offset + 1}-${Math.min(offset + limit, lines.length)})\n\n`;
                return header + selected.map((l, i) => `${offset + i + 1}: ${l}`).join('\n');
            } catch (e: any) {
                return `Erro ao ler arquivo: ${e.message}`;
            }
        }

        case 'ask_user': {
            const question = String(args?.question || '').trim();
            if (!question) return 'Especifique a pergunta no parâmetro "question".';
            throw new AskUserInterrupt(question);
        }

        case 'notify_team': {
            const msg = String(args?.message || '').trim();
            if (!msg) return 'Informe a mensagem (parâmetro "message").';
            try {
                const { notificationService } = require('./notificationService');
                await notificationService.notifyTeam({
                    event: 'agent.action',
                    title: 'Mensagem do Marciano',
                    message: msg,
                    priority: args?.priority || 'medium',
                    senderName: 'Marciano',
                });
                return `Notificação enviada pra equipe: "${msg.substring(0, 80)}"`;
            } catch (e: any) {
                return `Erro ao notificar equipe: ${e.message}`;
            }
        }

        case 'notify_person': {
            const pName = String(args?.name || '').trim();
            const pPhone = args?.phone ? String(args.phone).replace(/\D/g, '') : '';
            const pEmail = args?.email ? String(args.email).trim() : '';
            const pMsg = String(args?.message || '').trim();
            const pChannels = Array.isArray(args?.channels) ? args.channels : ['in-app'];

            if (!pName) return 'Informe o nome da pessoa (parâmetro "name").';
            if (!pMsg) return 'Informe a mensagem (parâmetro "message").';
            if (pChannels.includes('whatsapp') && !pPhone) return 'Para WhatsApp, informe o telefone (parâmetro "phone").';
            if (pChannels.includes('email') && !pEmail) return 'Para email, informe o email (parâmetro "email").';

            try {
                const { notificationService } = require('./notificationService');
                await notificationService.notifyPerson({
                    event: 'custom',
                    title: `Mensagem para ${pName}`,
                    message: pMsg,
                    channels: pChannels,
                    recipientName: pName,
                    recipientPhone: pPhone,
                    recipientEmail: pEmail,
                    senderName: 'Marciano',
                });
                const sent = pChannels.join(', ');
                return `Notificação enviada para ${pName} via ${sent}: "${pMsg.substring(0, 80)}"`;
            } catch (e: any) {
                return `Erro ao notificar ${pName}: ${e.message}`;
            }
        }

        case 'send_whatsapp': {
            const waPhone = String(args?.phone || '').replace(/\D/g, '');
            const waMsg = String(args?.message || '').trim();
            if (!waPhone) return 'Informe o telefone (parâmetro "phone", ex.: 5511999999999).';
            if (!waMsg) return 'Informe a mensagem (parâmetro "message").';
            try {
                const chatId = waPhone.includes('@c.us') ? waPhone : `${waPhone}@c.us`;
                const result = await channelRouter.sendWhatsApp(chatId, waMsg);
                if (result.success) {
                    return `WhatsApp enviado para ${waPhone}: "${waMsg.substring(0, 80)}"`;
                }
                return `Falha ao enviar WhatsApp: ${result.error}`;
            } catch (e: any) {
                return `Erro ao enviar WhatsApp: ${e.message}`;
            }
        }

        case 'validate_invoice': {
            const invId = String(args?.invoice_id || args?.id || '').trim();
            if (!invId) return 'Informe o ID da fatura (parâmetro "invoice_id"). Ache com list_invoices.';
            try {
                const result = await dolibarrService.validateInvoice(invId);
                return `Fatura #${invId} validada com sucesso. Status atualizado para validada.`;
            } catch (e: any) {
                return `Erro ao validar fatura #${invId}: ${e.message || e}`;
            }
        }

        case 'validate_order': {
            const ordId = String(args?.order_id || args?.id || '').trim();
            if (!ordId) return 'Informe o ID do pedido (parâmetro "order_id"). Ache com list_orders.';
            try {
                const result = await dolibarrService.validateOrder(ordId);
                return `Pedido #${ordId} validado com sucesso. Status atualizado para validado.`;
            } catch (e: any) {
                return `Erro ao validar pedido #${ordId}: ${e.message || e}`;
            }
        }

        case 'validate_proposal': {
            const propId = String(args?.proposal_id || args?.id || '').trim();
            if (!propId) return 'Informe o ID da proposta (parâmetro "proposal_id"). Ache com list_proposals.';
            try {
                const result = await dolibarrService.validateProposal(propId);
                return `Proposta #${propId} validada com sucesso. Status atualizado para validada.`;
            } catch (e: any) {
                return `Erro ao validar proposta #${propId}: ${e.message || e}`;
            }
        }

        case 'get_document_pdf': {
            const entityType = String(args?.entity_type || '').trim();
            const entityId = String(args?.entity_id || args?.id || '').trim();
            if (!entityType) return 'Informe o tipo de documento (parâmetro "entity_type"): invoice, order, proposal, supplier_order, supplier_invoice, intervention, contract, shipment.';
            if (!entityId) return 'Informe o ID do documento (parâmetro "entity_id").';
            const validTypes = ['invoice', 'order', 'proposal', 'supplier_order', 'supplier_invoice', 'intervention', 'contract', 'shipment'];
            if (!validTypes.includes(entityType)) return `Tipo inválido: ${entityType}. Tipos válidos: ${validTypes.join(', ')}.`;
            try {
                const pdf = await dolibarrService.getDocumentPDF(entityType, entityId);
                const base64 = pdf.toString('base64');
                const typeLabels: Record<string, string> = { invoice: 'Fatura', order: 'Pedido', proposal: 'Proposta', supplier_order: 'Pedido fornecedor', supplier_invoice: 'Fatura fornecedor', intervention: 'Intervenção', contract: 'Contrato', shipment: 'Expedição' };
                const label = typeLabels[entityType] || entityType;
                return `PDF da ${label} #${entityId} obtido com sucesso (${pdf.length} bytes). Base64: ${base64.substring(0, 100)}...[truncado, ${base64.length} chars total]. Para download: GET /api/documents/${entityType}/${entityId}/pdf`;
            } catch (e: any) {
                return `Erro ao obter PDF de ${entityType} #${entityId}: ${e.message || e}`;
            }
        }

        case 'get_financial_summary': {
            try {
                const s = await dolibarrService.getFinancialSummary();
                const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
                const lines = [
                    `<h3>📊 Resumo Financeiro — ${s.date}</h3>`,
                    `<b>🏦 Saldo bancário total:</b> ${fmt(s.totalBankBalance)}`,
                    ...s.bankBalances.map(b => `&nbsp;&nbsp;${b.label}: ${fmt(b.balance)} (${b.transactionCount} transações)`),
                    '',
                    `<b>📥 Contas a receber:</b> ${fmt(s.totalReceivable)}`,
                    s.totalReceivableOverdue > 0 ? `&nbsp;&nbsp;<span style="color:red">⚠️ Vencidas: ${fmt(s.totalReceivableOverdue)}</span>` : '&nbsp;&nbsp;✅ Nenhuma vencida',
                    '',
                    `<b>📤 Contas a pagar:</b> ${fmt(s.totalPayable)}`,
                    s.totalPayableOverdue > 0 ? `&nbsp;&nbsp;<span style="color:red">⚠️ Vencidas: ${fmt(s.totalPayableOverdue)}</span>` : '&nbsp;&nbsp;✅ Nenhuma vencida',
                    '',
                    `<b>📋 Propostas abertas:</b> ${s.openProposals} propostas totaling ${fmt(s.openProposalsValue)}`,
                    '',
                    `<b>📐 Posição líquida (saldo + a receber - a pagar):</b> ${fmt(s.netPosition)}`,
                ];
                return lines.join('\n');
            } catch (e: any) {
                return `Erro ao obter resumo financeiro: ${e.message || e}`;
            }
        }

        case 'get_bank_balance': {
            const acctId = String(args?.account_id || '').trim();
            try {
                if (acctId) {
                    const lines = await dolibarrService.getBankStatement(acctId);
                    const balance = lines.reduce((s: number, l: any) => s + (l.amount || 0), 0);
                    const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
                    return `Saldo da conta #${acctId}: ${fmt(balance)} (${lines.length} transações)`;
                }
                const balances = await dolibarrService.getBankBalances();
                const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
                const total = balances.reduce((s, b) => s + b.balance, 0);
                const lines = [
                    '<h3>🏦 Saldos Bancários</h3>',
                    ...balances.map(b => `${b.label} (#${b.accountId}): ${fmt(b.balance)} (${b.transactionCount} transações)`),
                    '',
                    `<b>Total: ${fmt(total)}</b>`,
                ];
                return lines.join('\n');
            } catch (e: any) {
                return `Erro ao obter saldo bancário: ${e.message || e}`;
            }
        }

        case 'get_accounts_receivable': {
            const dateFrom = args?.date_from ? String(args.date_from) : undefined;
            const dateTo = args?.date_to ? String(args.date_to) : undefined;
            try {
                const items = await dolibarrService.getAccountsReceivable(dateFrom, dateTo);
                if (items.length === 0) return 'Nenhuma conta a receber encontrada.';
                const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
                const total = items.reduce((s, i) => s + i.totalTtc, 0);
                const overdue = items.filter(i => i.isOverdue);
                const overdueTotal = overdue.reduce((s, i) => s + i.totalTtc, 0);
                const lines = [
                    `<h3>📥 Contas a Receber (${items.length} faturas, total: ${fmt(total)})</h3>`,
                    overdue.length > 0 ? `<span style="color:red">⚠️ ${overdue.length} vencidas totalizando ${fmt(overdueTotal)}</span>` : '',
                    '<ul>',
                    ...items.slice(0, 30).map(i => {
                        const dueStr = i.dueDate ? new Date(parseInt(i.dueDate) * 1000).toLocaleDateString('pt-BR') : 'sem data';
                        const overdueTag = i.isOverdue ? ' <span style="color:red">⚠️ VENCIDA</span>' : '';
                        return `<li><a href="/invoices/${i.id}">${i.ref}</a> — ${fmt(i.totalTtc)} — venc: ${dueStr}${overdueTag} — ${i.socName}</li>`;
                    }),
                    '</ul>',
                ];
                return lines.filter(Boolean).join('\n');
            } catch (e: any) {
                return `Erro ao obter contas a receber: ${e.message || e}`;
            }
        }

        case 'get_accounts_payable': {
            const dateFrom = args?.date_from ? String(args.date_from) : undefined;
            const dateTo = args?.date_to ? String(args.date_to) : undefined;
            try {
                const items = await dolibarrService.getAccountsPayable(dateFrom, dateTo);
                if (items.length === 0) return 'Nenhuma conta a pagar encontrada.';
                const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
                const total = items.reduce((s, i) => s + i.totalTtc, 0);
                const overdue = items.filter(i => i.isOverdue);
                const overdueTotal = overdue.reduce((s, i) => s + i.totalTtc, 0);
                const typeLabel = (t: string) => t === 'supplier_invoice' ? 'Fornecedor' : 'Despesa';
                const lines = [
                    `<h3>📤 Contas a Pagar (${items.length} itens, total: ${fmt(total)})</h3>`,
                    overdue.length > 0 ? `<span style="color:red">⚠️ ${overdue.length} vencidas totalizando ${fmt(overdueTotal)}</span>` : '',
                    '<ul>',
                    ...items.slice(0, 30).map(i => {
                        const dueStr = i.dueDate ? new Date(parseInt(i.dueDate) * 1000).toLocaleDateString('pt-BR') : 'sem data';
                        const overdueTag = i.isOverdue ? ' <span style="color:red">⚠️ VENCIDA</span>' : '';
                        const soc = i.socName ? ` — ${i.socName}` : '';
                        return `<li>[${typeLabel(i.type)}] ${i.ref} — ${fmt(i.totalTtc)} — venc: ${dueStr}${overdueTag}${soc}</li>`;
                    }),
                    '</ul>',
                ];
                return lines.filter(Boolean).join('\n');
            } catch (e: any) {
                return `Erro ao obter contas a pagar: ${e.message || e}`;
            }
        }

        case 'get_cash_flow_forecast': {
            const cfFrom = String(args?.date_from || '').trim();
            const cfTo = String(args?.date_to || '').trim();
            if (!cfFrom || !cfFrom.match(/^\d{4}-\d{2}-\d{2}$/)) return 'Informe date_from (YYYY-MM-DD). Ex.: "2026-06-07".';
            if (!cfTo || !cfTo.match(/^\d{4}-\d{2}-\d{2}$/)) return 'Informe date_to (YYYY-MM-DD). Ex.: "2026-07-07".';
            try {
                const periods = await dolibarrService.getCashFlowForecast(cfFrom, cfTo);
                if (periods.length === 0) return 'Nenhum dado de fluxo de caixa para o período.';
                const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
                const lines = [
                    `<h3>📈 Fluxo de Caixa Projetado (${cfFrom} a ${cfTo})</h3>`,
                    '<table><tr><th>Semana</th><th>A Receber</th><th>A Pagar</th><th>Líquido</th><th>Acumulado</th></tr>',
                    ...periods.map(p => {
                        const netColor = p.net >= 0 ? 'green' : 'red';
                        const cumColor = p.cumulativeNet >= 0 ? 'green' : 'red';
                        return `<tr><td>${p.period}</td><td>${fmt(p.receivable)}</td><td>${fmt(p.payable)}</td><td style="color:${netColor}">${fmt(p.net)}</td><td style="color:${cumColor}"><b>${fmt(p.cumulativeNet)}</b></td></tr>`;
                    }),
                    '</table>',
                ];
                return lines.join('\n');
            } catch (e: any) {
                return `Erro ao obter fluxo de caixa: ${e.message || e}`;
            }
        }

        case 'get_company_info': {
            try {
                const info = await dolibarrService.getCompanyInfo();
                if (!info) return 'Não foi possível obter dados da empresa.';
                const lines = [
                    '<h3>🏢 Dados da Empresa</h3>',
                    `<b>Nome:</b> ${info.name}`,
                    `<b>CNPJ:</b> ${info.idprof4 || 'não informado'}`,
                    `<b>Endereço:</b> ${info.address}, ${info.zip} — ${info.town} (${info.country_code})`,
                    `<b>Telefone:</b> ${info.phone}`,
                    `<b>Email:</b> ${info.email}`,
                    `<b>Site:</b> ${info.url}`,
                    `<b>Gestores:</b> ${info.managers}`,
                    `<b>Idioma:</b> ${info.default_lang}`,
                    `<b>Capital:</b> ${info.capital ? info.capital.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : 'não informado'}`,
                    `<b>Contribuinte ICMS:</b> ${info.tva_assuj ? 'Sim' : 'Não'}`,
                ];
                return lines.join('\n');
            } catch (e: any) {
                return `Erro ao obter dados da empresa: ${e.message || e}`;
            }
        }

        case 'list_payment_types': {
            try {
                const types = await dolibarrService.listPaymentTypes();
                if (types.length === 0) return 'Nenhum método de pagamento encontrado.';
                const lines = [
                    `<h3>💳 Métodos de Pagamento (${types.length})</h3>`,
                    '<ul>',
                    ...types.map((t: any) => `<li><b>${t.code || t.id}</b> — ${t.label || t.libelle || 'sem nome'} ${t.active === 1 || t.active === '1' ? '' : '(inativo)'}</li>`),
                    '</ul>',
                ];
                return lines.join('\n');
            } catch (e: any) {
                return `Erro ao listar métodos de pagamento: ${e.message || e}`;
            }
        }

        case 'list_tax_rates': {
            try {
                const rates = await dolibarrService.listVatRates();
                if (rates.length === 0) return 'Nenhuma taxa de imposto encontrada.';
                const lines = [
                    `<h3>📊 Taxas de Imposto (${rates.length})</h3>`,
                    '<ul>',
                    ...rates.map((r: any) => `<li><b>${r.tva_tx || r.rate || r.id}%</b> — ${r.label || r.libelle || 'sem nome'} ${r.active === 1 || r.active === '1' ? '' : '(inativo)'}</li>`),
                    '</ul>',
                ];
                return lines.join('\n');
            } catch (e: any) {
                return `Erro ao listar taxas de imposto: ${e.message || e}`;
            }
        }

        case 'list_currencies': {
            try {
                const currencies = await dolibarrService.listCurrencies();
                if (currencies.length === 0) return 'Nenhuma moeda encontrada.';
                const lines = [
                    `<h3>💰 Moedas (${currencies.length})</h3>`,
                    '<ul>',
                    ...currencies.map((c: any) => `<li><b>${c.code_iso || c.code}</b> — ${c.label || c.libelle || 'sem nome'} ${c.rate ? `(taxa: ${c.rate})` : ''}</li>`),
                    '</ul>',
                ];
                return lines.join('\n');
            } catch (e: any) {
                return `Erro ao listar moedas: ${e.message || e}`;
            }
        }

        case 'list_countries': {
            try {
                const countries = await dolibarrService.listCountries();
                if (countries.length === 0) return 'Nenhum país encontrado.';
                const lines = [
                    `<h3>🌍 Países (${countries.length})</h3>`,
                    '<ul>',
                    ...countries.map((c: any) => `<li><b>${c.code || c.code_iso}</b> — ${c.label || c.libelle || c.nom || 'sem nome'}</li>`),
                    '</ul>',
                ];
                return lines.join('\n');
            } catch (e: any) {
                return `Erro ao listar países: ${e.message || e}`;
            }
        }

        case 'search_code': {
            const pattern = String(args?.pattern || '').trim();
            if (!pattern) return 'Informe o texto ou regex a buscar (ex.: "ConfirmDelete", "function handleSubmit").';
            const searchDir = String(args?.path || '').trim();
            const baseDir = searchDir ? path.resolve(PROJECT_ROOT, searchDir) : PROJECT_ROOT;
            if (!baseDir.startsWith(PROJECT_ROOT)) return 'Caminho fora do projeto não permitido.';
            if (!fs.existsSync(baseDir)) return `Diretório não encontrado: ${searchDir || '.'}`;
            try {
                const IGNORE_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'coverage', '__pycache__']);
                const MAX_RESULTS = 30;
                const results: string[] = [];
                const regex = new RegExp(pattern, 'i');
                function walk(dir: string, depth: number) {
                    if (depth > 6 || results.length >= MAX_RESULTS) return;
                    const entries = fs.readdirSync(dir, { withFileTypes: true });
                    for (const entry of entries) {
                        if (results.length >= MAX_RESULTS) return;
                        if (entry.isDirectory()) {
                            if (IGNORE_DIRS.has(entry.name)) continue;
                            walk(path.join(dir, entry.name), depth + 1);
                        } else {
                            const ext = path.extname(entry.name).toLowerCase();
                            if (!['.ts', '.tsx', '.js', '.jsx', '.vue', '.json', '.css', '.scss', '.html', '.md', '.py'].includes(ext)) continue;
                            try {
                                const fp = path.join(dir, entry.name);
                                const content = fs.readFileSync(fp, 'utf-8');
                                const lines = content.split('\n');
                                for (let i = 0; i < lines.length && results.length < MAX_RESULTS; i++) {
                                    if (regex.test(lines[i])) {
                                        const relPath = path.relative(PROJECT_ROOT, fp).replace(/\\/g, '/');
                                        results.push(`${relPath}:${i + 1}: ${lines[i].trim().substring(0, 150)}`);
                                    }
                                }
                            } catch { /* skip unreadable */ }
                        }
                    }
                }
                walk(baseDir, 0);
                if (results.length === 0) return `Nenhum resultado para "${pattern}"${searchDir ? ` em ${searchDir}` : ''}.`;
                return `Encontrado ${results.length} ocorrência(s) para "${pattern}":\n\n${results.join('\n')}`;
            } catch (e: any) {
                return `Erro na busca: ${e.message}`;
            }
        }

        case 'project_structure': {
            const structDir = String(args?.path || '').trim();
            const baseDir = structDir ? path.resolve(PROJECT_ROOT, structDir) : PROJECT_ROOT;
            if (!baseDir.startsWith(PROJECT_ROOT)) return 'Caminho fora do projeto não permitido.';
            if (!fs.existsSync(baseDir) || !fs.statSync(baseDir).isDirectory()) return `Diretório não encontrado: ${structDir || '.'}`;
            try {
                const IGNORE_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'coverage', '__pycache__']);
                const MAX_ENTRIES = 100;
                const lines: string[] = [];
                function walk(dir: string, prefix: string, depth: number) {
                    if (depth > 4 || lines.length >= MAX_ENTRIES) return;
                    const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => {
                        if (a.isDirectory() && !b.isDirectory()) return -1;
                        if (!a.isDirectory() && b.isDirectory()) return 1;
                        return a.name.localeCompare(b.name);
                    });
                    for (const entry of entries) {
                        if (lines.length >= MAX_ENTRIES) { lines.push(`${prefix}... (truncado)`); return; }
                        if (entry.name.startsWith('.') && entry.name !== '.env.example') continue;
                        if (entry.isDirectory() && IGNORE_DIRS.has(entry.name)) continue;
                        const relPath = path.relative(PROJECT_ROOT, path.join(dir, entry.name)).replace(/\\/g, '/');
                        if (entry.isDirectory()) {
                            lines.push(`${prefix}${entry.name}/`);
                            walk(path.join(dir, entry.name), prefix + '  ', depth + 1);
                        } else {
                            lines.push(`${prefix}${entry.name}`);
                        }
                    }
                }
                walk(baseDir, '', 0);
                const header = structDir ? `Estrutura de ${structDir}:` : 'Estrutura do projeto:';
                return `${header}\n${lines.join('\n')}`;
            } catch (e: any) {
                return `Erro ao listar estrutura: ${e.message}`;
            }
        }

        case 'read_logs': {
            const logLines = Math.min(200, Math.max(10, Number(args?.lines || 50)));
            const level = String(args?.level || '').toLowerCase();
            let recent = getRecentLogs(logLines * 3);
            if (level && ['error', 'warn', 'info', 'debug'].includes(level)) {
                recent = recent.filter(l => l.includes(`[${level.toUpperCase()}]`));
            }
            recent = recent.slice(-logLines);
            if (recent.length === 0) return 'Nenhum log encontrado ainda (o servidor acabou de iniciar ou não há entradas).';
            // #951: corta linhas gigantes (ex.: um base64 que tenha vazado p/ o log) para não
            // explodir o contexto do agente ao ler os logs.
            const capped = recent.map(l => l.length > 2000 ? `${l.slice(0, 2000)}…[+${l.length - 2000} chars]` : l);
            return `Últimas ${capped.length} linhas do log${level ? ` (filtrado por ${level})` : ''}:\n\n${capped.join('\n')}`;
        }

        case 'git_recent': {
            const gitLimit = Math.min(30, Math.max(1, Number(args?.limit || 10)));
            try {
                const { stdout } = await execFileAsync('git', [
                    'log', `--max-count=${gitLimit}`, '--pretty=format:%h %s (%cr)', '--no-merges'
                ], { timeout: 10000, cwd: PROJECT_ROOT });
                if (!stdout.trim()) return 'Nenhum commit encontrado.';
                return `Últimos ${gitLimit} commits:\n\n${stdout.trim()}`;
            } catch (e: any) {
                return `Erro ao ler git log: ${e.message}`;
            }
        }

        // AÇÕES HITL (prepare_create_*/prepare_edit_*/prepare_batch_create) caem no dispatch genérico.
        default: {
            const batchMsg = tryPrepareBatch(tool, args);
            if (batchMsg !== null) return batchMsg;
            const deeplinkMsg = tryPrepareDeeplink(tool, args);
            if (deeplinkMsg !== null) return deeplinkMsg;
            return `Ferramenta desconhecida: ${tool}`;
        }
    }
}
