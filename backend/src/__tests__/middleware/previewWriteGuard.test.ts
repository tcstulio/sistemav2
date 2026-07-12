import { describe, it, expect } from 'vitest';
import { isPreviewWriteBlocked } from '../../middleware/previewWriteGuard';

const previewNoSandbox = { PREVIEW_MODE: '1', PREVIEW_SANDBOX_ACTIVE: '0' } as any;
const previewSandbox = { PREVIEW_MODE: '1', PREVIEW_SANDBOX_ACTIVE: '1' } as any;
const notPreview = { PREVIEW_MODE: '', PREVIEW_SANDBOX_ACTIVE: '' } as any;

describe('#1377 isPreviewWriteBlocked — fail-closed do preview sem sandbox', () => {
    it('preview SEM sandbox + escrita (POST/PUT/DELETE/PATCH) → BLOQUEIA', () => {
        for (const m of ['POST', 'PUT', 'DELETE', 'PATCH']) {
            expect(isPreviewWriteBlocked(m, previewNoSandbox)).toBe(true);
        }
    });

    it('preview SEM sandbox + leitura (GET/HEAD/OPTIONS) → NÃO bloqueia', () => {
        for (const m of ['GET', 'HEAD', 'OPTIONS']) {
            expect(isPreviewWriteBlocked(m, previewNoSandbox)).toBe(false);
        }
    });

    it('preview COM sandbox ativo + escrita → NÃO bloqueia (write vai pro sandbox, seguro)', () => {
        expect(isPreviewWriteBlocked('POST', previewSandbox)).toBe(false);
        expect(isPreviewWriteBlocked('DELETE', previewSandbox)).toBe(false);
    });

    it('FORA de preview + escrita → NÃO bloqueia (operação normal)', () => {
        expect(isPreviewWriteBlocked('POST', notPreview)).toBe(false);
        expect(isPreviewWriteBlocked('DELETE', notPreview)).toBe(false);
    });

    it('PREVIEW_SANDBOX_ACTIVE ausente (undefined) é tratado como sem-sandbox (fail-closed)', () => {
        expect(isPreviewWriteBlocked('POST', { PREVIEW_MODE: '1' } as any)).toBe(true);
    });

    it('método em minúsculas ainda é reconhecido (case-insensitive)', () => {
        expect(isPreviewWriteBlocked('post', previewNoSandbox)).toBe(true);
        expect(isPreviewWriteBlocked('get', previewNoSandbox)).toBe(false);
    });
});
