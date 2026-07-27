/**
 * Integration tests for bankingRoutes — issue #1542.
 *
 * Foco: o endpoint POST /api/banking/import/csv NÃO pode derrubar o processo
 * quando `req.body.format` é um JSON malformado (o JSON.parse da linha ~75
 * precisa estar protegido por try/catch e retornar 400 INVALID_JSON).
 *
 * O mock do multer injeta um `req.file` com buffer para que a requisição
 * chegue ao ponto do JSON.parse; o `format` chega via corpo JSON normal.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

const mockRequireDolibarrLogin = vi.hoisted(() => vi.fn((req: any, res: any, next: any) => next()));

const mockBankingService = vi.hoisted(() => ({
    parseOFX: vi.fn(() => ({ transactions: [], accountNumber: '123', balance: 0 })),
    parseCSV: vi.fn(() => ({ transactions: [{ date: '2024-01-01', amount: 100 }], metadata: {} })),
    parseStatement: vi.fn(() => ({ transactions: [], accountNumber: '123', balance: 0 })),
    categorizeTransactions: vi.fn(() => []),
    detectAnomalies: vi.fn(() => []),
    generateCashFlowInsights: vi.fn(() => ({})),
    getCashFlowChartData: vi.fn(() => ({})),
    suggestReconciliation: vi.fn(() => []),
    saveReconciliation: vi.fn(() => true),
    calculateDynamicBalance: vi.fn(() => ({})),
}));

const mockDolibarrService = vi.hoisted(() => ({
    reconcileBankLine: vi.fn(() => Promise.resolve(true)),
}));

vi.mock('../../middleware/authMiddleware', () => ({
    requireDolibarrLogin: mockRequireDolibarrLogin,
}));

vi.mock('../../services/bankingService', () => ({
    bankingService: mockBankingService,
}));

vi.mock('../../services/dolibarr', () => ({
    dolibarrService: mockDolibarrService,
}));

vi.mock('../../utils/logger', () => ({
    createLogger: () => ({
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        fatal: vi.fn(),
    }),
}));

// Mock do multer que injeta um arquivo para exercitar o caminho do JSON.parse.
vi.mock('multer', () => {
    const multerMock: any = (_options?: any) => ({
        single: () => (req: any, _res: any, next: any) => {
            req.file = {
                buffer: Buffer.from('date,amount,description\n2024-01-01,100,test'),
                originalname: 'statement.csv',
            };
            next();
        },
        array: () => (_req: any, _res: any, next: any) => next(),
        fields: () => (_req: any, _res: any, next: any) => next(),
        none: () => (_req: any, _res: any, next: any) => next(),
    });
    multerMock.memoryStorage = () => ({});
    multerMock.diskStorage = () => ({});
    return { default: multerMock };
});

import bankingRoutes from '../../routes/bankingRoutes';

function createApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/banking', bankingRoutes);
    return app;
}

describe('bankingRoutes integration — CSV JSON.parse crash guard (#1542)', () => {
    let app: express.Application;

    beforeEach(() => {
        vi.clearAllMocks();
        app = createApp();
    });

    it('returns 400 INVALID_JSON (does NOT crash) for malformed format JSON', async () => {
        const res = await request(app)
            .post('/api/banking/import/csv')
            .send({ format: '{invalid json' });

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
        expect(res.body.error.code).toBe('INVALID_JSON');
        // parseCSV nunca deve ser chamado com formato inválido.
        expect(mockBankingService.parseCSV).not.toHaveBeenCalled();
    });

    it('processes a valid format JSON with 200', async () => {
        const format = JSON.stringify({
            dateColumn: 'date',
            amountColumn: 'amount',
            descriptionColumn: 'description',
        });
        const res = await request(app)
            .post('/api/banking/import/csv')
            .send({ format });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(mockBankingService.parseCSV).toHaveBeenCalledTimes(1);
    });

    it('rejects a non-object format (e.g. bare number/string) with 400', async () => {
        const res = await request(app)
            .post('/api/banking/import/csv')
            .send({ format: '42' });

        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('INVALID_FORMAT');
    });

    it('survives repeated malformed input without crashing the process', async () => {
        const badInputs = ['{', '[', ']', 'not json', '{"a":}', '{"unterminated": "'];
        for (const bad of badInputs) {
            const res = await request(app)
                .post('/api/banking/import/csv')
                .send({ format: bad });
            expect(res.status).toBe(400);
        }
    });

    it('falls back to column defaults when no format is provided (200)', async () => {
        const res = await request(app)
            .post('/api/banking/import/csv')
            .send({ dateColumn: 'data', amountColumn: 'valor' });

        expect(res.status).toBe(200);
        expect(mockBankingService.parseCSV).toHaveBeenCalledTimes(1);
    });
});
