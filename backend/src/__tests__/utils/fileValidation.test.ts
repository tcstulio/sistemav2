import { describe, it, expect, vi } from 'vitest';
import {
    detectMimeType,
    sanitizeFilename,
    validateFileUpload,
    createFileFilter,
    containsExecutableCode,
} from '../../utils/fileValidation';
import fileValidationDefault from '../../utils/fileValidation';

function makeFile(overrides: Partial<Express.Multer.File> = {}): Express.Multer.File {
    return {
        fieldname: 'file',
        originalname: 'test.jpg',
        encoding: '7bit',
        mimetype: 'image/jpeg',
        size: 1024,
        destination: '/tmp',
        filename: 'test-123.jpg',
        path: '/tmp/test-123.jpg',
        buffer: Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]),
        stream: {} as any,
        ...overrides,
    };
}

describe('detectMimeType', () => {
    it('detects JPEG from magic bytes', () => {
        expect(detectMimeType(Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]))).toBe('image/jpeg');
    });

    it('detects PNG from magic bytes', () => {
        const png = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00]);
        expect(detectMimeType(png)).toBe('image/png');
    });

    it('detects GIF from magic bytes', () => {
        expect(detectMimeType(Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]))).toBe('image/gif');
    });

    it('detects WebP from RIFF header', () => {
        const webp = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]);
        expect(detectMimeType(webp)).toBe('image/webp');
    });

    it('detects PDF from magic bytes', () => {
        expect(detectMimeType(Buffer.from('%PDF-1.4'))).toBe('application/pdf');
    });

    it('detects ZIP / Office from PK header', () => {
        expect(detectMimeType(Buffer.from([0x50, 0x4B, 0x03, 0x04]))).toBe('application/zip');
    });

    it('detects x509 certificate from BEGIN marker', () => {
        expect(detectMimeType(Buffer.from('-----BEGIN CERTIFICATE-----'))).toBe('application/x-x509-ca-cert');
    });

    it('detects PKCS12 from DER header', () => {
        expect(detectMimeType(Buffer.from([0x30, 0x82, 0x01, 0x00]))).toBe('application/x-pkcs12');
    });

    it('returns null for unknown bytes', () => {
        expect(detectMimeType(Buffer.from([0x00, 0x01, 0x02, 0x03]))).toBeNull();
    });

    it('returns null for empty buffer', () => {
        expect(detectMimeType(Buffer.alloc(0))).toBeNull();
    });
});

describe('sanitizeFilename', () => {
    it('passes through normal filenames unchanged', () => {
        expect(sanitizeFilename('photo.jpg')).toBe('photo.jpg');
    });

    it('removes path components using basename', () => {
        expect(sanitizeFilename('/etc/passwd')).toBe('passwd');
        expect(sanitizeFilename('../../../etc/shadow')).toBe('shadow');
    });

    it('replaces special characters with underscore', () => {
        expect(sanitizeFilename('my file (1).jpg')).toBe('my_file__1_.jpg');
        expect(sanitizeFilename('file@#$.txt')).toBe('file___.txt');
    });

    it('collapses double extensions to single extension', () => {
        expect(sanitizeFilename('file.txt.exe')).toBe('file.exe');
        expect(sanitizeFilename('archive.tar.gz')).toBe('archive.gz');
    });

    it('leaves single-extension filenames unchanged', () => {
        expect(sanitizeFilename('document.pdf')).toBe('document.pdf');
        expect(sanitizeFilename('noext')).toBe('noext');
    });

    it('truncates filenames longer than 255 chars keeping extension', () => {
        const longName = 'a'.repeat(252) + '.txt';
        const result = sanitizeFilename(longName);
        expect(result.length).toBeLessThanOrEqual(255);
        expect(result.endsWith('.txt')).toBe(true);
        expect(result).toBe('a'.repeat(251) + '.txt');
    });
});

