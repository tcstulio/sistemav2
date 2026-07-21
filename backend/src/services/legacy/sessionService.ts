import { Client, LocalAuth, MessageMedia } from 'whatsapp-web.js';
import * as QRCode from 'qrcode';
import * as fs from 'fs';
import * as path from 'path';
import { socketService } from '../socketService';
import { config } from '../../config/env';
import { botService } from '../botService';
import { createLogger } from '../../utils/logger';
import { killChromesByProfile } from '../../utils/processTree';

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

    // #wa-autorecover: o discriminador de "usuário removeu de propósito" é a EXISTÊNCIA da pasta de
    // auth — deleteSession (rota DELETE /sessions) apaga a pasta; o sweep então pula (não ressuscita).
    // NÃO usamos o evento 'disconnected(LOGOUT)' p/ isso: ele dispara em desconexões TRANSITÓRIAS do
    // WhatsApp com auth ainda VÁLIDA (visto em 21/07: sessão marcada "logout" reconectou a WORKING no
    // start manual) — marcar loggedOut ali travava a recuperação de uma sessão perfeitamente boa.
    private healthTimer: NodeJS.Timeout | null = null;

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

    /**
     * Id da primeira sessão em estado WORKING (ordem de inserção), ou undefined se nenhuma
     * estiver pronta. Fallback de roteamento quando a sessão default nomeada não existe/está fora
     * (ex.: a única sessão conectada tem outro nome, como 'v4').
     */
    public getFirstWorkingSessionId(): string | undefined {
        for (const [id, status] of this.sessionStatus) {
            if (status === 'WORKING') return id;
        }
        return undefined;
    }

    public getStatus(sessionId: string) {
        return this.sessionStatus.get(sessionId) || 'STOPPED';
    }

    private setStatus(sessionId: string, status: 'INITIALIZING' | 'SCAN_QR_CODE' | 'WORKING' | 'STOPPED' | 'STARTING') {
        this.sessionStatus.set(sessionId, status);
        socketService.emit('session_status', { sessionId, status });
    }

    /**
     * #wa-autorecover: sweep periódico que RECUPERA sessões STOPPED com auth salva. A reconexão
     * de hoje é só event-driven (`on('disconnected')`); quando o chrome MORRE sem disparar o evento
     * (crash do backend, kill externo, OOM), a sessão fica STOPPED sem QR/sem reconectar até um
     * restart manual do backend — o bug que travou o dono em 21/07 (QR não aparecia). Respeita
     * logout deliberado (`loggedOut`): não ressuscita sessão que o usuário desconectou de propósito.
     * PREVIEW-safe: só é ligado pelo server.ts fora de PREVIEW_MODE.
     */
    public startHealthMonitor() {
        if (this.healthTimer) return;
        const INTERVAL = Number(process.env.WHATSAPP_HEALTH_INTERVAL_MS) || 90_000;
        this.healthTimer = setInterval(() => this.recoverStoppedSessions(), INTERVAL);
        if (this.healthTimer.unref) this.healthTimer.unref();
        log.info(`WhatsApp health monitor started (a cada ${Math.round(INTERVAL / 1000)}s) — auto-recover de sessões STOPPED`);
    }

    public stopHealthMonitor() {
        if (this.healthTimer) { clearInterval(this.healthTimer); this.healthTimer = null; }
    }

    /** Recupera sessões persistidas (com pasta de auth) que estão STOPPED e não foram deslogadas. */
    private recoverStoppedSessions() {
        try {
            const authPath = '.wwebjs_auth';
            if (!fs.existsSync(authPath)) return;
            for (const dirent of fs.readdirSync(authPath, { withFileTypes: true })) {
                if (!dirent.isDirectory()) continue;
                const m = dirent.name.match(/^session-(.+)$/);
                if (!m) continue;
                const sessionId = m[1];
                // A pasta de auth existir = a sessão deve estar de pé (deleteSession apaga a pasta).
                if (this.initializationLocks.get(sessionId)) continue; // já iniciando/reconectando
                if (this.getStatus(sessionId) !== 'STOPPED') continue; // SCAN_QR/WORKING/STARTING = ok
                log.warn(`[${sessionId}] health monitor: STOPPED com auth salva — auto-recuperando (regenera QR/reconecta).`);
                this.startSession(sessionId).catch(err => log.error(`[${sessionId}] auto-recover falhou`, err));
            }
        } catch (e: any) {
            log.warn(`recoverStoppedSessions falhou: ${e?.message || e}`);
        }
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
            const usesLegacy = sessionId === 'default' && fs.existsSync(legacyPath);

            if (usesLegacy) {
                log.info("Using legacy 'session' folder for default.");
                authStrategy = new LocalAuth();
            } else {
                authStrategy = new LocalAuth({ clientId: sessionId });
            }

            // #896/#1174: defesa ATIVA contra chrome ZUMBI segurando o SingletonLock do perfil (incidentes
            // 2026-06-25 e 2026-07-07: 7 chromes de um restart antigo travavam TODO initialize → sessão
            // 'degraded' p/ sempre). O gracefulShutdown existe desde bcee37e mas NÃO cobre o Windows:
            // o nodemon reinicia SEM entregar sinal, então o destroy() nunca roda. Aqui é infalível:
            // quem segura o perfil que VAMOS abrir é zumbi por definição. Needle específico do perfil
            // desta sessão (não afeta outras sessões ativas nem o navegador pessoal — kill ESTRITO).
            // Sessão legacy ('session' sem sufixo) fica de fora: o needle seria prefixo dos 'session-*'.
            if (!usesLegacy) {
                try {
                    const profileNeedle = path.join('.wwebjs_auth', `session-${sessionId}`);
                    const sweep = await killChromesByProfile(profileNeedle);
                    if (sweep.killed.length) {
                        log.warn(`[${sessionId}] ${sweep.killed.length} chrome zumbi segurando o perfil — morto(s) antes do init: [${sweep.killed.join(', ')}]`);
                        await new Promise((r) => setTimeout(r, 1000)); // respiro p/ o SO soltar o SingletonLock
                    }
                    if (sweep.errors.length) log.warn(`[${sessionId}] sweep de chrome: ${sweep.errors.join('; ')}`);
                } catch { /* defesa é best-effort — nunca impede o start */ }
            }

            const client = new Client({
                authStrategy: authStrategy,
                webVersionCache: { type: 'remote', remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html' },
                puppeteer: {
                    args: [
                        '--no-sandbox',
                        '--disable-setuid-sandbox',
                        '--disable-gpu',
                        '--disable-dev-shm-usage',
                        '--disable-extensions',
                        '--disable-accelerated-2d-canvas',
                        '--no-first-run',
                        '--disk-cache-size=0',
                        '--js-flags=--max-old-space-size=4096'
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
                // #896 (metade que faltou do PR #897): destrói o browser da inicialização FALHADA —
                // sem isto o chrome do init quebrado fica órfão segurando o perfil até alguém matar.
                client.destroy().catch(() => { /* já morto/nunca abriu */ });
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
                // Tenta pegar o PID do chrome atrelado à sessão antes do destroy.
                // O type `Client` do whatsapp-web.js não expõe `.puppeteer`, mas existe em runtime.
                const pup = (client as any).puppeteer;
                if (pup && pup.process) {
                    pidToKill = pup.process()?.pid;
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

    private resolveRealSender = async (msg: any): Promise<string> => {
        let phone = msg.from;
        if (phone && phone.includes('@lid')) {
            try {
                const contact = await msg.getContact();
                if (contact && contact.number) {
                    return `${contact.number}@c.us`;
                }
            } catch (e) { /* ignore */ }
        }
        return phone;
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

        // #900 (parte válida do PR #901): reconexões silenciosas do wwebjs às vezes chegam só como
        // change_state=CONNECTED (sem 'ready'/'authenticated' novos) — sem este handler a sessão
        // funcional ficava marcada não-WORKING p/ sempre (health 'degraded' falso).
        client.on('change_state', (state) => {
            log.info(`[${sessionId}] State changed: ${state}`);
            if (String(state) === 'CONNECTED' && this.getStatus(sessionId) !== 'WORKING') {
                log.info(`[${sessionId}] Forcing WORKING status due to CONNECTED state`);
                this.setStatus(sessionId, 'WORKING');
            }
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
            // #wa-autorecover: NÃO marcamos "loggedOut" aqui — um LOGOUT do whatsapp-web.js NÃO significa
            // que o usuário quer a sessão fora (a auth costuma seguir válida). Se o usuário REMOVER a
            // sessão (rota DELETE), a pasta de auth some e o sweep pula naturalmente. Aqui, se a auth
            // persistir em disco, o sweep vai reerguer (reconecta OU mostra QR p/ re-scan).
        });

        client.on('message_create', async msg => {
            const payload = {
                sessionId,
                from: msg.from,
                realSender: await this.resolveRealSender(msg),
                to: msg.to,
                body: msg.body,
                pushName: (msg as any)._data?.notifyName,
                senderName: await this.resolveSenderName(msg),
                fromMe: msg.fromMe,
                timestamp: Math.min(msg.timestamp, Math.floor(Date.now() / 1000)),
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
            number: contact.number || client.info.wid.user,
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
