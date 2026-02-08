import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const PREFIX = 'enc:';

function getKey(): Buffer {
    const raw = process.env.ENCRYPTION_KEY;
    if (!raw) {
        throw new Error('ENCRYPTION_KEY not set in .env — required for credential encryption');
    }
    // Derive a 32-byte key from whatever string the user provides
    return crypto.createHash('sha256').update(raw).digest();
}

/**
 * Encrypt a plaintext string. Returns a prefixed string: "enc:<iv>:<authTag>:<ciphertext>"
 */
export function encrypt(plaintext: string): string {
    const key = getKey();
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');

    return `${PREFIX}${iv.toString('hex')}:${authTag}:${encrypted}`;
}

/**
 * Decrypt a string previously encrypted with encrypt().
 * If the string doesn't have the "enc:" prefix, returns it as-is (plain text migration).
 */
export function decrypt(value: string): string {
    if (!value.startsWith(PREFIX)) {
        return value; // plain text — not yet encrypted
    }

    const key = getKey();
    const parts = value.slice(PREFIX.length).split(':');
    if (parts.length !== 3) {
        throw new Error('Invalid encrypted value format');
    }

    const [ivHex, authTagHex, ciphertext] = parts;
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(ciphertext, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
}

/**
 * Check if a value is already encrypted (has the enc: prefix).
 */
export function isEncrypted(value: string): boolean {
    return value.startsWith(PREFIX);
}
