/**
 * Testes de tipos do módulo de Chat (issue #1025).
 *
 * Como as interfaces são apagadas em runtime, estes testes combinam:
 *  - asserções de runtime sobre objetos que satisfazem cada interface; e
 *  - verificações de "shape" em tempo de compilação via @ts-expect-error,
 *    que falham o `tsc --noEmit` caso a tipagem regreda (opcionais, unions, etc.).
 */
import { describe, it, expect } from 'vitest';
import type {
    ChatUser,
    ChatMessage,
    ChatChannel,
    ChatReply,
    ChatUserStatus,
    ChatChannelType,
} from './types';
import { agendaEventToChatMessage } from './types';
import type { AgendaEvent } from '../../types';

describe('Chat types — ChatUser', () => {
    it('aceita o objeto mínimo (id/nome/status) e id numérico', () => {
        const user: ChatUser = { id: 'u1', nome: 'Ana', status: 'online' };
        expect(user.id).toBe('u1');
        expect(user.nome).toBe('Ana');

        const numericId: ChatUser = { id: 42, nome: 'Bo', status: 'offline' };
        expect(numericId.id).toBe(42);
    });

    it('aceita os campos opcionais preenchidos', () => {
        const full: ChatUser = {
            id: 1,
            nome: 'Ada',
            email: 'ada@exemplo.com',
            avatar: 'https://img/ada.png',
            status: 'away',
            lastSeen: '2024-01-02T10:00:00Z',
        };
        expect(full.email).toBe('ada@exemplo.com');
        expect(full.avatar).toContain('ada.png');
    });

    it('aceita lastSeen como Date', () => {
        const d = new Date('2024-01-01');
        const user: ChatUser = { id: '1', nome: 'x', status: 'online', lastSeen: d };
        expect(user.lastSeen).toBe(d);
    });
});

describe('Chat types — ChatMessage', () => {
    it('exige content e senderId; replyTo pode ser null', () => {
        const msg: ChatMessage = {
            id: 'm1',
            content: 'Olá',
            senderId: 'u1',
            createdAt: '2024-01-01T00:00:00Z',
            replyTo: null,
        };
        expect(msg.content).toBe('Olá');
        expect(msg.replyTo).toBeNull();
    });

    it('replyTo aceita uma referência a outra ChatMessage (não aninhada)', () => {
        const original: ChatMessage = {
            id: 'm1',
            content: 'original',
            senderId: 'u1',
            createdAt: '2024-01-01T00:00:00Z',
            replyTo: null,
        };
        const reply: ChatMessage = {
            id: 'm2',
            content: 'resposta',
            senderId: 'u2',
            createdAt: new Date('2024-01-02'),
            replyTo: original,
        };
        expect(reply.replyTo).toBe(original);
        expect((reply.replyTo as ChatMessage).id).toBe('m1');
    });

    it('aceita os opcionais senderName e channelId', () => {
        const msg: ChatMessage = {
            id: 9,
            content: 'hi',
            senderId: 1,
            senderName: 'Ada',
            channelId: 'c1',
            createdAt: '2024-01-01',
            replyTo: null,
        };
        expect(msg.senderName).toBe('Ada');
        expect(msg.channelId).toBe('c1');
    });
});

describe('Chat types — ChatChannel', () => {
    it('classifica participantes e última mensagem', () => {
        const participants: ChatUser[] = [
            { id: 'u1', nome: 'Ana', status: 'online' },
            { id: 'u2', nome: 'Bo', status: 'offline' },
        ];
        const lastMessage: ChatMessage = {
            id: 'm1',
            content: 'última',
            senderId: 'u1',
            createdAt: '2024-01-01',
            replyTo: null,
        };
        const channel: ChatChannel = {
            id: 'c1',
            name: 'Time',
            type: 'group',
            participants,
            lastMessage,
        };
        expect(channel.participants).toHaveLength(2);
        expect(channel.type).toBe('group');
        expect(channel.lastMessage?.content).toBe('última');
    });

    it('lastMessage é opcional', () => {
        const channel: ChatChannel = {
            id: 'd1',
            name: 'DM',
            type: 'direct',
            participants: [{ id: 1, nome: 'A', status: 'away' }],
        };
        expect(channel.lastMessage).toBeUndefined();
    });

    it('aceita o tipo "channel"', () => {
        const channel: ChatChannel = {
            id: 'ch1',
            name: 'Geral',
            type: 'channel',
            participants: [],
        };
        expect(channel.type).toBe('channel');
    });
});

describe('Chat types — ChatReply', () => {
    it('referencia a mensagem original via messageId', () => {
        const reply: ChatReply = {
            messageId: 'm1',
            content: 'contexto da resposta',
            senderId: 'u2',
            createdAt: '2024-01-02T00:00:00Z',
        };
        expect(reply.messageId).toBe('m1');
        expect(reply.senderId).toBe('u2');
    });

    it('aceita senderName opcional para exibir no banner de resposta (#1572)', () => {
        const reply: ChatReply = {
            messageId: 'm1',
            content: 'contexto',
            senderId: 'u2',
            senderName: 'Marina',
            createdAt: '2024-01-02T00:00:00Z',
        };
        expect(reply.senderName).toBe('Marina');
    });
});

