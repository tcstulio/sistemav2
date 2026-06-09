export interface NotificationTemplate {
    id: string;
    event: string;
    channel: 'in-app' | 'whatsapp' | 'email';
    template: string;
    variables: string[];
    tone: 'formal' | 'informal';
}

const TEMPLATES: NotificationTemplate[] = [
    {
        id: 'invoice.created.whatsapp',
        event: 'invoice.created',
        channel: 'whatsapp',
        tone: 'formal',
        template: 'Olá {nome}! A fatura *{ref}* no valor de *R$ {amount}* foi gerada. Vencimento: {date}. Qualquer dúvida, estamos à disposição!',
        variables: ['nome', 'ref', 'amount', 'date'],
    },
    {
        id: 'invoice.created.email',
        event: 'invoice.created',
        channel: 'email',
        tone: 'formal',
        template: 'Prezado(a) {nome},\n\nInformamos que a fatura {ref} no valor de R$ {amount} foi gerada com vencimento para {date}.\n\nPara dúvidas, entre em contato conosco.\n\nAtenciosamente,\nCoolGroove',
        variables: ['nome', 'ref', 'amount', 'date'],
    },
    {
        id: 'invoice.overdue.whatsapp',
        event: 'invoice.overdue',
        channel: 'whatsapp',
        tone: 'formal',
        template: 'Olá {nome}, a fatura *{ref}* venceu em {date}. Valor: *R$ {amount}*. Por favor, entre em contato para regularizar.',
        variables: ['nome', 'ref', 'date', 'amount'],
    },
    {
        id: 'invoice.overdue.team',
        event: 'invoice.overdue',
        channel: 'in-app',
        tone: 'informal',
        template: 'Fatura {ref} de {nome} venceu em {date}. Valor: R$ {amount}',
        variables: ['ref', 'nome', 'date', 'amount'],
    },
    {
        id: 'invoice.paid.whatsapp',
        event: 'invoice.paid',
        channel: 'whatsapp',
        tone: 'formal',
        template: 'Recebemos seu pagamento da fatura *{ref}*. Obrigado, {nome}! 🎉',
        variables: ['ref', 'nome'],
    },
    {
        id: 'proposal.sent.whatsapp',
        event: 'proposal.sent',
        channel: 'whatsapp',
        tone: 'formal',
        template: 'Olá {nome}! Enviamos a proposta *{ref}* no valor de *R$ {amount}*. Aguardamos seu retorno!',
        variables: ['nome', 'ref', 'amount'],
    },
    {
        id: 'proposal.accepted.team',
        event: 'proposal.accepted',
        channel: 'in-app',
        tone: 'informal',
        template: 'Proposta {ref} de {nome} foi ACEITA! Valor: R$ {amount}',
        variables: ['ref', 'nome', 'amount'],
    },
    {
        id: 'order.validated.team',
        event: 'order.validated',
        channel: 'in-app',
        tone: 'informal',
        template: 'Pedido {ref} de {nome} validado. Valor: R$ {amount}',
        variables: ['ref', 'nome', 'amount'],
    },
    {
        id: 'order.confirmed.whatsapp',
        event: 'order.validated',
        channel: 'whatsapp',
        tone: 'formal',
        template: 'Olá {nome}! Seu pedido *{ref}* foi confirmado! Previsão: {date}. Obrigado pela preferência!',
        variables: ['nome', 'ref', 'date'],
    },
    {
        id: 'ticket.created.team',
        event: 'ticket.created',
        channel: 'in-app',
        tone: 'informal',
        template: 'Novo ticket de {customer}: {subject}',
        variables: ['customer', 'subject'],
    },
    {
        id: 'task.completed.team',
        event: 'task.completed',
        channel: 'in-app',
        tone: 'informal',
        template: 'Tarefa "{label}" concluída no projeto {project}',
        variables: ['label', 'project'],
    },
    {
        id: 'stock.low.team',
        event: 'stock.low',
        channel: 'in-app',
        tone: 'informal',
        template: 'Estoque baixo: {product} — restam {qty} unidades (mínimo: {min})',
        variables: ['product', 'qty', 'min'],
    },
    {
        id: 'payment.received.team',
        event: 'payment.received',
        channel: 'in-app',
        tone: 'informal',
        template: 'Pagamento de R$ {amount} recebido de {nome} (fatura {ref})',
        variables: ['amount', 'nome', 'ref'],
    },
    {
        id: 'agent.action.team',
        event: 'agent.action',
        channel: 'in-app',
        tone: 'informal',
        template: '{description}',
        variables: ['description'],
    },
    {
        id: 'agent.invoice.created.team',
        event: 'agent.invoice.created',
        channel: 'in-app',
        tone: 'informal',
        template: 'Criei a fatura {ref} para {customer}. Valor: R$ {amount}',
        variables: ['ref', 'customer', 'amount'],
    },
    {
        id: 'agent.order.validated.team',
        event: 'agent.order.validated',
        channel: 'in-app',
        tone: 'informal',
        template: 'Validei o pedido {ref} de {customer}',
        variables: ['ref', 'customer'],
    },
    {
        id: 'agent.customer.created.team',
        event: 'agent.customer.created',
        channel: 'in-app',
        tone: 'informal',
        template: 'Cadastrei o cliente {name} ({email})',
        variables: ['name', 'email'],
    },
];

