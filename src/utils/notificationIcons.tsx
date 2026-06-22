/**
 * Shared notification icon utility — extraída do NotificationPanel para reutilização
 * na página MyNotificationsView e em outros pontos que exibem notificações.
 */
import React from 'react';
import { AlertTriangle, AlertCircle as AlertCircleIcon, Mail, Bot, MessageSquare, ShoppingCart, Info } from 'lucide-react';

export const NOTIFICATION_TYPE_LABELS: Record<string, string> = {
    stock: 'Estoque',
    invoice: 'Fatura',
    email: 'E-mail',
    agent: 'Agente',
    whatsapp: 'WhatsApp',
    ticket: 'Ticket',
    task: 'Tarefa',
    info: 'Info',
};

export function getNotificationIcon(type: string, priority: string): React.ReactElement {
    if (priority === 'high') return <AlertCircleIcon size={20} className="text-red-500" />;
    switch (type) {
        case 'stock': return <AlertTriangle size={20} className="text-orange-500" />;
        case 'invoice': return <AlertTriangle size={20} className="text-yellow-500" />;
        case 'email': return <Mail size={20} className="text-indigo-500" />;
        case 'agent': return <Bot size={20} className="text-purple-500" />;
        case 'whatsapp': return <MessageSquare size={20} className="text-green-500" />;
        case 'ticket': return <AlertCircleIcon size={20} className="text-amber-500" />;
        case 'task': return <ShoppingCart size={20} className="text-blue-500" />;
        default: return <Info size={20} className="text-blue-500" />;
    }
}
