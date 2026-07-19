/**
 * #1578 — Preferências de notificação por usuário (opt-out).
 *
 * Persistência simples em JSON (data/user_notify_prefs.json) — mesmo padrão
 * dos outros stores do backend (notificationService, chatSessionService, etc).
 *
 * O agentCompletionNotifier consulta este store ANTES de disparar o
 * notify_person no fim de um job. Se o usuário marcou optedOut=true, a
 * notificação é silenciada (critério de aceite #1578: "Notificação respeita
 * opt-out do usuário").
 *
 * Default: NENHUM usuário é opt-out (opt-in reverso — todo mundo recebe a
 * notificação de "Pronto" se a aba estiver oculta; quem não quer, desliga).
 */

import * as fs from 'fs';
import * as path from 'path';
import { atomicWriteSync } from '../utils/atomicWrite';
import { createLogger } from '../utils/logger';

const log = createLogger('UserNotifyPrefs');

export interface UserNotifyPrefs {
    optedOut: boolean;
}

interface Store {
    prefs: Record<string, UserNotifyPrefs>;
}

const STORE_PATH = path.join(__dirname, '../../data/user_notify_prefs.json');

class UserNotifyPrefsStore {
    private data: Store;

    constructor() {
        this.data = { prefs: {} };
        this.load();
    }

    private load(): void {
        try {
            const dir = path.dirname(STORE_PATH);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            if (fs.existsSync(STORE_PATH)) {
                const content = fs.readFileSync(STORE_PATH, 'utf-8');
                const parsed = JSON.parse(content);
                this.data = { prefs: parsed.prefs || {} };
                log.info(`Loaded notify prefs for ${Object.keys(this.data.prefs).length} users`);
            }
        } catch (e) {
            log.error('Load error', e);
        }
    }

    private save(): void {
        try {
            const dir = path.dirname(STORE_PATH);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            atomicWriteSync(STORE_PATH, this.data);
        } catch (e) {
            log.error('Save error', e);
        }
    }

    /** Preferências do usuário. Default { optedOut: false } se não configurado. */
    get(userId: string): UserNotifyPrefs {
        if (!userId) return { optedOut: false };
        return this.data.prefs[userId] ?? { optedOut: false };
    }

    /** Shortcut: o usuário está em opt-out? */
    isOptedOut(userId: string): boolean {
        return this.get(userId).optedOut === true;
    }

    /** Define o opt-out do usuário. Retorna o estado gravado. */
    setOptOut(userId: string, optedOut: boolean): UserNotifyPrefs {
        if (!userId) {
            log.warn('setOptOut chamado com userId vazio — ignorado.');
            return { optedOut: false };
        }
        const next: UserNotifyPrefs = { ...this.get(userId), optedOut };
        this.data.prefs[userId] = next;
        this.save();
        log.info(`Notify prefs updated for user ${userId}: optedOut=${optedOut}`);
        return next;
    }
}

export const userNotifyPrefsStore = new UserNotifyPrefsStore();
