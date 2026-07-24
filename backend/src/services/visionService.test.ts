import axios from 'axios';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { config } from '../config/env';
import {
    describeVisionError,
    getVisionClientConfig,
    getVisionHeaders,
    isCodingBase,
    redactApiKey,
} from './visionService';

const originalConfig = {
    zaiApiKey: config.zaiApiKey,
    zaiVisionBaseUrl: config.zaiVisionBaseUrl,
    zaiVisionModel: config.zaiVisionModel,
};

beforeEach(() => {
    (axios as unknown as { isAxiosError: (error: unknown) => boolean }).isAxiosError = (
        error: unknown
    ): boolean => Boolean((error as { isAxiosError?: boolean } | null)?.isAxiosError);
});

afterEach(() => {
    config.zaiApiKey = originalConfig.zaiApiKey;
    config.zaiVisionBaseUrl = originalConfig.zaiVisionBaseUrl;
    config.zaiVisionModel = originalConfig.zaiVisionModel;
});

describe('visionService', () => {
    it('normaliza a URL e reutiliza modelo e chave da configuração', () => {
        config.zaiApiKey = 'secret-key';
        config.zaiVisionBaseUrl = 'https://api.example.com/coding/v4///';
        config.zaiVisionModel = 'glm-vision';

        expect(getVisionClientConfig()).toEqual({
            apiKey: 'secret-key',
            baseUrl: 'https://api.example.com/coding/v4',
            model: 'glm-vision',
        });
    });

    it('monta os headers com e sem autorização', () => {
        config.zaiApiKey = '';
        expect(getVisionHeaders()).toEqual({ 'Content-Type': 'application/json' });

        config.zaiApiKey = 'secret-key';
        expect(getVisionHeaders()).toEqual({
            'Content-Type': 'application/json',
            Authorization: 'Bearer secret-key',
        });
    });

    it('identifica a base Coding e mascara chaves', () => {
        expect(isCodingBase('https://api.z.ai/api/coding/paas/v4')).toBe(true);
        expect(isCodingBase('https://api.z.ai/api/paas/v4')).toBe(false);
        expect(redactApiKey('1234567890')).toBe('1234…90');
        expect(redactApiKey('short')).toBe('***');
        expect(redactApiKey('')).toBe('');
    });

    it('preserva status, código e corpo de erros HTTP', () => {
        const error = {
            isAxiosError: true,
            code: 'ERR_BAD_REQUEST',
            response: {
                status: 413,
                data: { error: 'payload too large' },
            },
        };

        expect(describeVisionError(error)).toEqual({
            kind: 'HTTP_413',
            status: 413,
            body: '{"error":"payload too large"}',
            code: 'ERR_BAD_REQUEST',
        });
    });

    it('preserva erros de timeout sem resposta HTTP', () => {
        const error = {
            isAxiosError: true,
            code: 'ECONNABORTED',
            message: 'timeout of 120000ms exceeded',
        };

        expect(describeVisionError(error)).toEqual({
            kind: 'ECONNABORTED',
            code: 'ECONNABORTED',
        });
    });
});
