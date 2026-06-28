import { Client, LocalAuth, MessageMedia } from 'whatsapp-web.js';
import * as QRCode from 'qrcode';
import * as fs from 'fs';
import * as path from 'path';
import { socketService } from '../socketService';
import { config } from '../../config/env';
import { botService } from '../botService';
import { createLogger } from '../../utils/logger';

const log = createLogger('SessionService');

// Helper to find local browser
const getBrowserPath = () => {
    if (config.chromeBin && fs.existsSync(config.chromeBin)) {
        return config.chromeBin;
    }

    const paths = [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
        '/usr/bin/google-chrome',
        '/usr/bin/chromium-browser'
    ];
    for (const path of paths) {
        if (fs.existsSync(path)) return path;
    }
    return undefined;
};

export class SessionService {
    private static instance: SessionService;

    // State
    private clients: Map<string, Client> = new Map();
    private qrCodes: Map<string, string> = new Map();
    private sessionStatus: Map<string, 'INITIALIZING' | 'SCAN_QR_CODE' | 'WORKING' | 'STOPPED' | 'STARTING'> = new Map();

    // Locks
    private initializationLocks: Map<string, boolean> = new Map();
    private sessionStartTimes: Map<string, number> = new Map();

    private constructor() {
        log.info('Instantiated.');
        this.loadSessionsFromDisk();
    }

    public static getInstance(): SessionService {
        if (!SessionService.instance) {
            SessionService.instance = new SessionService();
        }
        return SessionService.instance;
    }

    public getClient(sessionId: string): Client | undefined {
        return this.clients.get(sessionId);
    }

    public getStatus(sessionId: string) {
        return this.sessionStatus.get(sessionId) || 'STOPPED';
    }

    private setStatus(sessionId: string, status: 'INITIALIZING' | 'SCAN_QR_CODE' | 'WORKING' | 'STOPPED' | 'STARTING') {
        this.sessionStatus.set(sessionId, status);
        socketService.emit('session_status', { sessionId, status });
    }

    private loadSessionsFromDisk() {
        try {
            const authPath = '.wwebjs_auth';
            if (!fs.existsSync(authPath)) return;

            const files = fs.readdirSync(authPath, { withFileTypes: true });

            files.forEach(dirent => {
                if (dirent.isDirectory()) {
                    if (dirent.name === 'session') {
                        log.info('Found legacy default session: session');
                        this.startSession('default').catch(err => log.error('Failed to auto-start default', err));
                    }

                    const match = dirent.name.match(/^session-(.+)$/);
                    if (match) {
                        const sessionId = match[1];
                        log.info(`Found persisted session: ${sessionId}`);
                        this.startSession(sessionId).catch(err => log.error(`Failed to auto-start ${sessionId}`, err));
                    }
                }
            });
        } catch (error) {
            log.error('Failed to load sessions from disk', error);
        }
    }

    async startSession(sessionId: string) {
        if (this.initializationLocks.get(sessionId)) {
            log.info(`Session ${sessionId} is already initializing. Skipping.`);
            return { status: 'STARTING' };
        }

        const currentStatus = this.getStatus(sessionId);
        if (this.clients.has(sessionId)) {
            // Stuck check logic
            if (currentStatus === 'STARTING' || currentStatus === 'INITIALIZING') {
                const startTime = this.sessionStartTimes.get(sessionId) || 0;
                const elapsed = Date.now() - startTime;
                if (elapsed > 45000 && startTime > 0) {
                    log.warn(`Session ${sessionId} stuck in ${currentStatus}. Force restarting...`);
                    await this.stopSession(sessionId);
                } else {
                    return { status: currentStatus };
                }
            } else if (currentStatus === 'WORKING') {
                const client = this.clients.get(sessionId);
                if (client) {
                    try {
                        const state = await client.getState();
                        if (state === null) {
                            log.warn(`Session ${sessionId} state null. Resetting.`);
                            await this.stopSession(sessionId);
                        } else {
                            return { status: currentStatus };
                        }
                    } catch (e) {
                        await this.stopSession(sessionId);
                    }
                }
            } else {
                await this.stopSession(sessionId);
            }
        }

        log.info(`Creating new session: ${sessionId}`);
        this.setStatus(sessionId, 'INITIALIZING');
        this.initializationLocks.set(sessionId, true);
        this.sessionStartTimes.set(sessionId, Date.now());

        const executablePath = getBrowserPath();

        try {
            let authStrategy;
            const legacyPath = path.join('.wwebjs_auth', 'session');

            if (sessionId === 'default' && fs.existsSync(legacyPath)) {
                log.info("Using legacy 'session' folder for default.");
                authStrategy = new LocalAuth();
            } else {
                authStrategy = new LocalAuth({ clientId: sessionId });
            }

            const client = new Client({
                authStrategy: authStrategy,
                puppeteer: {
                    args: [
                        '--no-sandbox',
                        '--disable-setuid-sandbox',
                        '--disable-gpu',
                        '--disable-dev-shm-usage',
                        '--disable-extensions',
                        '--disable-accelerated-2d-canvas',
                        '--no-first-run'
                    ],
                    headless: true,
                    executablePath: executablePath
                }
            });

            this.clients.set(sessionId, client);
            this.setupEvents(client, sessionId);

            client.initialize().then(() => {
                log.info(`[${sessionId}] client.initialize() resolved.`);
                if (this.getStatus(sessionId) !== 'WORKING') {
                    this.setStatus(sessionId, 'WORKING');
                }
            }).catch(error => {
                log.error(`Failed to init ${sessionId}`, error);
                this.setStatus(sessionId, 'STOPPED');
                this.clients.delete(sessionId);
            }).finally(() => {
                this.initializationLocks.delete(sessionId);
            });

        } catch (err: any) {
            log.error(`CRITICAL ERROR creating client for ${sessionId}`, err);
            this.setStatus(sessionId, 'STOPPED');
            this.initializationLocks.delete(sessionId);
            throw err;
        }

        return { status: 'INITIALIZING' };
    }