describe('validateFileUpload', () => {
    it('accepts a valid image upload', () => {
        const result = validateFileUpload(makeFile(), 'images');
        expect(result.valid).toBe(true);
        expect(result.sanitizedFilename).toBe('test.jpg');
        expect(result.detectedMimeType).toBe('image/jpeg');
    });

    it('rejects invalid extension', () => {
        const result = validateFileUpload(
            makeFile({ originalname: 'malware.exe', mimetype: 'application/x-msdownload' }),
            'images'
        );
        expect(result.valid).toBe(false);
        expect(result.error).toContain('File type not allowed');
    });

    it('rejects file exceeding size limit', () => {
        const result = validateFileUpload(
            makeFile({ size: 20 * 1024 * 1024 }),
            'images'
        );
        expect(result.valid).toBe(false);
        expect(result.error).toContain('File too large');
    });

    it('rejects invalid category', () => {
        const result = validateFileUpload(makeFile(), 'invalid' as any);
        expect(result.valid).toBe(false);
        expect(result.error).toBe('Invalid file category');
    });

    it('rejects MIME mismatch for non-exempt category', () => {
        const result = validateFileUpload(
            makeFile({
                originalname: 'test.jpg',
                mimetype: 'image/png',
                buffer: Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]),
            }),
            'images'
        );
        expect(result.valid).toBe(false);
        expect(result.error).toBe('File content does not match declared type');
    });

    it('rejects zip detected with non-compatible declared mime', () => {
        const result = validateFileUpload(
            makeFile({
                originalname: 'test.pdf',
                mimetype: 'application/pdf',
                buffer: Buffer.from([0x50, 0x4B, 0x03, 0x04]),
                size: 100,
            }),
            'documents'
        );
        expect(result.valid).toBe(false);
        expect(result.error).toBe('File content does not match declared type');
    });

    it('rejects webp detected with non-webp declared mime', () => {
        const result = validateFileUpload(
            makeFile({
                originalname: 'image.webp',
                mimetype: 'image/png',
                buffer: Buffer.from([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]),
                size: 100,
            }),
            'images'
        );
        expect(result.valid).toBe(false);
        expect(result.error).toBe('File content does not match declared type');
    });

    it('allows MIME mismatch for banking category', () => {
        const result = validateFileUpload(
            makeFile({
                originalname: 'data.csv',
                mimetype: 'text/csv',
                buffer: Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]),
                size: 100,
            }),
            'banking'
        );
        expect(result.valid).toBe(true);
    });

    it('allows MIME mismatch for certificates category', () => {
        const result = validateFileUpload(
            makeFile({
                originalname: 'cert.pem',
                mimetype: 'application/x-x509-ca-cert',
                buffer: Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]),
                size: 100,
            }),
            'certificates'
        );
        expect(result.valid).toBe(true);
    });

    it('accepts xlsx as compatible with zip detection', () => {
        const result = validateFileUpload(
            makeFile({
                originalname: 'sheet.xlsx',
                mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                buffer: Buffer.from([0x50, 0x4B, 0x03, 0x04]),
                size: 100,
            }),
            'documents'
        );
        expect(result.valid).toBe(true);
    });

    it('accepts docx as compatible with zip detection', () => {
        const result = validateFileUpload(
            makeFile({
                originalname: 'doc.docx',
                mimetype: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                buffer: Buffer.from([0x50, 0x4B, 0x03, 0x04]),
                size: 100,
            }),
            'documents'
        );
        expect(result.valid).toBe(true);
    });

    it('accepts plain zip declared mime when zip detected', () => {
        const result = validateFileUpload(
            makeFile({
                originalname: 'data.xlsx',
                mimetype: 'application/zip',
                buffer: Buffer.from([0x50, 0x4B, 0x03, 0x04]),
                size: 100,
            }),
            'documents'
        );
        expect(result.valid).toBe(true);
    });

    it('accepts webp image with matching declared mime', () => {
        const result = validateFileUpload(
            makeFile({
                originalname: 'image.webp',
                mimetype: 'image/webp',
                buffer: Buffer.from([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]),
                size: 100,
            }),
            'images'
        );
        expect(result.valid).toBe(true);
        expect(result.detectedMimeType).toBe('image/webp');
    });

    it('uses file.mimetype when no magic bytes are detected', () => {
        const result = validateFileUpload(
            makeFile({
                originalname: 'data.csv',
                mimetype: 'text/csv',
                buffer: Buffer.from('col1,col2\nval1,val2'),
                size: 100,
            }),
            'banking'
        );
        expect(result.valid).toBe(true);
        expect(result.detectedMimeType).toBe('text/csv');
    });

    it('returns sanitizedFilename in the result', () => {
        const result = validateFileUpload(
            makeFile({ originalname: 'my photo.jpg' }),
            'images'
        );
        expect(result.valid).toBe(true);
        expect(result.sanitizedFilename).toBe('my_photo.jpg');
    });
});

