export { ChatInterface } from './ChatInterface';
// #1577: ChatMessages é o componente de chat baseado em JOBS assíncronos (com botão
// Cancelar, sinal de Page Visibility e config de notificações localStorage). Reexportado
// aqui para consumers outside da pasta (ex.: VirtualAssistant) usarem pelo mesmo barrel.
export { ChatMessages } from './ChatMessages';
export type { ChatMessagesProps } from './ChatMessages';

export type {
    ChatUser,
    ChatUserStatus,
    ChatMessage,
    ChatChannel,
    ChatChannelType,
    ChatReply,
} from './types';
