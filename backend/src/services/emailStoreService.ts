import fs from 'fs';
import path from 'path';
import { atomicWriteSync } from '../utils/atomicWrite';
import { encrypt, decrypt, isEncrypted } from '../utils/crypto';
import { logger } from '../utils/logger';

const log = logger.child('EmailStoreService');

const DATA_DIR = path.join(__dirname, '../../data');
const STORE_FILE = path.join(DATA_DIR, 'email_accounts.json');

const METADATA_FILE = path.join(DATA_DIR, 'email_metadata.json');

if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

export interface EmailAccountConfig {
    id: string;
    name: string; // Friendly name
    email: string;

    // IMAP
    imapHost: string;
    imapPort: number;
    imapUser: string;
    imapPassword: string;
    imapTls: boolean;

    // SMTP
    smtpHost: string;
    smtpPort: number;
    smtpUser: string;
    smtpPassword: string;
    smtpSecure: boolean;

    signature?: string;
}

interface EmailMetadata {
    assignments: Record<string, string>; // threadId -> userId
    threadSettings: Record<string, any>; // threadId -> settings
    userSettings: Record<string, { signature?: string }>; // userId -> settings
}

class EmailStoreService {
    private accounts: EmailAccountConfig[] = [];
    private metadata: EmailMetadata = { assignments: {}, threadSettings: {}, userSettings: {} };

    constructor() {
        this.load();
    }

    private load() {
        if (fs.existsSync(STORE_FILE)) {
            try {
                const data = fs.readFileSync(STORE_FILE, 'utf-8');
                this.accounts = JSON.parse(data);
                this.migratePasswords();
            } catch (e) {
                log.error('Failed to load email accounts', e);
                this.accounts = [];
            }
        }

        // Load Metadata
        if (fs.existsSync(METADATA_FILE)) {
            try {
                const data = fs.readFileSync(METADATA_FILE, 'utf-8');
                this.metadata = JSON.parse(data);
            } catch (e) {
                log.error('Failed to load email metadata', e);
                this.metadata = { assignments: {}, threadSettings: {}, userSettings: {} };
            }
        }
    }

    /** Encrypt any plain-text passwords found on first load */
    private migratePasswords() {
        let migrated = false;
        for (const acc of this.accounts) {
            if (acc.imapPassword && !isEncrypted(acc.imapPassword)) {
                acc.imapPassword = encrypt(acc.imapPassword);
                migrated = true;
            }
            if (acc.smtpPassword && !isEncrypted(acc.smtpPassword)) {
                acc.smtpPassword = encrypt(acc.smtpPassword);
                migrated = true;
            }
        }
        if (migrated) {
            atomicWriteSync(STORE_FILE, this.accounts);
            log.info(`Migrated ${this.accounts.length} account(s) — passwords now encrypted`);
        }
    }

    /** Return account with passwords decrypted (for internal/service use) */
    private decryptAccount(acc: EmailAccountConfig): EmailAccountConfig {
        return {
            ...acc,
            imapPassword: acc.imapPassword ? decrypt(acc.imapPassword) : '',
            smtpPassword: acc.smtpPassword ? decrypt(acc.smtpPassword) : '',
        };
    }

    /** Encrypt password fields before persisting */
    private encryptPasswords(acc: EmailAccountConfig): EmailAccountConfig {
        return {
            ...acc,
            imapPassword: acc.imapPassword && !isEncrypted(acc.imapPassword)
                ? encrypt(acc.imapPassword)
                : acc.imapPassword,
            smtpPassword: acc.smtpPassword && !isEncrypted(acc.smtpPassword)
                ? encrypt(acc.smtpPassword)
                : acc.smtpPassword,
        };
    }

    private save() {
        atomicWriteSync(STORE_FILE, this.accounts);
        this.saveMetadata();
    }

    private saveMetadata() {
        atomicWriteSync(METADATA_FILE, this.metadata);
    }

    /** Returns all accounts with passwords decrypted (for service use like IMAP/SMTP connections) */
    getAllAccounts(): EmailAccountConfig[] {
        return this.accounts.map(a => this.decryptAccount(a));
    }

    /** Returns a single account with passwords decrypted */
    getAccount(id: string): EmailAccountConfig | undefined {
        const acc = this.accounts.find(a => a.id === id);
        return acc ? this.decryptAccount(acc) : undefined;
    }

    addAccount(config: EmailAccountConfig): string {
        const id = config.id || `acc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const accountWithId = this.encryptPasswords({ ...config, id });

        // Check for duplicate ID
        if (this.accounts.find(a => a.id === id)) {
            throw new Error('Account ID already exists');
        }

        this.accounts.push(accountWithId);
        this.save();
        return id;
    }

    updateAccount(id: string, updates: Partial<EmailAccountConfig>) {
        const index = this.accounts.findIndex(a => a.id === id);
        if (index === -1) throw new Error('Account not found');

        // Encrypt any new passwords coming in
        const encrypted = this.encryptPasswords({ ...this.accounts[index], ...updates });
        this.accounts[index] = encrypted;
        this.save();
    }

    deleteAccount(id: string) {
        this.accounts = this.accounts.filter(a => a.id !== id);
        this.save();
    }

    // --- Metadata Methods ---

    assignThread(threadId: string, userId: string | null) {
        if (userId) {
            this.metadata.assignments[threadId] = userId;
        } else {
            delete this.metadata.assignments[threadId];
        }
        this.saveMetadata();
    }

    getAssignment(threadId: string): string | undefined {
        return this.metadata.assignments[threadId];
    }

    updateThreadSettings(threadId: string, settings: any) {
        this.metadata.threadSettings[threadId] = {
            ...(this.metadata.threadSettings[threadId] || {}),
            ...settings
        };
        this.saveMetadata();
    }

    getThreadSettings(threadId: string): any {
        return this.metadata.threadSettings[threadId] || {};
    }

    updateUserSettings(userId: string, settings: { signature?: string }) {
        this.metadata.userSettings[userId] = {
            ...(this.metadata.userSettings[userId] || {}),
            ...settings
        };
        this.saveMetadata();
    }

    getUserSettings(userId: string): { signature?: string } {
        return this.metadata.userSettings[userId] || {};
    }
}

export const emailStoreService = new EmailStoreService();
