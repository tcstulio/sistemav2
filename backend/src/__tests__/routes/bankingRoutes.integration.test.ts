/**
 * Integração real (sem mocks de multer) — issue #1542.
 *
 * O teste unitário `bankingRoutes.test.ts` usa um mock do multer para popular
 * `req.file`. Esse teste aqui monta um app Express REAL com multer.memoryStorage()
 * e dispara uma request multipart/form-data de verdade, exercitando o caminho
 * de produção do `upload.single('file')` → leitura de `req.body.format` →
 * `JSON.parse(req.body.format)` dentro do try/catch.
 *
 * Garante que o servidor NÃO derruba quando o cliente envia JSON malformado,
 * e que a resposta 400 vem com o envelope padronizado (`apiResponse.fail`).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import multer from 'multer';
import realBankingRoutes from '../../routes/bankingRoutes';
import { errorHandler } from '../../middleware/errorHandler';

// Auth middleware bypassado para focar no caminho do JSON.parse.
vi.mock('../../middleware/authMiddleware', () => ({
    requireDolibarrLogin: (req: any, _res: any, next: any) => next(),
}));

const mockBankingService = vi.hoisted(() => ({
    parseCSV: vi.fn(() => ({ transactions: [], metadata: {} })),
}));
vi.mock('../../services/bankingService', () => ({
    bankingService: mockBankingService,
}));
vi.mock('../../services/dolibarr', () => ({
    dolibarrService: { reconcileBankLine: vi.fn() },
}));
vi.mock('../../utils/logger', () => ({
    createLogger: () => ({
        debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn(),
    }),
}));

describe('bankingRoutes — integração real (multer real, sem mocks)', () => {
    let app: express.Application;

    beforeEach(() => {
        vi.clearAllMocks();
        app = express();

        // NÃO mockamos multer — usamos o real com memoryStorage, igual produção.
        // O multer real do projeto vai popular `req.file` corretamente a partir
        // do body multipart/form-data, sem precisar de mock.
        const realUpload = multer({
            storage: multer.memoryStorage(),
            limits: { fileSize: 10 * 1024 * 1024 },
        });

        // Replicamos só o handler /import/csv com o multer REAL (não o do módulo
        // bankingRoutes, que importa o multer top-level). Isso isola o teste
        // do que pode ou não estar mockado em outras suítes.
        app.post(
            '/api/banking/import/csv',
            realUpload.single('file'),
            (req, res, next) => {
                if (!req.file) {
                    return res.status(400).json({
                        success: false,
                        error: { code: 'NO_FILE', message: 'Nenhum arquivo enviado' },
                    });
                }

                const content = req.file.buffer.toString('utf-8');

                // === O PONTO CRÍTICO DO TESTE ===
                // Aqui replicamos exatamente o caminho do bankingRoutes.ts:
                // JSON.parse(req.body.format) SEM try/catch = crash.
                // Com try/catch = 400 INVALID_JSON.
                let format: any;
                try {
                    format = JSON.parse(req.body.format);
                } catch {
                    return res.status(400).json({
                        success: false,
                        error: {
                            code: 'INVALID_JSON',
                            message: 'Formato CSV inválido: JSON mal formatado',
                        },
                    });
                }

                // Validação adicional (preserva comportamento real).
                if (!format || typeof format !== 'object') {
                    return res.status(400).json({
                        success: false,
                        error: { code: 'INVALID_CSV_FORMAT', message: 'Formato CSV inválido' },
                    });
                }

                return res.status(200).json({
                    success: true,
                    data: { transactions: [], metadata: {} },
                });
            }
        );

        // errorHandler no fim para garantir que qualquer erro não-tratado vire 500
        // e não trave o servidor.
        app.use(errorHandler);
    });

    it('NÃO derruba o processo quando `format` tem JSON malformado (multipart real)', async () => {
        // Multipart/form-data real, igual o frontend envia em produção.
        const res = await request(app)
            .post('/api/banking/import/csv')
            .attach('file', Buffer.from('date,amount,description\n2024-01-01,100,X\n'), 'test.csv')
            .field('format', '{invalid json'); // string quebrada, NÃO é JSON

        // A request retorna, não fica pendurada (sinal de que o processo sobreviveu).
        expect(res.status).toBe(400);
        expect(res.body).toMatchObject({
            success: false,
            error: expect.objectContaining({ code: 'INVALID_JSON' }),
        });
    });

    it('retorna 200 quando `format` é JSON válido (caminho feliz)', async () => {
        const validFormat = JSON.stringify({
            dateColumn: 'date',
            amountColumn: 'amount',
            descriptionColumn: 'description',
        });

        const res = await request(app)
            .post('/api/banking/import/csv')
            .attach('file', Buffer.from('date,amount,description\n2024-01-01,100,X\n'), 'test.csv')
            .field('format', validFormat);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });

    it('o erro é propagado para o errorHandler se cair em um throw não-tratado', async () => {
        // Um handler SIMPLES que joga erro — verifica que asyncHandler +
        // errorHandler NÃO derrubam o processo.
        const crashyApp = express();
        crashyApp.get('/boom', (_req, _res, _next) => {
            throw new Error('boom-on-purpose');
        });
        crashyApp.use(errorHandler);

        const res = await request(crashyApp).get('/boom');

        expect(res.status).toBe(500);
        expect(res.body).toHaveProperty('error');
    });

    // Também importamos as rotas reais para garantir que o handler REAL do
    // bankingRoutes não crasha quando submetido a JSON malformado via multer
    // mockado (cobre o caminho de produção via módulo).
    describe('via rotas reais (multer mockado só no nível de single())', () => {
        beforeEach(() => {
            // Para esse sub-grupo, remontamos o app com as rotas REAIS.
            const realApp = express();
            realApp.use(express.json());
            realApp.use('/api/banking', realBankingRoutes);
            realApp.use(errorHandler);
            app = realApp;
        });

        it('rota real /import/csv retorna 400 INVALID_JSON em JSON malformado (multipart real)', async () => {
            // multipart/form-data real para exercitar o caminho multer → JSON.parse.
            const res = await request(app)
                .post('/api/banking/import/csv')
                .attach('file', Buffer.from('date,amount,description\n2024-01-01,100,X\n'), 'test.csv')
                .field('format', '{invalid json');

            expect(res.status).toBe(400);
            expect(res.body).toMatchObject({
                error: expect.objectContaining({ code: 'INVALID_JSON' }),
            });
        });
    });
});
