export interface ViewInfo {
    label: string;
    description: string;
    actions: string[];
    fields?: string[];
    tips?: string[];
}

type ViewRegistry = Record<string, ViewInfo>;

function r(label: string, description: string, actions: string[], fields?: string[], tips?: string[]): ViewInfo {
    return { label, description, actions, fields, tips };
}

export const VIEW_REGISTRY: ViewRegistry = {
    '/': r(
        'Dashboard',
        'Painel principal com indicadores do sistema: faturas em aberto, receita do mês, tickets pendentes, evolução do projeto e widgets personalizados.',
        ['ver resumo financeiro', 'ver tickets recentes', 'ver evolução do projeto', 'navegar para telas específicas'],
        ['total faturas abertas', 'receita mensal', 'tickets pendentes', 'gráficos de evolução'],
    ),
    '/my-tasks': r(
        'Minhas Tarefas',
        'Mostra todas as tarefas atribuídas ao usuário logado, organizadas por projeto com status e prioridade.',
        ['ver minhas tarefas', 'filtrar por projeto', 'atualizar status de tarefa'],
        ['tarefa', 'projeto', 'status', 'prioridade', 'prazo'],
    ),
    '/customers': r(
        'Clientes',
        'Lista todos os clientes e prospects cadastrados. Permite buscar, criar, editar e ver detalhes com faturas, projetos e agenda.',
        ['listar clientes', 'buscar cliente', 'criar cliente', 'editar cliente', 'ver detalhes do cliente'],
        ['nome', 'email', 'telefone', 'endereço', 'cidade', 'CEP', 'tipo (cliente/prospect)'],
        ['Use search_customer para buscar por nome. Use get_customer_details para ver faturas e projetos de um cliente.'],
    ),
    '/contacts': r(
        'Contatos',
        'Lista pessoas de contato associadas a clientes. Cada contato tem nome, telefone, email e cargo.',
        ['listar contatos', 'buscar contato', 'criar contato', 'editar contato'],
        ['nome', 'sobrenome', 'email', 'telefone', 'cargo', 'cliente associado'],
    ),
    '/suppliers': r(
        'Fornecedores',
        'Lista todos os fornecedores cadastrados. Permite buscar, criar, editar e ver detalhes.',
        ['listar fornecedores', 'buscar fornecedor', 'criar fornecedor', 'editar fornecedor'],
        ['nome', 'email', 'telefone', 'endereço', 'cidade', 'CEP'],
    ),
    '/venues': r(
        'Parcerias / Locais',
        'Gerencia locais e parcerias comerciais. Mostra dados do parceiro e status da parceria.',
        ['listar parcerias', 'ver detalhes do local', 'editar parceria'],
        ['nome do local', 'endereço', 'contato', 'status'],
    ),
    '/invoices': r(
        'Faturas',
        'Lista faturas de venda. Permite filtrar por status (rascunho, em aberto, paga), criar novas faturas com itens e editar existentes.',
        ['listar faturas', 'filtrar por status', 'criar fatura', 'editar fatura', 'ver detalhes'],
        ['cliente', 'data', 'status', 'itens (produto, qtd, preço)', 'desconto', 'total'],
        ['Use list_invoices com status "unpaid" para faturas em aberto. Para criar, primeiro ache o ID do cliente com search_customer.'],
    ),
    '/supplier_invoices': r(
        'Faturas de Fornecedor',
        'Lista faturas recebidas de fornecedores. Permite filtrar por status, criar e editar.',
        ['listar faturas de fornecedor', 'criar fatura de fornecedor', 'editar'],
        ['fornecedor', 'data', 'status', 'itens', 'total'],
    ),
    '/pending_payments': r(
        'Pagamentos Pendentes',
        'Mostra todas as faturas com pagamento pendente, organizadas por vencimento.',
        ['ver pagamentos pendentes', 'filtrar por vencimento', 'registrar pagamento'],
        ['cliente', 'fatura', 'valor', 'vencimento', 'dias em atraso'],
    ),
    '/proposals': r(
        'Propostas Comerciais',
        'Lista propostas comerciais enviadas a clientes. Permite criar propostas com itens, editar e acompanhar status (rascunho, aberta, assinada).',
        ['listar propostas', 'criar proposta', 'editar proposta', 'ver detalhes'],
        ['cliente', 'data', 'status', 'itens', 'projeto', 'observações'],
        ['Para criar proposta, ache o ID do cliente primeiro. Propostas podem ter itens de produto/serviço.'],
    ),
    '/supplier_proposals': r(
        'Solicitações de Preço',
        'Lista solicitações de preço a fornecedores. Permite criar, editar e comparar propostas.',
        ['listar solicitações', 'criar solicitação de preço', 'editar', 'comparar'],
        ['fornecedor', 'data', 'itens', 'status'],
    ),
    '/smart_quotation': r(
        'Cotação Inteligente',
        'Wizard de cotação automática que busca melhores preços entre fornecedores para uma lista de itens.',
        ['iniciar cotação', 'adicionar itens', 'comparar preços', 'selecionar fornecedor'],
        ['itens', 'quantidade', 'fornecedores', 'preços'],
    ),
    '/orders': r(
        'Pedidos de Venda',
        'Lista pedidos de venda. Permite criar pedidos com itens, editar e acompanhar status.',
        ['listar pedidos', 'criar pedido', 'editar pedido', 'ver detalhes'],
        ['cliente', 'data', 'status', 'itens (produto, qtd, preço)', 'total'],
    ),
    '/shipments': r(
        'Expedições',
        'Lista envios e expedições de pedidos. Mostra status de entrega.',
        ['listar expedições', 'ver detalhes da expedição'],
        ['pedido', 'destinatário', 'status', 'data de envio'],
    ),
    '/projects': r(
        'Projetos',
        'Lista projetos com tarefas, progresso e equipe. Permite criar, editar e acompanhar o andamento.',
        ['listar projetos', 'criar projeto', 'editar projeto', 'ver tarefas do projeto'],
        ['título', 'referência', 'cliente', 'status', 'progresso'],
        ['Use list_projects para buscar. Use list_tasks com projectId para ver tarefas de um projeto.'],
    ),
    '/tasks': r(
        'Tarefas',
        'Detalhe de uma tarefa específica com descrição, prazo, responsável e tempo gasto.',
        ['ver detalhes da tarefa', 'atualizar status', 'registrar tempo', 'editar tarefa'],
        ['título', 'descrição', 'projeto', 'responsável', 'prazo', 'carga horária', 'progresso'],
    ),
    '/tickets': r(
        'Tickets de Suporte',
        'Lista tickets de suporte. Permite criar, editar e acompanhar tickets com severidade e tipo.',
        ['listar tickets', 'criar ticket', 'editar ticket', 'ver detalhes', 'filtrar por severidade'],
        ['assunto', 'mensagem', 'tipo', 'severidade (LOW, NORMAL, HIGH, BLOCKING)', 'cliente'],
        ['Para criar ticket associado a um cliente, ache o ID com search_customer e passe em socid.'],
    ),
    '/bank_accounts': r(
        'Contas Bancárias',
        'Lista contas bancárias com saldos e permite ver movimentações.',
        ['listar contas', 'ver saldo', 'ver movimentações'],
        ['banco', 'agência', 'conta', 'saldo'],
    ),
    '/products': r(
        'Produtos',
        'Lista produtos cadastrados. Permite criar, editar e ver detalhes com estoque e preço.',
        ['listar produtos', 'buscar produto', 'criar produto', 'editar produto'],
        ['referência', 'nome', 'tipo (produto/serviço)', 'preço', 'descrição', 'estoque'],
    ),
    '/services': r(
        'Serviços',
        'Lista serviços cadastrados. Mesma interface de produtos mas filtrada para tipo serviço.',
        ['listar serviços', 'buscar serviço', 'criar serviço', 'editar serviço'],
        ['referência', 'nome', 'preço', 'descrição'],
    ),
    '/categories': r(
        'Categorias',
        'Lista categorias de produtos, clientes e fornecedores. Permite criar e editar.',
        ['listar categorias', 'criar categoria', 'editar categoria'],
        ['nome', 'tipo (product/customer/supplier)', 'descrição'],
    ),
    '/inventory': r(
        'Estoque',
        'Visão geral do estoque com quantidades por armazém e alertas de reposição.',
        ['ver estoque', 'filtrar por produto', 'ver movimentações'],
        ['produto', 'armazém', 'quantidade', 'mínimo'],
    ),
    '/warehouses': r(
        'Armazéns',
        'Lista armazéns cadastrados e suas capacidades.',
        ['listar armazéns', 'ver capacidade'],
        ['nome', 'localização', 'capacidade'],
    ),
    '/manufacturing': r(
        'Manufatura / Produção',
        'Gerencia ordens de produção (MO) e listas de materiais (BOM). Permite criar, editar e acompanhar.',
        ['listar ordens de produção', 'criar ordem', 'listar BOMs', 'criar BOM'],
        ['produto', 'quantidade', 'status (draft/validated/inprogress)', 'lista de materiais'],
    ),
    '/interventions': r(
        'Intervenções',
        'Lista intervenções e serviços de campo. Permite criar e editar.',
        ['listar intervenções', 'criar intervenção', 'editar'],
        ['cliente', 'data', 'descrição', 'projeto'],
    ),
    '/contracts': r(
        'Contratos',
        'Lista contratos ativos e recentes. Permite criar e editar com datas de vigência.',
        ['listar contratos', 'criar contrato', 'editar contrato'],
        ['cliente', 'data início', 'data fim', 'observações'],
    ),
    '/hr': r(
        'Recursos Humanos',
        'Hub de RH com acesso a funcionários, vagas, candidatos, licenças, despesas e grupos.',
        ['listar funcionários', 'criar vaga', 'listar candidatos', 'gerenciar licenças', 'ver despesas'],
        ['módulos: usuários, vagas, candidatos, licenças, despesas, grupos'],
    ),
    '/agenda': r(
        'Agenda',
        'Calendário de eventos com reuniões, ligações e compromissos. Permite criar e editar.',
        ['ver agenda', 'criar evento', 'editar evento', 'filtrar por tipo'],
        ['título', 'data início', 'data fim', 'tipo (reunião/ligação/email/outro)', 'descrição'],
    ),
    '/payments': r(
        'Pagamentos Recebidos',
        'Lista pagamentos recebidos de clientes.',
        ['listar pagamentos', 'ver detalhes do pagamento'],
        ['cliente', 'fatura', 'valor', 'data', 'forma de pagamento'],
    ),
    '/supplier_payments': r(
        'Pagamentos a Fornecedores',
        'Lista pagamentos realizados a fornecedores.',
        ['listar pagamentos', 'ver detalhes'],
        ['fornecedor', 'fatura', 'valor', 'data'],
    ),
    '/tax_payments': r(
        'Pagamentos de Impostos',
        'Lista pagamentos de impostos realizados.',
        ['listar pagamentos de impostos', 'ver detalhes'],
        ['tipo de imposto', 'valor', 'data', 'período'],
    ),
    '/salary_payments': r(
        'Pagamentos de Salários',
        'Lista pagamentos de salários realizados.',
        ['listar pagamentos de salários', 'ver detalhes'],
        ['funcionário', 'valor', 'data', 'mês de referência'],
    ),
    '/expense_report_payments': r(
        'Pagamentos de Despesas',
        'Lista reembolsos de despesas de funcionários.',
        ['listar reembolsos', 'ver detalhes'],
        ['funcionário', 'valor', 'data', 'período'],
    ),
    '/reports': r(
        'Relatórios',
        'Hub de relatórios com acesso a relatórios mensais e análise de dados.',
        ['ver relatórios', 'gerar relatório mensal', 'analisar dados'],
        ['período', 'tipo de relatório'],
    ),
    '/monthly-report': r(
        'Relatório Mensal',
        'Relatório detalhado do mês com receitas, despesas, projeções e indicadores.',
        ['ver relatório mensal', 'selecionar mês', 'exportar'],
        ['mês', 'receita', 'despesa', 'lucro', 'projeções'],
    ),
    '/activity': r(
        'Atividade Recente',
        'Mostra o log de atividades recentes do sistema: criações, edições, exclusões.',
        ['ver atividade recente', 'filtrar por tipo', 'filtrar por data'],
        ['ação', 'entidade', 'usuário', 'data'],
    ),
    '/whatsapp': r(
        'WhatsApp',
        'Gerencia conversas de WhatsApp integradas com clientes. Mostra contatos e mensagens.',
        ['ver conversas', 'enviar mensagem', 'ver histórico'],
        ['contato', 'mensagem', 'status', 'data'],
    ),
    '/email': r(
        'E-mail',
        'Gerencia emails integrados. Permite ver caixa de entrada, enviar emails e rastrear conversas.',
        ['ver emails', 'enviar email', 'ver conversa'],
        ['de', 'para', 'assunto', 'data', 'status'],
    ),
    '/automation': r(
        'Automações',
        'Configura agendamentos e automações do sistema (mensagens, relatórios, etc.).',
        ['listar automações', 'criar automação', 'editar automação', 'ativar/desativar'],
        ['nome', 'tipo', 'agendamento', 'status'],
    ),
    '/batch/new': r(
        'Criação em Lote',
        'Tela de confirmação para criação em lote de múltiplos registros. Gerada pelo assistente IA.',
        ['revisar itens', 'confirmar criação em lote', 'editar item individual'],
        ['tipo de entidade', 'itens', 'total'],
    ),
    '/development': r(
        'Desenvolvimento',
        'Painel de desenvolvimento com ferramentas de debug, sessões de chat do agente e status do sistema.',
        ['ver sessões do agente', 'debug', 'ver logs'],
        ['sessões IA', 'status', 'logs'],
    ),
    '/chat-sessions': r(
        'Sessões do Agente IA',
        'Lista todas as sessões de chat do assistente virtual com histórico e estatísticas.',
        ['listar sessões', 'ver histórico', 'ver estatísticas'],
        ['sessão', 'mensagens', 'data', 'duração'],
    ),
    '/settings': r(
        'Configurações',
        'Configurações gerais do sistema: perfil, aparência, notificações e integrações.',
        ['editar perfil', 'alterar configurações', 'gerenciar integrações'],
        ['perfil', 'tema', 'notificações', 'integrações'],
    ),
    '/admin/groups': r(
        'Gerenciamento de Grupos',
        'Administração de grupos de usuários e permissões.',
        ['listar grupos', 'criar grupo', 'editar grupo', 'gerenciar permissões'],
        ['nome do grupo', 'permissões', 'membros'],
    ),
    '/chat': r(
        'Chat',
        'Chat direto com contatos via WhatsApp ou outros canais de comunicação.',
        ['ver conversas', 'enviar mensagem', 'ver contato'],
        ['contato', 'canal', 'mensagem'],
    ),
    '/simulator': r(
        'Simulador Financeiro',
        'Simulador de cenários financeiros: drivers, negociação, ponto de equilíbrio e resultados.',
        ['criar simulação', 'ajustar drivers', 'ver resultados', 'comparar cenários'],
        ['drivers', 'receita', 'custos', 'margem', 'ponto de equilíbrio'],
    ),
    '/centrovibe': r(
        'CentroVibe',
        'Gerenciamento de eventos e entretenimento do CentroVibe.',
        ['listar eventos', 'criar evento', 'editar evento'],
        ['evento', 'data', 'local', 'capacidade'],
    ),
};

