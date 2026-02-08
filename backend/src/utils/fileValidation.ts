/**
 * File Upload Validation Utilities
 *
 * Validates file uploads by checking:
 * - MIME types (actual content, not just extension)
 * - File size limits
 * - Filename sanitization
 */

import { Request } from 'express';
import multer from 'multer';
import path from 'path';

// Magic bytes for common file types
const FILE_SIGNATURES: Record<string, Buffer[]> = {
    // Images
    'image/jpeg': [Buffer.from([0xFF, 0xD8, 0xFF])],
    'image/png': [Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])],
    'image/gif': [Buffer.from([0x47, 0x49, 0x46, 0x38])],
    'image/webp': [Buffer.from([0x52, 0x49, 0x46, 0x46])], // RIFF header

    // Documents
    'application/pdf': [Buffer.from([0x25, 0x50, 0x44, 0x46])], // %PDF
    'application/zip': [Buffer.from([0x50, 0x4B, 0x03, 0x04])], // PK

    // Office documents (all start with PK as they're ZIP-based)
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': [Buffer.from([0x50, 0x4B, 0x03, 0x04])],
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': [Buffer.from([0x50, 0x4B, 0x03, 0x04])],

    // Text/CSV (no magic bytes, check extension)
    'text/csv': [],
    'text/plain': [],

    // Certificates
    'application/x-x509-ca-cert': [Buffer.from('-----BEGIN')],
    'application/x-pkcs12': [Buffer.from([0x30, 0x82])], // DER format
};

// Allowed extensions per category
const ALLOWED_EXTENSIONS: Record<string, string[]> = {
    images: ['.jpg', '.jpeg', '.png', '.gif', '.webp'],
    documents: ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.csv', '.txt'],
    certificates: ['.pem', '.crt', '.cer', '.key', '.p12', '.pfx'],
    banking: ['.ofx', '.csv', '.txt']
};

// File size limits (in bytes)
const SIZE_LIMITS: Record<string, number> = {
    images: 10 * 1024 * 1024,      // 10MB
    documents: 50 * 1024 * 1024,   // 50MB
    certificates: 1 * 1024 * 1024, // 1MB
    banking: 10 * 1024 * 1024      // 10MB
};

interface ValidationResult {
    valid: boolean;
    error?: string;
    sanitizedFilename?: string;
    detectedMimeType?: string;
}

/**
 * Detect MIME type from file buffer using magic bytes
 */
export function detectMimeType(buffer: Buffer): string | null {
    for (const [mimeType, signatures] of Object.entries(FILE_SIGNATURES)) {
        if (signatures.length === 0) continue; // Skip types without magic bytes

        for (const signature of signatures) {
            if (buffer.length >= signature.length) {
                const fileHeader = buffer.slice(0, signature.length);
                if (fileHeader.equals(signature)) {
                    return mimeType;
                }
            }
        }
    }
    return null;
}

/**
 * Sanitize filename to prevent path traversal attacks
 */
export function sanitizeFilename(filename: string): string {
    // Remove path components
    let sanitized = path.basename(filename);

    // Remove special characters except alphanumeric, dash, underscore, dot
    sanitized = sanitized.replace(/[^a-zA-Z0-9\-_.]/g, '_');

    // Prevent double extensions that could bypass filters
    const parts = sanitized.split('.');
    if (parts.length > 2) {
        sanitized = parts[0] + '.' + parts[parts.length - 1];
    }

    // Limit length
    if (sanitized.length > 255) {
        const ext = path.extname(sanitized);
        sanitized = sanitized.substring(0, 255 - ext.length) + ext;
    }

    return sanitized;
}

/**
 * Validate a file upload
 */
export function validateFileUpload(
    file: Express.Multer.File,
    category: keyof typeof ALLOWED_EXTENSIONS
): ValidationResult {
    // Check if category is valid
    if (!ALLOWED_EXTENSIONS[category]) {
        return { valid: false, error: 'Invalid file category' };
    }

    // Sanitize filename
    const sanitizedFilename = sanitizeFilename(file.originalname);
    const extension = path.extname(sanitizedFilename).toLowerCase();

    // Check extension
    if (!ALLOWED_EXTENSIONS[category].includes(extension)) {
        return {
            valid: false,
            error: `File type not allowed. Allowed: ${ALLOWED_EXTENSIONS[category].join(', ')}`
        };
    }

    // Check file size
    const sizeLimit = SIZE_LIMITS[category];
    if (file.size > sizeLimit) {
        return {
            valid: false,
            error: `File too large. Maximum size: ${Math.round(sizeLimit / 1024 / 1024)}MB`
        };
    }

    // Detect actual MIME type from content
    const detectedMimeType = detectMimeType(file.buffer);

    // For files with magic bytes, verify MIME type matches
    if (detectedMimeType) {
        const declaredMime = file.mimetype.toLowerCase();

        // Check if declared MIME is compatible with detected
        // (some flexibility for office documents that all show as zip)
        const isCompatible =
            declaredMime === detectedMimeType ||
            (detectedMimeType === 'application/zip' && (
                declaredMime.includes('spreadsheetml') ||
                declaredMime.includes('wordprocessingml') ||
                declaredMime === 'application/zip'
            )) ||
            (detectedMimeType === 'image/webp' && declaredMime === 'image/webp');

        if (!isCompatible && category !== 'banking' && category !== 'certificates') {
            return {
                valid: false,
                error: 'File content does not match declared type'
            };
        }
    }

    return {
        valid: true,
        sanitizedFilename,
        detectedMimeType: detectedMimeType || file.mimetype
    };
}

/**
 * Multer file filter factory
 */
export function createFileFilter(category: keyof typeof ALLOWED_EXTENSIONS) {
    return (
        req: Request,
        file: Express.Multer.File,
        callback: multer.FileFilterCallback
    ) => {
        const extension = path.extname(file.originalname).toLowerCase();

        if (!ALLOWED_EXTENSIONS[category].includes(extension)) {
            callback(
                new Error(`File type not allowed. Allowed: ${ALLOWED_EXTENSIONS[category].join(', ')}`)
            );
            return;
        }

        callback(null, true);
    };
}

/**
 * Check if file buffer contains any executable code signatures
 */
export function containsExecutableCode(buffer: Buffer): boolean {
    const executableSignatures = [
        Buffer.from([0x4D, 0x5A]),         // Windows EXE (MZ)
        Buffer.from([0x7F, 0x45, 0x4C, 0x46]), // Linux ELF
        Buffer.from('#!/'),                // Shell script
        Buffer.from('<?php'),              // PHP
        Buffer.from('<script'),            // JavaScript in HTML
    ];

    for (const sig of executableSignatures) {
        // Check at start
        if (buffer.slice(0, sig.length).equals(sig)) {
            return true;
        }
        // Also check if embedded anywhere (for scripts)
        if (sig.toString().startsWith('<') || sig.toString().startsWith('#')) {
            if (buffer.includes(sig)) {
                return true;
            }
        }
    }

    return false;
}

export default {
    detectMimeType,
    sanitizeFilename,
    validateFileUpload,
    createFileFilter,
    containsExecutableCode,
    ALLOWED_EXTENSIONS,
    SIZE_LIMITS
};
