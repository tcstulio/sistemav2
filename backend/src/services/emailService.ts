import nodemailer from 'nodemailer';
import imaps from 'imap-simple';
import { simpleParser } from 'mailparser';
import sanitizeHtml from 'sanitize-html';
import { emailStoreService, EmailAccountConfig } from './emailStoreService';
import { logger } from '../utils/logger';

const log = logger.child('EmailService');

class EmailService {

    // --- SMTP (Sending) ---

    async sendEmail(accountId: string, to: string, subject: string, htmlBody: string, attachments: any[] = [], cc?: string, bcc?: string) {
        const account = emailStoreService.getAccount(accountId);
        if (!account) throw new Error('Account not found');

        const transporter = nodemailer.createTransport({
            host: account.smtpHost,
            port: account.smtpPort,
            secure: account.smtpSecure,
            auth: {
                user: account.smtpUser,
                pass: account.smtpPassword
            }
        });

        const info = await transporter.sendMail({
            from: `"${account.name}" <${account.email}>`,
            to,
            cc: cc || undefined,
            bcc: bcc || undefined,
            subject,
            html: htmlBody,
            attachments
        });

        return info;
    }

    // --- Connection Testing ---

    async testImapConnection(config: { imapHost: string; imapPort: number; imapUser: string; imapPassword: string; imapTls: boolean }): Promise<{ success: boolean; message: string }> {
        try {
            const connection = await imaps.connect({
                imap: {
                    user: config.imapUser,
                    password: config.imapPassword,
                    host: config.imapHost,
                    port: config.imapPort,
                    tls: config.imapTls,
                    authTimeout: 10000,
                    tlsOptions: { rejectUnauthorized: false }
                }
            });
            connection.end();
            return { success: true, message: 'IMAP conectado com sucesso' };
        } catch (error: any) {
            log.error('IMAP test failed', error.message);
            return { success: false, message: error.message || 'Falha na conexão IMAP' };
        }
    }

    async testSmtpConnection(config: { smtpHost: string; smtpPort: number; smtpUser: string; smtpPassword: string; smtpSecure: boolean }): Promise<{ success: boolean; message: string }> {
        try {
            const transporter = nodemailer.createTransport({
                host: config.smtpHost,
                port: config.smtpPort,
                secure: config.smtpSecure,
                auth: { user: config.smtpUser, pass: config.smtpPassword }
            });
            await transporter.verify();
            return { success: true, message: 'SMTP conectado com sucesso' };
        } catch (error: any) {
            log.error('SMTP test failed', error.message);
            return { success: false, message: error.message || 'Falha na conexão SMTP' };
        }
    }

    // --- IMAP (Receiving) ---

    private async getImapConnection(account: EmailAccountConfig) {
        const config = {
            imap: {
                user: account.imapUser,
                password: account.imapPassword,
                host: account.imapHost,
                port: account.imapPort,
                tls: account.imapTls,
                authTimeout: 10000,
                tlsOptions: { rejectUnauthorized: false }
            }
        };
        return await imaps.connect(config);
    }

    async getFolders(accountId: string) {
        const account = emailStoreService.getAccount(accountId);
        if (!account) throw new Error('Account not found');

        const connection = await this.getImapConnection(account);
        try {
            const boxes = await connection.getBoxes();
            return boxes;
        } finally {
            connection.end();
        }
    }