export function getViewInfo(pathname: string): ViewInfo | null {
    const normalized = pathname.replace(/\/+$/, '') || '/';
    if (VIEW_REGISTRY[normalized]) return VIEW_REGISTRY[normalized];

    const baseRoute = '/' + normalized.split('/').filter(Boolean)[0];
    if (VIEW_REGISTRY[baseRoute]) return VIEW_REGISTRY[baseRoute];

    const parts = normalized.split('/').filter(Boolean);
    if (parts.length >= 2) {
        const subRoute = `/${parts[0]}/${parts[1]}`;
        if (VIEW_REGISTRY[subRoute]) return VIEW_REGISTRY[subRoute];
    }

    return null;
}

export function formatViewContext(pathname: string, search?: string): string {
    const info = getViewInfo(pathname);
    if (!info) return `Página atual: ${pathname}`;

    let ctx = `Página atual: ${pathname}`;
    if (search) ctx += search;
    ctx += `\nTela: ${info.label}`;
    ctx += `\nDescrição: ${info.description}`;
    ctx += `\nAções: ${info.actions.join(', ')}`;
    if (info.fields) ctx += `\nCampos: ${info.fields.join(', ')}`;
    if (info.tips) ctx += `\nDicas: ${info.tips.join(' ')}`;
    return ctx;
}