describe('createFileFilter', () => {
    it('allows files with valid extension', () => {
        const filter = createFileFilter('images');
        const callback = vi.fn();

        filter({} as any, makeFile({ originalname: 'photo.jpg' }), callback);

        expect(callback).toHaveBeenCalledWith(null, true);
    });

    it('rejects files with invalid extension', () => {
        const filter = createFileFilter('images');
        const callback = vi.fn();

        filter({} as any, makeFile({ originalname: 'virus.exe' }), callback);

        expect(callback).toHaveBeenCalledTimes(1);
        expect(callback.mock.calls[0][0]).toBeInstanceOf(Error);
        expect(callback.mock.calls[0][0].message).toContain('File type not allowed');
        expect(callback.mock.calls[0][1]).toBeUndefined();
    });
});

describe('containsExecutableCode', () => {
    it('detects Windows EXE from MZ header', () => {
        const buf = Buffer.from([0x4D, 0x5A, 0x90, 0x00]);
        expect(containsExecutableCode(buf)).toBe(true);
    });

    it('detects Linux ELF binary', () => {
        const buf = Buffer.from([0x7F, 0x45, 0x4C, 0x46, 0x02, 0x01]);
        expect(containsExecutableCode(buf)).toBe(true);
    });

    it('detects shell script shebang at start', () => {
        const buf = Buffer.from('#!/bin/bash\necho hello');
        expect(containsExecutableCode(buf)).toBe(true);
    });

    it('detects embedded shell script shebang', () => {
        const buf = Buffer.from('some text #!/bin/bash more text');
        expect(containsExecutableCode(buf)).toBe(true);
    });

    it('detects PHP tag', () => {
        const buf = Buffer.from('<?php echo "hello"; ?>');
        expect(containsExecutableCode(buf)).toBe(true);
    });

    it('detects embedded PHP tag', () => {
        const buf = Buffer.from('normal text <?php malicious() ?> more text');
        expect(containsExecutableCode(buf)).toBe(true);
    });

    it('detects script tag', () => {
        const buf = Buffer.from('<script>alert("xss")</script>');
        expect(containsExecutableCode(buf)).toBe(true);
    });

    it('detects embedded script tag', () => {
        const buf = Buffer.from('some html <script>evil()</script> content');
        expect(containsExecutableCode(buf)).toBe(true);
    });

    it('returns false for clean files', () => {
        const buf = Buffer.from('Hello, this is a normal text file with no executable content.');
        expect(containsExecutableCode(buf)).toBe(false);
    });
});

describe('default export', () => {
    it('exposes ALLOWED_EXTENSIONS and SIZE_LIMITS', () => {
        expect(fileValidationDefault.ALLOWED_EXTENSIONS).toBeDefined();
        expect(fileValidationDefault.SIZE_LIMITS).toBeDefined();
        expect(fileValidationDefault.ALLOWED_EXTENSIONS.images).toContain('.jpg');
        expect(fileValidationDefault.SIZE_LIMITS.images).toBe(10 * 1024 * 1024);
    });
});