    async stopSession(sessionId: string) {
        const client = this.clients.get(sessionId);
        if (client) {
            let pidToKill: number | undefined;
            try {
                // Tenta pegar o PID do chrome atrelado à sessão antes do destroy
                if (client.puppeteer && client.puppeteer.process) {
                    pidToKill = client.puppeteer.process()?.pid;
                }
                await client.destroy();
            } catch (e) {
                log.error(`Error destroying ${sessionId}`, e);
            }
            
            // Força matar o processo órfão no Windows caso o destroy() trave ou falhe
            if (pidToKill) {
                try {
                    if (process.platform === 'win32') {
                        require('child_process').exec(`taskkill /pid ${pidToKill} /T /F`, () => {});
                    } else {
                        process.kill(pidToKill, 'SIGKILL');
                    }
                } catch (killErr) {}
            }

            this.clients.delete(sessionId);
            this.sessionStatus.delete(sessionId);
            this.qrCodes.delete(sessionId);
            return { status: 'STOPPED' };
        }
        return { status: 'NOT_FOUND' };
    }

    async deleteSession(sessionId: string) {
        await this.stopSession(sessionId);
        await new Promise(resolve => setTimeout(resolve, 2000));

        let authPath = `.wwebjs_auth/session-${sessionId}`;
        if (sessionId === 'default' && !fs.existsSync(authPath) && fs.existsSync('.wwebjs_auth/session')) {
            authPath = '.wwebjs_auth/session';
        }

        if (fs.existsSync(authPath)) {
            try {
                fs.rmSync(authPath, { recursive: true, force: true });
                log.info(`Deleted session folder: ${authPath}`);
            } catch (error: any) {
                log.error(`Failed to delete session folder: ${error.message}`);
                throw new Error(`Failed to delete session folder: ${error.message}`);
            }
        }
        return { status: 'DELETED' };
    }

    async getScreenshot(sessionId: string) {
        const status = this.getStatus(sessionId);
        if (status === 'WORKING') return null;

        const qr = this.qrCodes.get(sessionId);
        if (!qr) return null;

        return await QRCode.toBuffer(qr);
    }

    getAllSessions() {
        const sessions: any[] = [];
        this.sessionStatus.forEach((status, id) => {
            sessions.push({ id, status });
        });
        return sessions;
    }

    /**
     * Send typing indicator to a chat
     */
    async sendTyping(sessionId: string, chatId: string) {
        const client = this.clients.get(sessionId);
        if (!client) {
            log.warn(`Cannot send typing: Session ${sessionId} not found`);
            return;
        }

        try {
            const chat = await client.getChatById(chatId);
            if (chat) {
                await chat.sendStateTyping();
                log.debug(`Typing indicator sent to ${chatId}`);
            }
        } catch (e: any) {
            log.warn(`Failed to send typing to ${chatId}: ${e.message}`);
        }
    }

    private resolveSenderName = async (msg: any): Promise<string> => {
        if (msg._data?.notifyName) return msg._data.notifyName;
        try {
            const contact = await msg.getContact();
            if (contact) return contact.name || contact.pushname || contact.shortName || (msg.author ? msg.author.split('@')[0] : '');
        } catch (e) { /* contact info unavailable, fallback to author */ }
        return msg.author ? msg.author.split('@')[0] : '';
    }