    async getMessages(accountId: string, folder: string = 'INBOX', limit: number = 20) {
        const account = emailStoreService.getAccount(accountId);
        if (!account) throw new Error('Account not found');

        const connection = await this.getImapConnection(account);
        try {
            await connection.openBox(folder);

            const searchCriteria = ['ALL'];
            const fetchOptions = {
                bodies: ['HEADER.FIELDS (DATE)'],
                markSeen: false,
                struct: false
            };

            const messages = await connection.search(searchCriteria, fetchOptions);

            if (messages.length === 0) return [];

            messages.sort((a, b) => {
                const dateA = a.attributes.date ? new Date(a.attributes.date).getTime() : 0;
                const dateB = b.attributes.date ? new Date(b.attributes.date).getTime() : 0;
                return dateB - dateA;
            });

            const recentMessages = messages.slice(0, limit);
            if (recentMessages.length === 0) return [];

            const uids = recentMessages.map(m => m.attributes.uid);

            const searchCriteriaUIDs = [['UID', ...uids]];
            const fetchOptionsDetails = {
                bodies: ['HEADER'],
                markSeen: false,
                struct: true
            };

            const detailedMessages = await connection.search(searchCriteriaUIDs, fetchOptionsDetails);

            detailedMessages.sort((a, b) => {
                const dateA = a.attributes.date ? new Date(a.attributes.date).getTime() : 0;
                const dateB = b.attributes.date ? new Date(b.attributes.date).getTime() : 0;
                return dateB - dateA;
            });

            const serialized = detailedMessages.map(msg => {
                const headerPart = msg.parts.find(p => p.which === 'HEADER');
                const header: any = headerPart ? headerPart.body : {};

                return {
                    id: msg.attributes.uid,
                    seq: (msg as any).seq,
                    from: header.from ? (header.from[0] as any) : 'Unknown',
                    subject: header.subject ? (header.subject[0] as string) : '(No Subject)',
                    date: msg.attributes.date,
                    flags: msg.attributes.flags,
                    messageId: header['message-id'] ? header['message-id'][0] : undefined,
                    inReplyTo: header['in-reply-to'] ? header['in-reply-to'][0] : undefined,
                    references: header.references ? header.references[0] : undefined
                };
            });

            return serialized;

        } finally {
            connection.end();
        }
    }

    async getMessageBody(accountId: string, folder: string, uid: number) {
        const account = emailStoreService.getAccount(accountId);
        if (!account) throw new Error('Account not found');

        const connection = await this.getImapConnection(account);
        try {
            await connection.openBox(folder);
            const searchCriteria = [['UID', uid]];
            const fetchOptions = { bodies: [''], markSeen: true };
            const messages = await connection.search(searchCriteria, fetchOptions);

            if (messages.length === 0) throw new Error('Message not found');

            const fullBody = messages[0].parts[0].body;
            const parsed = await simpleParser(fullBody);

            const cleanHtml = parsed.html ? sanitizeHtml(parsed.html, {
                allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img', 'style']),
                allowedAttributes: { ...sanitizeHtml.defaults.allowedAttributes, '*': ['style', 'class'], 'img': ['src'] },
                allowedSchemes: ['http', 'https', 'data', 'mailto']
            }) : false;

            const attachments = parsed.attachments ? parsed.attachments.map(att => ({
                filename: att.filename,
                contentType: att.contentType,
                size: att.size,
                content: att.content ? att.content.toString('base64') : null,
                checksum: att.checksum
            })) : [];

            const getAddressText = (addr: any): string => {
                if (!addr) return '';
                if (Array.isArray(addr)) return getAddressText(addr[0]);
                if (addr.text) return addr.text;
                if (addr.value && Array.isArray(addr.value) && addr.value.length > 0) return addr.value[0].address;
                return '';
            };

            return {
                subject: parsed.subject,
                from: getAddressText(parsed.from),
                to: getAddressText(parsed.to),
                cc: getAddressText(parsed.cc),
                html: cleanHtml,
                text: parsed.text,
                date: parsed.date,
                messageId: parsed.messageId,
                inReplyTo: parsed.inReplyTo,
                references: parsed.references ? (Array.isArray(parsed.references) ? parsed.references.join(' ') : parsed.references) : undefined,
                attachments
            };
        } finally {
            connection.end();
        }
    }

    // --- Unread Count ---

