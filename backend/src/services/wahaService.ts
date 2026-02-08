import { sessionService } from './sessionService';
import { messageService } from './messageService';
import { logger } from '../utils/logger';

const log = logger.child('WahaService');

/*
 * [ANTIGRAVITY] Legacy Support Layer
 * This service now acts as a facade, delegating responsibilities to:
 * - SessionService (Lifecycle, Auth, Connection)
 * - MessageService (Sending, Retrieving messages)
 */

export class WahaService {
    constructor() {
        log.info('Facade Initialized.');
    }

    // --- Session Management ---

    public init() {
        // SessionService initializes itself via singleton pattern
        log.info('Init delegated to SessionService (already self-initialized).');
    }

    async startSession(sessionId: string) {
        return sessionService.startSession(sessionId);
    }

    async stopSession(sessionId: string) {
        return sessionService.stopSession(sessionId);
    }

    async deleteSession(sessionId: string) {
        return sessionService.deleteSession(sessionId);
    }

    async getScreenshot(sessionId: string) {
        return sessionService.getScreenshot(sessionId);
    }

    async getSessionStatus(sessionId: string) {
        return { status: sessionService.getStatus(sessionId) };
    }

    async getAllSessions() {
        return sessionService.getAllSessions();
    }

    // --- Message Operations ---

    async sendText(sessionId: string, chatId: string, text: string) {
        return messageService.sendText(sessionId, chatId, text);
    }

    async sendFile(sessionId: string, chatId: string, fileData: string, filename: string, caption?: string) {
        return messageService.sendFile(sessionId, chatId, fileData, filename, caption);
    }

    async sendVoice(sessionId: string, chatId: string, fileData: string) {
        return messageService.sendVoice(sessionId, chatId, fileData);
    }

    async sendVoiceNative(sessionId: string, chatId: string, fileData: string) {
        // Alias to same method, as new service handles native automatically
        return messageService.sendVoice(sessionId, chatId, fileData);
    }

    async getChats(sessionId: string) {
        return messageService.getChats(sessionId);
    }

    async getMessages(sessionId: string, chatId: string, limit: number = 50) {
        return messageService.getMessages(sessionId, chatId, limit);
    }

    async getMessageMedia(sessionId: string, messageId: string) {
        return messageService.getMessageMedia(sessionId, messageId);
    }
}

export const wahaService = new WahaService();