    private setupEvents(client: Client, sessionId: string) {
        client.on('qr', (qr) => {
            log.info(`[${sessionId}] QR Code received`);
            this.qrCodes.set(sessionId, qr);
            this.setStatus(sessionId, 'SCAN_QR_CODE');
            socketService.emit('session_qr', { sessionId, qr });
        });

        client.on('ready', () => {
            log.info(`[${sessionId}] Ready!`);
            this.setStatus(sessionId, 'WORKING');
            this.qrCodes.delete(sessionId);
        });

        client.on('authenticated', () => {
            log.info(`[${sessionId}] Authenticated`);
            // Fallback: If ready doesn't fire in 10 seconds, force WORKING
            setTimeout(() => {
                if (this.getStatus(sessionId) !== 'WORKING' && this.getStatus(sessionId) !== 'STOPPED') {
                    log.info(`[${sessionId}] Forcing WORKING status after 10s of authenticated (ready event missing)`);
                    this.setStatus(sessionId, 'WORKING');
                }
            }, 10000);
        });

        client.on('disconnected', (reason) => {
            log.info(`[${sessionId}] Disconnected: ${reason}`);
            this.setStatus(sessionId, 'STOPPED');

            const nonRecoverableReasons = ['LOGOUT', 'DELETED_SESSION'];
            if (!nonRecoverableReasons.includes(reason as string)) {
                setTimeout(() => {
                    const currentStatus = this.getStatus(sessionId);
                    if (currentStatus === 'STOPPED') {
                        log.info(`[${sessionId}] Auto-reconnecting...`);
                        this.startSession(sessionId);
                    }
                }, 5000);
            }
        });

        client.on('message_create', async msg => {
            const payload = {
                sessionId,
                from: msg.from,
                to: msg.to,
                body: msg.body,
                pushName: (msg as any)._data?.notifyName,
                senderName: await this.resolveSenderName(msg),
                fromMe: msg.fromMe,
                timestamp: msg.timestamp,
                hasMedia: msg.hasMedia,
                id: msg.id._serialized,
                type: msg.type,
                // @ts-ignore
                mimetype: (msg as any)._data?.mimetype
            };

            socketService.emit('whatsapp_message', payload);

            if (!msg.fromMe) {
                botService.processMessage(payload).catch(err => log.error('Bot Trigger Failed', err));
            }
        });

        client.on('message_ack', (msg, ack) => {
            socketService.emit('whatsapp_ack', {
                sessionId,
                messageId: msg.id._serialized,
                ack,
                status: ack >= 3 ? 'read' : ack >= 2 ? 'delivered' : 'sent'
            });
        });
    }

    async destroy() {
        log.info('Shutting down. Destroying all clients...');
        const promises: Promise<any>[] = [];

        this.clients.forEach((client, sessionId) => {
            log.info(`Destroying session ${sessionId}...`);
            const destroyPromise = client.destroy()
                .then(() => log.info(`Session ${sessionId} destroyed.`))
                .catch(e => log.error(`Error destroying ${sessionId}`, e));

            const timeoutPromise = new Promise(resolve => setTimeout(() => {
                log.warn(`Destroy timeout for ${sessionId}. Ignoring.`);
                resolve(null);
            }, 3000));

            promises.push(Promise.race([destroyPromise, timeoutPromise]));
        });

        await Promise.all(promises);
        this.clients.clear();
        this.sessionStatus.clear();
        this.qrCodes.clear();
        log.info('All clients destroyed.');
    }
    async getProfile(sessionId: string) {
        const client = this.clients.get(sessionId);
        if (!client) {
            throw new Error(`Session ${sessionId} not found`);
        }

        const wid = client.info.wid._serialized;
        const contact = await client.getContactById(wid);

        const picUrl = await contact.getProfilePicUrl().catch(() => '');
        const about = await contact.getAbout().catch(() => '');

        return {
            name: client.info.pushname,
            number: client.info.wid.user,
            about: about || '',
            profilePicUrl: picUrl,
            status: await client.getState()
        };
    }

    async setProfilePicture(sessionId: string, media: MessageMedia) {
        const client = this.clients.get(sessionId);
        if (!client) throw new Error(`Session ${sessionId} not found`);
        return await client.setProfilePicture(media);
    }

    async deleteProfilePicture(sessionId: string) {
        const client = this.clients.get(sessionId);
        if (!client) throw new Error(`Session ${sessionId} not found`);
        return await client.deleteProfilePicture();
    }

    async setDisplayName(sessionId: string, name: string) {
        const client = this.clients.get(sessionId);
        if (!client) throw new Error(`Session ${sessionId} not found`);
        return await client.setDisplayName(name);
    }

    async setAbout(sessionId: string, status: string) {
        const client = this.clients.get(sessionId);
        if (!client) throw new Error(`Session ${sessionId} not found`);
        return await client.setStatus(status);
    }

    async setPresence(sessionId: string, presence: 'online' | 'offline') {
        const client = this.clients.get(sessionId);
        if (!client) throw new Error(`Session ${sessionId} not found`);

        if (presence === 'online') {
            await client.sendPresenceAvailable();
        } else {
            await client.sendPresenceUnavailable();
        }
    }

}

export const sessionService = SessionService.getInstance();