    async getUnreadCount(accountId: string, folder: string = 'INBOX'): Promise<number> {
        const account = emailStoreService.getAccount(accountId);
        if (!account) throw new Error('Account not found');

        const connection = await this.getImapConnection(account);
        try {
            await connection.openBox(folder);
            const messages = await connection.search(['UNSEEN'], { bodies: [], markSeen: false });
            return messages.length;
        } finally {
            connection.end();
        }
    }

    // --- Search ---

    async searchMessages(accountId: string, folder: string = 'INBOX', query: string, searchIn: string = 'all', limit: number = 50) {
        const account = emailStoreService.getAccount(accountId);
        if (!account) throw new Error('Account not found');

        const connection = await this.getImapConnection(account);
        try {
            await connection.openBox(folder);

            let searchCriteria: any[];
            switch (searchIn) {
                case 'subject': searchCriteria = [['SUBJECT', query]]; break;
                case 'from': searchCriteria = [['FROM', query]]; break;
                case 'body': searchCriteria = [['BODY', query]]; break;
                default: searchCriteria = [['TEXT', query]]; break;
            }

            const fetchOptions = { bodies: ['HEADER'], markSeen: false, struct: true };
            const messages = await connection.search(searchCriteria, fetchOptions);

            messages.sort((a, b) => {
                const dateA = a.attributes.date ? new Date(a.attributes.date).getTime() : 0;
                const dateB = b.attributes.date ? new Date(b.attributes.date).getTime() : 0;
                return dateB - dateA;
            });

            return messages.slice(0, limit).map(msg => {
                const headerPart = msg.parts.find(p => p.which === 'HEADER');
                const header: any = headerPart ? headerPart.body : {};
                return {
                    id: msg.attributes.uid,
                    seq: (msg as any).seq,
                    from: header.from ? header.from[0] : 'Unknown',
                    subject: header.subject ? header.subject[0] : '(No Subject)',
                    date: msg.attributes.date,
                    flags: msg.attributes.flags,
                    messageId: header['message-id'] ? header['message-id'][0] : undefined,
                    inReplyTo: header['in-reply-to'] ? header['in-reply-to'][0] : undefined,
                    references: header.references ? header.references[0] : undefined
                };
            });
        } finally {
            connection.end();
        }
    }

    // --- Flag Management ---

    async addFlags(accountId: string, folder: string, uids: number[], flags: string[]): Promise<void> {
        const account = emailStoreService.getAccount(accountId);
        if (!account) throw new Error('Account not found');

        const connection = await this.getImapConnection(account);
        try {
            await connection.openBox(folder);
            await connection.addFlags(uids, flags);
        } finally {
            connection.end();
        }
    }

    async delFlags(accountId: string, folder: string, uids: number[], flags: string[]): Promise<void> {
        const account = emailStoreService.getAccount(accountId);
        if (!account) throw new Error('Account not found');

        const connection = await this.getImapConnection(account);
        try {
            await connection.openBox(folder);
            await connection.delFlags(uids, flags);
        } finally {
            connection.end();
        }
    }

    async deleteMessages(accountId: string, folder: string, uids: number[]): Promise<void> {
        const account = emailStoreService.getAccount(accountId);
        if (!account) throw new Error('Account not found');

        const connection = await this.getImapConnection(account);
        try {
            await connection.openBox(folder);
            await connection.addFlags(uids, ['\\Deleted']);
            await (connection as any).closeBox(true); // expunge
        } finally {
            try { connection.end(); } catch {}
        }
    }

    // --- Move Messages ---

    async moveMessages(accountId: string, sourceFolder: string, uids: number[], destinationFolder: string): Promise<void> {
        const account = emailStoreService.getAccount(accountId);
        if (!account) throw new Error('Account not found');

        const connection = await this.getImapConnection(account);
        try {
            await connection.openBox(sourceFolder);
            await connection.moveMessage(uids.map(String), destinationFolder);
        } finally {
            connection.end();
        }
    }
}

export const emailService = new EmailService();
