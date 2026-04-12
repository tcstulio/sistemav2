import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('nodemailer', () => ({
    default: {
        createTransport: vi.fn(),
    },
}));

vi.mock('imap-simple', () => ({
    default: {
        connect: vi.fn(),
    },
}));

vi.mock('mailparser', () => ({
    simpleParser: vi.fn(),
}));

vi.mock('sanitize-html', () => {
    const fn = (html: string) => html;
    fn.defaults = {
        allowedTags: ['p', 'b', 'i', 'em', 'strong', 'a', 'ul', 'ol', 'li', 'br', 'div', 'span', 'h1', 'h2', 'h3', 'table', 'tr', 'td', 'th', 'img', 'style'],
        allowedAttributes: { '*': ['style', 'class'], 'a': ['href'], 'img': ['src'] },
    };
    return { default: fn };
});

vi.mock('../../services/emailStoreService', () => ({
    emailStoreService: {
        getAccount: vi.fn(),
    },
    EmailAccountConfig: undefined,
}));

import nodemailer from 'nodemailer';
import imaps from 'imap-simple';
import { simpleParser } from 'mailparser';
import { emailStoreService } from '../../services/emailStoreService';
import { emailService } from '../../services/emailService';

describe('EmailService', () => {
    const mockAccount = {
        id: 'acc1',
        name: 'Test',
        email: 'test@test.com',
        smtpHost: 'smtp.test.com',
        smtpPort: 587,
        smtpSecure: false,
        smtpUser: 'user',
        smtpPassword: 'pass',
        imapHost: 'imap.test.com',
        imapPort: 993,
        imapUser: 'user',
        imapPassword: 'pass',
        imapTls: true,
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('sendEmail', () => {
        it('throws when account not found', async () => {
            (emailStoreService.getAccount as any).mockReturnValue(undefined);
            await expect(emailService.sendEmail('x', 'to@test.com', 'Sub', '<p>Body</p>')).rejects.toThrow('Account not found');
        });

        it('sends email successfully', async () => {
            (emailStoreService.getAccount as any).mockReturnValue(mockAccount as any);
            const mockSendMail = vi.fn().mockResolvedValue({ messageId: 'msg1' });
            (nodemailer.createTransport as any).mockReturnValue({ sendMail: mockSendMail } as any);

            const result = await emailService.sendEmail('acc1', 'to@test.com', 'Subject', '<p>Body</p>', [], 'cc@test.com', 'bcc@test.com');

            expect(result.messageId).toBe('msg1');
            expect(mockSendMail).toHaveBeenCalledWith(expect.objectContaining({
                from: expect.stringContaining('test@test.com'),
                to: 'to@test.com',
                cc: 'cc@test.com',
                bcc: 'bcc@test.com',
                subject: 'Subject',
                html: '<p>Body</p>',
            }));
        });

        it('sends without cc/bcc', async () => {
            (emailStoreService.getAccount as any).mockReturnValue(mockAccount as any);
            const mockSendMail = vi.fn().mockResolvedValue({ messageId: 'msg1' });
            (nodemailer.createTransport as any).mockReturnValue({ sendMail: mockSendMail } as any);

            await emailService.sendEmail('acc1', 'to@test.com', 'Sub', '<p>Body</p>');
            expect(mockSendMail).toHaveBeenCalledWith(expect.objectContaining({
                cc: undefined,
                bcc: undefined,
            }));
        });
    });

    describe('testImapConnection', () => {
        it('returns success on valid connection', async () => {
            const mockConn = { end: vi.fn() };
            (imaps.connect as any).mockResolvedValue(mockConn as any);

            const result = await emailService.testImapConnection({
                imapHost: 'imap.test.com', imapPort: 993, imapUser: 'u', imapPassword: 'p', imapTls: true,
            });

            expect(result.success).toBe(true);
            expect(mockConn.end).toHaveBeenCalled();
        });

        it('returns failure on connection error', async () => {
            (imaps.connect as any).mockRejectedValue(new Error('Connection refused'));

            const result = await emailService.testImapConnection({
                imapHost: 'bad', imapPort: 993, imapUser: 'u', imapPassword: 'p', imapTls: true,
            });

            expect(result.success).toBe(false);
        });
    });

    describe('testSmtpConnection', () => {
        it('returns success on valid connection', async () => {
            const mockVerify = vi.fn().mockResolvedValue(true);
            (nodemailer.createTransport as any).mockReturnValue({ verify: mockVerify } as any);

            const result = await emailService.testSmtpConnection({
                smtpHost: 'smtp.test.com', smtpPort: 587, smtpUser: 'u', smtpPassword: 'p', smtpSecure: false,
            });

            expect(result.success).toBe(true);
        });

        it('returns failure on error', async () => {
            const mockVerify = vi.fn().mockRejectedValue(new Error('SMTP failed'));
            (nodemailer.createTransport as any).mockReturnValue({ verify: mockVerify } as any);

            const result = await emailService.testSmtpConnection({
                smtpHost: 'bad', smtpPort: 587, smtpUser: 'u', smtpPassword: 'p', smtpSecure: false,
            });

            expect(result.success).toBe(false);
        });
    });

    describe('getFolders', () => {
        it('throws when account not found', async () => {
            (emailStoreService.getAccount as any).mockReturnValue(undefined);
            await expect(emailService.getFolders('x')).rejects.toThrow('Account not found');
        });

        it('returns folders', async () => {
            (emailStoreService.getAccount as any).mockReturnValue(mockAccount as any);
            const mockConn = { getBoxes: vi.fn().mockResolvedValue({ INBOX: {} }), end: vi.fn() };
            (imaps.connect as any).mockResolvedValue(mockConn as any);

            const result = await emailService.getFolders('acc1');
            expect(result).toEqual({ INBOX: {} });
            expect(mockConn.end).toHaveBeenCalled();
        });
    });

    describe('getMessages', () => {
        it('returns empty array for no messages', async () => {
            (emailStoreService.getAccount as any).mockReturnValue(mockAccount as any);
            const mockConn = {
                openBox: vi.fn(),
                search: vi.fn().mockResolvedValue([]),
                end: vi.fn(),
            };
            (imaps.connect as any).mockResolvedValue(mockConn as any);

            const result = await emailService.getMessages('acc1');
            expect(result).toEqual([]);
        });

        it('returns messages with details', async () => {
            (emailStoreService.getAccount as any).mockReturnValue(mockAccount as any);
            const mockConn = {
                openBox: vi.fn(),
                search: vi.fn()
                    .mockResolvedValueOnce([{ attributes: { date: new Date(), uid: 1 } }])
                    .mockResolvedValueOnce([{
                        attributes: { date: new Date(), uid: 1, flags: ['\\Seen'] },
                        parts: [{ which: 'HEADER', body: { from: ['sender@test.com'], subject: ['Test Subject'], 'message-id': ['mid1'] } }],
                        seq: 1,
                    }]),
                end: vi.fn(),
            };
            (imaps.connect as any).mockResolvedValue(mockConn as any);

            const result = await emailService.getMessages('acc1', 'INBOX', 10);
            expect(result).toHaveLength(1);
            expect(result[0].subject).toBe('Test Subject');
        });
    });

    describe('getMessageBody', () => {
        it('throws when message not found', async () => {
            (emailStoreService.getAccount as any).mockReturnValue(mockAccount as any);
            const mockConn = {
                openBox: vi.fn(),
                search: vi.fn().mockResolvedValue([]),
                end: vi.fn(),
            };
            (imaps.connect as any).mockResolvedValue(mockConn as any);

            await expect(emailService.getMessageBody('acc1', 'INBOX', 999)).rejects.toThrow('Message not found');
        });

        it('returns parsed message body', async () => {
            (emailStoreService.getAccount as any).mockReturnValue(mockAccount as any);
            const mockConn = {
                openBox: vi.fn(),
                search: vi.fn().mockResolvedValue([{
                    parts: [{ body: 'raw-email-content' }],
                    attributes: {},
                }]),
                end: vi.fn(),
            };
            (imaps.connect as any).mockResolvedValue(mockConn as any);
            (simpleParser as any).mockResolvedValue({
                subject: 'Test',
                from: { text: 'Sender <s@test.com>', value: [{ address: 's@test.com' }] },
                to: { text: 'R <r@test.com>', value: [{ address: 'r@test.com' }] },
                cc: null,
                html: '<p>Body</p>',
                text: 'Body',
                date: new Date(),
                messageId: 'mid1',
                inReplyTo: null,
                references: null,
                attachments: [],
            } as any);

            const result = await emailService.getMessageBody('acc1', 'INBOX', 1);
            expect(result.subject).toBe('Test');
            expect(result.from).toBe('Sender <s@test.com>');
            expect(result.html).toBe('<p>Body</p>');
            expect(result.attachments).toEqual([]);
        });

        it('handles message with array references', async () => {
            (emailStoreService.getAccount as any).mockReturnValue(mockAccount as any);
            const mockConn = {
                openBox: vi.fn(),
                search: vi.fn().mockResolvedValue([{ parts: [{ body: 'raw' }], attributes: {} }]),
                end: vi.fn(),
            };
            (imaps.connect as any).mockResolvedValue(mockConn as any);
            (simpleParser as any).mockResolvedValue({
                subject: 'Ref',
                from: { text: 'S', value: [{ address: 's@t.com' }] },
                to: null,
                cc: null,
                html: false,
                text: 'text',
                date: new Date(),
                messageId: 'm1',
                inReplyTo: null,
                references: ['ref1', 'ref2'],
                attachments: [{
                    filename: 'file.pdf',
                    contentType: 'application/pdf',
                    size: 100,
                    content: Buffer.from('pdf-data'),
                    checksum: 'abc',
                }],
            } as any);

            const result = await emailService.getMessageBody('acc1', 'INBOX', 1);
            expect(result.references).toBe('ref1 ref2');
            expect(result.attachments).toHaveLength(1);
            expect(result.attachments[0].content).toBe(Buffer.from('pdf-data').toString('base64'));
        });
    });

    describe('getUnreadCount', () => {
        it('returns unread count', async () => {
            (emailStoreService.getAccount as any).mockReturnValue(mockAccount as any);
            const mockConn = {
                openBox: vi.fn(),
                search: vi.fn().mockResolvedValue([{}, {}, {}]),
                end: vi.fn(),
            };
            (imaps.connect as any).mockResolvedValue(mockConn as any);

            const result = await emailService.getUnreadCount('acc1');
            expect(result).toBe(3);
        });
    });

    describe('searchMessages', () => {
        it('searches by subject', async () => {
            (emailStoreService.getAccount as any).mockReturnValue(mockAccount as any);
            const mockConn = {
                openBox: vi.fn(),
                search: vi.fn().mockResolvedValue([{
                    attributes: { date: new Date(), uid: 1, flags: [] },
                    parts: [{ which: 'HEADER', body: { from: ['s@t.com'], subject: ['Found'] } }],
                    seq: 1,
                }]),
                end: vi.fn(),
            };
            (imaps.connect as any).mockResolvedValue(mockConn as any);

            const result = await emailService.searchMessages('acc1', 'INBOX', 'test', 'subject');
            expect(result).toHaveLength(1);
        });

        it('searches by default (all text)', async () => {
            (emailStoreService.getAccount as any).mockReturnValue(mockAccount as any);
            const mockConn = {
                openBox: vi.fn(),
                search: vi.fn().mockResolvedValue([]),
                end: vi.fn(),
            };
            (imaps.connect as any).mockResolvedValue(mockConn as any);

            const result = await emailService.searchMessages('acc1', 'INBOX', 'test', 'all');
            expect(mockConn.search).toHaveBeenCalledWith([['TEXT', 'test']], expect.any(Object));
        });

        it('searches by from', async () => {
            (emailStoreService.getAccount as any).mockReturnValue(mockAccount as any);
            const mockConn = {
                openBox: vi.fn(),
                search: vi.fn().mockResolvedValue([]),
                end: vi.fn(),
            };
            (imaps.connect as any).mockResolvedValue(mockConn as any);

            await emailService.searchMessages('acc1', 'INBOX', 'test@test.com', 'from');
            expect(mockConn.search).toHaveBeenCalledWith([['FROM', 'test@test.com']], expect.any(Object));
        });

        it('searches by body', async () => {
            (emailStoreService.getAccount as any).mockReturnValue(mockAccount as any);
            const mockConn = {
                openBox: vi.fn(),
                search: vi.fn().mockResolvedValue([]),
                end: vi.fn(),
            };
            (imaps.connect as any).mockResolvedValue(mockConn as any);

            await emailService.searchMessages('acc1', 'INBOX', 'content', 'body');
            expect(mockConn.search).toHaveBeenCalledWith([['BODY', 'content']], expect.any(Object));
        });
    });

    describe('addFlags', () => {
        it('adds flags to messages', async () => {
            (emailStoreService.getAccount as any).mockReturnValue(mockAccount as any);
            const mockConn = {
                openBox: vi.fn(),
                addFlags: vi.fn(),
                end: vi.fn(),
            };
            (imaps.connect as any).mockResolvedValue(mockConn as any);

            await emailService.addFlags('acc1', 'INBOX', [1, 2], ['\\Flagged']);
            expect(mockConn.addFlags).toHaveBeenCalledWith([1, 2], ['\\Flagged']);
        });
    });

    describe('delFlags', () => {
        it('deletes flags from messages', async () => {
            (emailStoreService.getAccount as any).mockReturnValue(mockAccount as any);
            const mockConn = {
                openBox: vi.fn(),
                delFlags: vi.fn(),
                end: vi.fn(),
            };
            (imaps.connect as any).mockResolvedValue(mockConn as any);

            await emailService.delFlags('acc1', 'INBOX', [1], ['\\Flagged']);
            expect(mockConn.delFlags).toHaveBeenCalledWith([1], ['\\Flagged']);
        });
    });

    describe('deleteMessages', () => {
        it('deletes and expunges messages', async () => {
            (emailStoreService.getAccount as any).mockReturnValue(mockAccount as any);
            const mockConn = {
                openBox: vi.fn(),
                addFlags: vi.fn(),
                closeBox: vi.fn(),
                end: vi.fn(),
            };
            (imaps.connect as any).mockResolvedValue(mockConn as any);

            await emailService.deleteMessages('acc1', 'INBOX', [1, 2]);
            expect(mockConn.addFlags).toHaveBeenCalledWith([1, 2], ['\\Deleted']);
            expect(mockConn.closeBox).toHaveBeenCalledWith(true);
        });

        it('handles end error gracefully', async () => {
            (emailStoreService.getAccount as any).mockReturnValue(mockAccount as any);
            const mockConn = {
                openBox: vi.fn(),
                addFlags: vi.fn(),
                closeBox: vi.fn(),
                end: vi.fn().mockImplementation(() => { throw new Error('already closed'); }),
            };
            (imaps.connect as any).mockResolvedValue(mockConn as any);

            await expect(emailService.deleteMessages('acc1', 'INBOX', [1])).resolves.toBeUndefined();
        });
    });

    describe('moveMessages', () => {
        it('moves messages to destination folder', async () => {
            (emailStoreService.getAccount as any).mockReturnValue(mockAccount as any);
            const mockConn = {
                openBox: vi.fn(),
                moveMessage: vi.fn(),
                end: vi.fn(),
            };
            (imaps.connect as any).mockResolvedValue(mockConn as any);

            await emailService.moveMessages('acc1', 'INBOX', [1, 2], 'Archive');
            expect(mockConn.moveMessage).toHaveBeenCalledWith(['1', '2'], 'Archive');
        });
    });
});
