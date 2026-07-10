/**
 * Tipos de domínio do módulo de Chat.
 *
 * Estas interfaces substituem o uso de `any` nos componentes de Chat
 * (ChatInterface, ChatSidebar, ChatLayout), fornecendo contratos de tipos
 * reutilizáveis para usuários, mensagens, canais e respostas.
 */

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
 */
export interface ChatMessage {
    id: string | number;
    content: string;
    senderId: string | number;
    senderName?: string;
    channelId?: string | number;
    createdAt: string | Date;
    replyTo: ChatMessage | null;
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
    createdAt: string | Date;
}
