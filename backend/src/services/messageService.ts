import { sessionService } from './sessionService';
import { AudioTranscoder } from '../utils/audioTranscoder';
import { MessageMedia } from 'whatsapp-web.js';
import * as path from 'path';
import { logger } from '../utils/logger';

const log = logger.child('MessageService');

export class MessageService {
    private static instance: MessageService;

    private constructor() { }

    public static getInstance(): MessageService {
        if (!MessageService.instance) {
            MessageService.instance = new MessageService();
        }
        return MessageService.instance;
    }

    private getClient(sessionId: string) {
        const client = sessionService.getClient(sessionId);
        if (!client) throw new Error(`Session ${sessionId} not found`);
        if (sessionService.getStatus(sessionId) !== 'WORKING') throw new Error(`Session ${sessionId} not ready`);
        return client;
    }

    private formatChatId(chatId: string) {
        return chatId.includes('@') ? chatId : `${chatId}@c.us`;
    }

    async sendText(sessionId: string, chatId: string, text: string) {
        const client = this.getClient(sessionId);
        const msg = await client.sendMessage(this.formatChatId(chatId), text);
        return { id: msg.id._serialized, timestamp: msg.timestamp };
    }

    async sendFile(sessionId: string, chatId: string, fileData: string, filename: string, caption?: string) {
        const client = this.getClient(sessionId);
        const mimetype = fileData.split(';')[0].split(':')[1];
        const data = fileData.split(',')[1];

        const media = new MessageMedia(mimetype, data, filename);
        const msg = await client.sendMessage(this.formatChatId(chatId), media, { caption });

        return { id: msg.id._serialized };
    }

    async sendVoice(sessionId: string, chatId: string, fileData: string) {
        const client = this.getClient(sessionId);

        if (!fileData.startsWith('data:')) throw new Error('Invalid Audio Data Format');

        log.info(`Transcoding audio for ${chatId}...`);

        // Use isolated AudioTranscoder
        const convertedBase64 = await AudioTranscoder.convertAudioToOgg(fileData);

        const media = new MessageMedia('audio/ogg; codecs=opus', convertedBase64, 'voice.ogg');
        const msg = await client.sendMessage(this.formatChatId(chatId), media, { sendAudioAsVoice: true });

        return { id: msg.id._serialized, timestamp: msg.timestamp };
    }

    async getChats(sessionId: string) {
        const client = this.getClient(sessionId);
        const chats = await client.getChats();

        return chats.map(c => ({
            id: c.id._serialized,
            name: c.name,
            unreadCount: c.unreadCount,
            timestamp: c.timestamp,
            isGroup: c.isGroup,
            lastMessage: (c as any).lastMessage ? (c as any).lastMessage.body : '',
            accountId: sessionId
        }));
    }

    async getMessages(sessionId: string, chatId: string, limit: number = 50) {
        const client = this.getClient(sessionId);
        const chatIdFormatted = this.formatChatId(chatId);

        let chat;
        try {
            chat = await client.getChatById(chatIdFormatted);
        } catch (e) { }

        if (!chat) {
            try {
                const contact = await client.getContactById(chatIdFormatted);
                if (contact) chat = await contact.getChat();
            } catch (e) { }
        }

        if (!chat) return [];

        const messages = await chat.fetchMessages({ limit });

        return await Promise.all(messages.map(async (m: any) => ({
            id: m.id._serialized,
            body: m.body,
            fromMe: m.fromMe,
            timestamp: m.timestamp,
            hasMedia: m.hasMedia,
            ack: m.ack,
            sender: m.fromMe ? 'agent' : 'user',
            senderName: await this.resolveSenderName(client, m),
            status: m.ack >= 3 ? 'read' : m.ack >= 2 ? 'delivered' : 'sent',
            type: m.type,
            mimetype: m._data?.mimetype
        })));
    }

    private async resolveSenderName(client: any, msg: any): Promise<string> {
        if (msg._data?.notifyName) return msg._data.notifyName;
        try {
            const contact = await msg.getContact();
            if (contact) return contact.name || contact.pushname || contact.shortName;
        } catch (e) { }
        return '';
    }

    async getMessageMedia(sessionId: string, messageId: string) {
        const client = this.getClient(sessionId);
        try {
            const msg = await client.getMessageById(messageId);
            if (msg && msg.hasMedia) {
                const media = await msg.downloadMedia();
                if (media) {
                    return {
                        data: Buffer.from(media.data, 'base64'),
                        contentType: media.mimetype
                    };
                }
            }
        } catch (e) {
            log.error('Error fetching media', e);
        }
        return null;
    }
}

export const messageService = MessageService.getInstance();