describe('Chat types — restrições de união (compile-time via tsc)', () => {
    it('ChatUserStatus cobre online/offline/away', () => {
        const statuses: ChatUserStatus[] = ['online', 'offline', 'away'];
        expect(statuses).toHaveLength(3);
    });

    it('ChatChannelType cobre direct/group/channel', () => {
        const types: ChatChannelType[] = ['direct', 'group', 'channel'];
        expect(types).toHaveLength(3);
    });

    // @ts-expect-error — status fora da união não é atribuível
    const invalidUserStatus: ChatUser = { id: 1, nome: 'x', status: 'busy' };

    // @ts-expect-error — "nome" é obrigatório em ChatUser
    const missingNome: ChatUser = { id: 1, status: 'online' };

    // @ts-expect-error — tipo de canal inválido
    const invalidChannelType: ChatChannel = { id: 'c', name: 'x', type: 'public', participants: [] };

    // @ts-expect-error — replyTo deve ser ChatMessage | null (string não serve)
    const invalidReplyTo: ChatMessage = { id: 'm', content: 'c', senderId: 's', createdAt: '2024-01-01', replyTo: 'not-a-message' };

    // @ts-expect-error — "content" é obrigatório em ChatMessage
    const missingContent: ChatMessage = { id: 'm', senderId: 's', createdAt: 'x', replyTo: null };

    // @ts-expect-error — "participants" é obrigatório em ChatChannel
    const missingParticipants: ChatChannel = { id: 'c', name: 'n', type: 'group' };

    // silencia "não utilizado" e valida que as construções inválidas existem p/ o tsc rejeitar
    it('dummy: referencia as construções inválidas', () => {
        expect(invalidUserStatus).toBeDefined();
        expect(missingNome).toBeDefined();
        expect(invalidChannelType).toBeDefined();
        expect(invalidReplyTo).toBeDefined();
        expect(missingContent).toBeDefined();
        expect(missingParticipants).toBeDefined();
    });
});

describe('Chat types — ChatMessage compat Dolibarr (#1572)', () => {
    it('aceita campos opcionais espelhando AgendaEvent (label/description/elementtype/etc.)', () => {
        const msg: ChatMessage = {
            id: 'ev1',
            content: 'Olá',
            senderId: 'u1',
            createdAt: '2024-01-01T00:00:00Z',
            replyTo: null,
            label: 'Comentário em project',
            description: 'Olá',
            elementtype: 'project',
            fk_element: '42',
            date_start: 1700000000,
            type_code: 'AC_CHAT',
            percentage: 100,
            _optimistic: true,
        };
        expect(msg.elementtype).toBe('project');
        expect(msg.fk_element).toBe('42');
        expect(msg.date_start).toBe(1700000000);
        expect(msg._optimistic).toBe(true);
    });

    it('continua permitindo o objeto mínimo (campos Dolibarr ausentes)', () => {
        const msg: ChatMessage = {
            id: 'm1',
            content: 'oi',
            senderId: 'u1',
            createdAt: '2024-01-01',
            replyTo: null,
        };
        expect(msg.description).toBeUndefined();
        expect(msg.elementtype).toBeUndefined();
    });
});

describe('Chat types — agendaEventToChatMessage (#1572)', () => {
    const baseEvent: AgendaEvent = {
        id: 'ev-42',
        ref: 'REF',
        label: 'Comentário em project',
        date_start: 1700000000,
        date_end: 1700000000,
        type_code: 'AC_CHAT',
        percentage: 100,
        description: 'Hello world',
        elementtype: 'project',
        fk_element: '12',
        fk_user_author: 'u9',
        user_author_name: 'Ivo',
    };

    it('mapeia campos canônicos a partir do AgendaEvent', () => {
        const msg = agendaEventToChatMessage(baseEvent);
        expect(msg.id).toBe('ev-42');
        expect(msg.content).toBe('Hello world');
        expect(msg.senderId).toBe('u9');
        expect(msg.senderName).toBe('Ivo');
        expect(msg.replyTo).toBeNull();
        expect(msg.createdAt).toEqual(new Date(1700000000 * 1000));
    });

    it('preserva os campos Dolibarr para filtros, dedup, ordenação e PUT', () => {
        const msg = agendaEventToChatMessage(baseEvent);
        expect(msg.label).toBe('Comentário em project');
        expect(msg.description).toBe('Hello world');
        expect(msg.elementtype).toBe('project');
        expect(msg.fk_element).toBe('12');
        expect(msg.date_start).toBe(1700000000);
        expect(msg.type_code).toBe('AC_CHAT');
        expect(msg.percentage).toBe(100);
    });

    it('usa label quando description está ausente (fallback de content)', () => {
        const msg = agendaEventToChatMessage({ ...baseEvent, description: undefined });
        expect(msg.content).toBe('Comentário em project');
    });

    it('retorna content vazio quando nem description nem label existem', () => {
        const msg = agendaEventToChatMessage({
            ...baseEvent,
            description: undefined,
            label: '',
        });
        expect(msg.content).toBe('');
    });

    it('senderId vazio quando fk_user_author ausente', () => {
        const msg = agendaEventToChatMessage({ ...baseEvent, fk_user_author: undefined });
        expect(msg.senderId).toBe('');
    });
});
