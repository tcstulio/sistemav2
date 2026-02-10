export interface EmailAccount {
    id: string;
    name: string;
    email: string;
    imapHost: string;
    imapPort: number;
    imapUser: string;
    imapTls: boolean;
    // Passwords are not returned by API
    smtpHost: string;
    smtpPort: number;
    smtpUser: string;
    smtpSecure: boolean;
    signature?: string;
}

export interface EmailMessage {
    id: number; // UID
    seq: string;
    from: {
        address: string;
        name: string;
    } | string;
    subject: string;
    date: string;
    flags: string[];
    messageId?: string;
    inReplyTo?: string;
    references?: string;
}

export interface EmailBody {
    subject: string;
    from: string;
    to: string;
    cc?: string;
    html: string | false;
    text: string | undefined;
    date: string;
    messageId?: string;
    inReplyTo?: string;
    references?: string;
    attachments: any[];
}

export interface EmailAttachment {
    filename: string;
    content: string; // Base64
    contentType?: string;
    encoding?: 'base64';
}

export interface EmailTemplate {
    id: string;
    name: string;
    subject: string;
    body: string;
    createdBy: string;
    createdAt: string;
    updatedAt: string;
}