export function getTemplate(event: string, channel: 'in-app' | 'whatsapp' | 'email'): NotificationTemplate | undefined {
    return TEMPLATES.find(t => t.event === event && t.channel === channel);
}

export function renderTemplate(event: string, channel: 'in-app' | 'whatsapp' | 'email', data: Record<string, string>): string {
    const template = getTemplate(event, channel);
    if (!template) {
        return Object.entries(data).map(([k, v]) => `${k}: ${v}`).join(', ');
    }
    let result = template.template;
    for (const [key, value] of Object.entries(data)) {
        result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), value);
    }
    return result;
}

export function getAllTemplates(): NotificationTemplate[] {
    return TEMPLATES;
}

// Camada 2 — título + mensagem por evento de tarefa (mesma mensagem p/ todos os canais por ora;
// refinamento por canal/tom pode vir depois). Variáveis: {nome} {ref} {label} {date} {progress}.
const TASK_TEMPLATES: Record<string, { title: string; message: string }> = {
    assigned:           { title: 'Nova tarefa atribuída', message: 'Olá {nome}, você é responsável pela tarefa {ref} — {label}.' },
    acceptance_pending: { title: 'Confirme o recebimento', message: 'Olá {nome}, você recebeu a delegação {ref} — {label}. Confirme se aceita (até {date}).' },
    acceptance_overdue: { title: 'Delegação sem aceite', message: 'A delegação {ref} — {label} não foi aceita pelo responsável no prazo. Convém acompanhar.' },
    deadline_reminder:  { title: 'Prazo se aproximando', message: 'Olá {nome}, a tarefa {ref} — {label} vence em {date}.' },
    overdue:           { title: 'Tarefa atrasada', message: 'Olá {nome}, a tarefa {ref} — {label} venceu em {date}. Finalize ou informe o status, por favor.' },
    stalled:           { title: 'Tarefa parada', message: 'Olá {nome}, a tarefa {ref} — {label} está sem progresso. Consegue atualizar?' },
    completed:         { title: 'Tarefa concluída', message: 'A tarefa {ref} — {label} foi concluída.' },
    comment:           { title: 'Atualização em tarefa', message: 'Houve uma atualização na tarefa {ref} — {label}.' },
};

export function renderTaskTemplate(event: string, vars: Record<string, string>): { title: string; message: string } {
    const sub = (s: string) => s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? ''));
    const t = TASK_TEMPLATES[event] || { title: 'Tarefa', message: '{ref} — {label}' };
    return { title: sub(t.title), message: sub(t.message) };
}
