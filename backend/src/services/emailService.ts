import nodemailer from 'nodemailer';
import imaps from 'imap-simple';
import { simpleParser, ParsedMail } from 'mailparser';
import sanitizeHtml from 'sanitize-html';
import { emailStoreService, EmailAccountConfig } from './emailStoreService';

class EmailService {

    // --- SMTP (Sending) ---

    async sendEmail(accountId: string, to: string, subject: string, htmlBody: string, attachments: any[] = []) {
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
            subject,
            html: htmlBody,
            attachments
        });

        return info;
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
                tlsOptions: { rejectUnauthorized: false } // Fix for self-signed or mismatched certs
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

            // 1. Fetch UIDs and Date only first to sort and slice
            const searchCriteria = ['ALL'];
            const fetchOptions = {
                bodies: ['HEADER.FIELDS (DATE)'], // Minimal fetch
                markSeen: false,
                struct: false
            };

            const messages = await connection.search(searchCriteria, fetchOptions);

            if (messages.length === 0) return [];

            // 2. Sort by date desc
            messages.sort((a, b) => {
                const dateA = a.attributes.date ? new Date(a.attributes.date).getTime() : 0;
                const dateB = b.attributes.date ? new Date(b.attributes.date).getTime() : 0;
                return dateB - dateA;
            });

            // 3. Slice to limit
            const recentMessages = messages.slice(0, limit);

            if (recentMessages.length === 0) return [];

            // 4. Fetch details for these specific UIDs
            // We need to fetch 'HEADER' to get Subject, From, etc.
            // avoiding 'TEXT' to prevent full body download
            const uids = recentMessages.map(m => m.attributes.uid);

            // imap-simple search doesn't support searching by specific UIDs list easily in one go with `search` 
            // but we can use `fetch` if we had the lower level client access, but imap-simple wraps it.
            // A workaround with imap-simple is to search for these UIDs.
            // SEARCH UID <uid1>,<uid2>,...

            const searchCriteriaUIDs = [['UID', ...uids]];
            const fetchOptionsDetails = {
                bodies: ['HEADER'],
                markSeen: false,
                struct: true
            };

            const detailedMessages = await connection.search(searchCriteriaUIDs, fetchOptionsDetails);

            // Sort again because the second search might return in any order
            detailedMessages.sort((a, b) => {
                const dateA = a.attributes.date ? new Date(a.attributes.date).getTime() : 0;
                const dateB = b.attributes.date ? new Date(b.attributes.date).getTime() : 0;
                return dateB - dateA;
            });

            const serialized = detailedMessages.map(msg => {
                const headerPart = msg.parts.find(p => p.which === 'HEADER');
                const header = headerPart ? headerPart.body : {};

                return {
                    id: msg.attributes.uid,
                    seq: (msg as any).seq,
                    from: header.from ? (header.from[0] as any) : 'Unknown',
                    subject: header.subject ? (header.subject[0] as string) : '(No Subject)',
                    date: msg.attributes.date,
                    flags: msg.attributes.flags
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
            // Fetch full body source
            const searchCriteria = [['UID', uid]];
            const fetchOptions = { bodies: [''], markSeen: true }; // [''] fetches entire message
            const messages = await connection.search(searchCriteria, fetchOptions);

            if (messages.length === 0) throw new Error('Message not found');

            const fullBody = messages[0].parts[0].body;
            const parsed = await simpleParser(fullBody);

            // Sanitization
            const cleanHtml = parsed.html ? sanitizeHtml(parsed.html, {
                allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img', 'style']),
                allowedAttributes: { ...sanitizeHtml.defaults.allowedAttributes, '*': ['style', 'class'], 'img': ['src'] },
                allowedSchemes: ['http', 'https', 'data', 'mailto']
            }) : false;

            // Attachments to Base64
            const attachments = parsed.attachments ? parsed.attachments.map(att => ({
                filename: att.filename,
                contentType: att.contentType,
                size: att.size,
                content: att.content ? att.content.toString('base64') : null,
                checksum: att.checksum
            })) : [];

            // Helper to extract email text safely
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
                html: cleanHtml,
                text: parsed.text,
                date: parsed.date,
                attachments: attachments
            };
        } finally {
            connection.end();
        }
    }
}

export const emailService = new EmailService();
