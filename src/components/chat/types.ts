/**
 * Tipos de domínio do módulo de Chat.
 *
 * Estas interfaces substituem o uso de `any` nos componentes de Chat
 * (ChatInterface, ChatSidebar, ChatLayout), fornecendo contratos de tipos
 * reutilizáveis para usuários, mensagens, canais e respostas.
 */
import type { AgendaEvent } from '../../types';

/** Status de presença de um usuário no chat. */
export type ChatUserStatus = 'online' | 'offline' | 'away';

/**
 * Usuário que participa de uma conversa.
 * Pode representar um usuário autenticado do sistema (ex.: DolibarrUser)
 * ou um contato externo exibido na lista de conversas.
 */
export interface ChatUser {
    id: string | number;
    nome: string;
    email?: string;
    avatar?: string;
    status: ChatUserStatus;
    lastSeen?: string | Date;
}

/**
 * Mensagem enviada em um canal/conversa.
 * O campo `replyTo` é uma referência (não aninhada) à mensagem original
 * quando esta mensagem é uma resposta.
 *
 * Os campos opcionais com sufixo Dolibarr (`label`, `description`,
 * `elementtype`, `fk_element`, `date_start`, `type_code`, `percentage`,
 * `_optimistic`) existem para que eventos persistidos pelo Dolibarr
 * (`AgendaEvent`) possam ser representados sem perder informação original
 * — por exemplo, o `label` precisa ser reaproveitado num PUT posterior.
 */
export interface ChatMessage {
    id: string | number;
    content: string;
    senderId: string | number;
    senderName?: string;
    channelId?: string | number;
    createdAt: string | Date;
    replyTo: ChatMessage | null;
    /** Rótulo original do evento Dolibarr (preservado para updates PUT). */
    label?: string;
    /** Espelha `AgendaEvent.description` (descrição HTML bruta). */
    description?: string;
    /** Tipo da entidade vinculada no Dolibarr (ex.: 'project', 'user'). */
    elementtype?: string;
    /** ID da entidade vinculada no Dolibarr. */
    fk_element?: string | number;
    /** Timestamp Unix (segundos) vindo do Dolibarr; usado para ordenação. */
    date_start?: number;
    /** Código do tipo de evento Dolibarr (ex.: 'AC_CHAT'). */
    type_code?: string;
    /** Percentual de conclusão do evento Dolibarr. */
    percentage?: number;
    /** Marcador interno de mensagem otimista (ainda não confirmada pelo servidor). */
    _optimistic?: boolean;
}

/** Classificação de um canal de conversa. */
export type ChatChannelType = 'direct' | 'group' | 'channel';

/**
 * Canal (ou conversa) que agrupa mensagens e participantes.
 * - `direct`: conversa 1:1 entre dois usuários.
 * - `group`: grupo com múltiplos participantes.
 * - `channel`: canal temático/aberto.
 */
export interface ChatChannel {
    id: string | number;
    name: string;
    type: ChatChannelType;
    participants: ChatUser[];
    lastMessage?: ChatMessage;
}

/**
 * Resposta a uma mensagem específica, usada para renderizar o contexto de
 * "respondendo a" acima do campo de envio. `messageId` referencia a
 * mensagem original que está sendo respondida.
 */
export interface ChatReply {
    messageId: string | number;
    content: string;
    senderId: string | number;
    senderName?: string;
    createdAt: string | Date;
}

/**
 * Constrói uma `ChatMessage` a partir de um `AgendaEvent` do Dolibarr,
 * preenchendo os campos canônicos (content/senderId/createdAt/replyTo)
 * e preservando os campos originais necessários para filtros, ordenação
 * e payloads de update subsequentes.
 */
export const agendaEventToChatMessage = (e: AgendaEvent): ChatMessage => ({
    id: e.id,
    content: e.description || e.label || '',
    senderId: e.fk_user_author ?? '',
    senderName: e.user_author_name,
    createdAt: new Date(e.date_start * 1000),
    replyTo: null,
    label: e.label,
    description: e.description,
    elementtype: e.elementtype,
    fk_element: e.fk_element,
    date_start: e.date_start,
    type_code: e.type_code,
    percentage: e.percentage,
});
