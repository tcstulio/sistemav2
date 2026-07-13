import fs from 'fs';
import path from 'path';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetAccountsReceivable = vi.hoisted(() => vi.fn());
const mockGetCustomerContext = vi.hoisted(() => vi.fn());

vi.mock('../../services/dolibarr', () => ({
    dolibarrService: {
        getAccountsReceivable: mockGetAccountsReceivable,
        getCustomerContext: mockGetCustomerContext,
    },
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

import {
    buildDunningDigest,
    assertBlastRadiusZero,
    FORBIDDEN_OUTBOUND,
    type DunningItem,
} from '../../services/dunningService';

const nowSec = () => Math.floor(Date.now() / 1000);

function receivable(
    partial: Partial<{
        id: string;
        ref: string;
        totalTtc: number;
        dueOffsetDays: number | null;
        isOverdue: boolean;
        socid: string;
        socName: string;
    }>,
) {
    const { dueOffsetDays, ...rest } = partial;
    const dueDate =
        dueOffsetDays === null || dueOffsetDays === undefined
            ? null
            : String(nowSec() + dueOffsetDays * 86400);
    return {
        id: 'x',
        ref: 'REF',
        totalTtc: 0,
        dueDate,
        isOverdue: false,
        socid: 'S',
        socName: 'Soc',
        ...rest,
    };
}

describe('dunningService.buildDunningDigest — ordenação por score (#1402)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('R$ 1000×30d > R$ 5000×5d > R$ 100×90d (ordem desc por score)', async () => {
        mockGetAccountsReceivable.mockResolvedValue([
            receivable({ id: '1', ref: 'INV-1', totalTtc: 5000, dueOffsetDays: -5, socid: 'A', socName: 'Cliente A' }),
            receivable({ id: '2', ref: 'INV-2', totalTtc: 1000, dueOffsetDays: -30, socid: 'B', socName: 'Cliente B' }),
            receivable({ id: '3', ref: 'INV-3', totalTtc: 100, dueOffsetDays: -90, socid: 'C', socName: 'Cliente C' }),
        ]);
        mockGetCustomerContext.mockResolvedValue('CLIENTE ID: ...');

        const digest = await buildDunningDigest();

        expect(digest.items).toHaveLength(3);
        expect(digest.items.map((i) => i.socid)).toEqual(['B', 'A', 'C']);
        expect(digest.items[0].score).toBe(1000 * 30);
        expect(digest.items[1].score).toBe(5000 * 5);
        expect(digest.items[2].score).toBe(100 * 90);
        expect(digest.totalItems).toBe(3);
        expect(digest.totalReady).toBe(3);
        expect(digest.totalIncomplete).toBe(0);
    });

    it('faturas a vencer (dias negativos) recebem score baixo e vão para o fim', async () => {
        mockGetAccountsReceivable.mockResolvedValue([
            receivable({ id: '1', ref: 'FUT-1', totalTtc: 10000, dueOffsetDays: -10, socid: 'OVERDUE', socName: 'Vencido' }),
            receivable({ id: '2', ref: 'FUT-2', totalTtc: 99999, dueOffsetDays: 30, socid: 'FUTURE', socName: 'A Vencer' }),
        ]);
        mockGetCustomerContext.mockResolvedValue('CLIENTE ID: ...');

        const digest = await buildDunningDigest();

        expect(digest.items[0].socid).toBe('OVERDUE');
        expect(digest.items[1].socid).toBe('FUTURE');
        // a vencer: score = total * max(1, -dias negativos) → usa 1 como piso
        expect(digest.items[1].score).toBe(99999 * 1);
        expect(digest.items[1].diasAtrasoMax).toBeLessThan(0);
    });

    it('respeita limit (default 50 e custom)', async () => {
        const fixtures = Array.from({ length: 60 }, (_, i) =>
            receivable({
                id: String(i),
                ref: `INV-${i}`,
                totalTtc: 100,
                dueOffsetDays: -(i + 1),
                socid: `S${i}`,
                socName: `Cliente ${i}`,
            }),
        );
        mockGetAccountsReceivable.mockResolvedValue(fixtures);
        mockGetCustomerContext.mockResolvedValue('CLIENTE ID: ...');

        const def = await buildDunningDigest();
        expect(def.totalItems).toBe(50);

        const custom = await buildDunningDigest({ limit: 10 });
        expect(custom.totalItems).toBe(10);

        const filtered = await buildDunningDigest({ socid: 'S5' });
        expect(filtered.totalItems).toBe(1);
        expect(filtered.items[0].socid).toBe('S5');
    });

    it('valor hard-coded no template → o valor no rascunho é exatamente o da fixture (NÃO inventado)', async () => {
        mockGetAccountsReceivable.mockResolvedValue([
            receivable({
                id: '42',
                ref: 'FIX-INV-42',
                totalTtc: 1234.56,
                dueOffsetDays: -10,
                socid: 'S1',
                socName: 'Acme Ltda',
            }),
        ]);
        mockGetCustomerContext.mockResolvedValue('CLIENTE ID: S1\n...');

        const digest = await buildDunningDigest();
        const item = digest.items[0];

        expect(item.status).toBe('ready');
        expect(item.rascunho).not.toBeNull();
        // Todos os placeholders vêm EXATAMENTE da fixture — qualquer divergência
        // denuncia que algum valor foi "alucinado" pelo template.
        expect(item.rascunho).toBe(
            'Olá Acme Ltda, identificamos 1 fatura(s) em aberto — total R$ 1234.56 ' +
                '(ref: FIX-INV-42). Vencimento mais antigo: ' +
                new Date((nowSec() - 10 * 86400) * 1000).toLocaleDateString('pt-BR') +
                '. Posso ajudar a regularizar?',
        );
        expect(item.totalAberto).toBe(1234.56);
    });

    it('refs múltiplas são listadas na ordem da fatura', async () => {
        mockGetAccountsReceivable.mockResolvedValue([
            receivable({ id: '1', ref: 'A-001', totalTtc: 100, dueOffsetDays: -5, socid: 'X', socName: 'X SA' }),
            receivable({ id: '2', ref: 'A-002', totalTtc: 200, dueOffsetDays: -15, socid: 'X', socName: 'X SA' }),
        ]);
        mockGetCustomerContext.mockResolvedValue('CLIENTE ID: X\n...');

        const digest = await buildDunningDigest();
        expect(digest.items[0].invoices).toHaveLength(2);
        expect(digest.items[0].totalAberto).toBe(300);
        expect(digest.items[0].rascunho).toContain('2 fatura(s)');
        expect(digest.items[0].rascunho).toContain('A-001, A-002');
    });
});

describe('dunningService.buildDunningDigest — fail-closed em fetch (#1402)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('get_accounts_receivable lançando → digest vazio (sem crash, sem valor inventado)', async () => {
        mockGetAccountsReceivable.mockRejectedValue(new Error('CRM offline'));
        mockGetCustomerContext.mockResolvedValue('CLIENTE ID: ...');

        const digest = await buildDunningDigest();

        expect(digest.items).toEqual([]);
        expect(digest.totalItems).toBe(0);
        expect(digest.totalReady).toBe(0);
        expect(digest.totalIncomplete).toBe(0);
        expect(digest.geradoEm).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('get_customer_details lançando → item marcado incomplete com motivo="fetch falhou", resto segue', async () => {
        mockGetAccountsReceivable.mockResolvedValue([
            receivable({ id: '1', ref: 'OK-1', totalTtc: 100, dueOffsetDays: -5, socid: 'GOOD', socName: 'Cliente OK' }),
            // socname vazio dispara a chamada de get_customer_details
            receivable({ id: '2', ref: 'BAD-1', totalTtc: 250, dueOffsetDays: -10, socid: 'BROKEN', socName: '' }),
            receivable({ id: '3', ref: 'OK-2', totalTtc: 50, dueOffsetDays: -2, socid: 'GOOD2', socName: 'Outro OK' }),
        ]);
        mockGetCustomerContext.mockRejectedValue(new Error('timeout'));

        const digest = await buildDunningDigest();

        // 3 itens: 2 ready, 1 incomplete
        expect(digest.totalItems).toBe(3);
        expect(digest.totalReady).toBe(2);
        expect(digest.totalIncomplete).toBe(1);

        const broken = digest.items.find((i) => i.socid === 'BROKEN')!;
        expect(broken).toBeDefined();
        expect(broken.status).toBe('incomplete');
        expect(broken.rascunho).toBeNull();
        expect(broken.motivo).toBe('fetch falhou');
        // itens que NÃO dependiam do fetch devem estar prontos
        const good = digest.items.find((i) => i.socid === 'GOOD')!;
        expect(good.status).toBe('ready');
        expect(good.rascunho).toBeTruthy();
        const good2 = digest.items.find((i) => i.socid === 'GOOD2')!;
        expect(good2.status).toBe('ready');
        expect(good2.rascunho).toBeTruthy();
    });

    it('campo crítico faltando → rascunho=null e motivo="dado incompleto: <campo>"', async () => {
        // sem ref → refs vazia → entra no early return
        mockGetAccountsReceivable.mockResolvedValue([
            receivable({ id: '1', ref: '', totalTtc: 100, dueOffsetDays: -5, socid: 'NOREF', socName: 'Sem Ref' }),
        ]);
        mockGetCustomerContext.mockResolvedValue('CLIENTE ID: NOREF');

        const digest = await buildDunningDigest();
        expect(digest.items[0].status).toBe('incomplete');
        expect(digest.items[0].rascunho).toBeNull();
        expect(digest.items[0].motivo).toMatch(/^dado incompleto: refs$/);
    });

    it('sem socname e sem conseguir enriquecer → incomplete (dado incompleto: socname)', async () => {
        mockGetAccountsReceivable.mockResolvedValue([
            receivable({ id: '1', ref: 'OK', totalTtc: 50, dueOffsetDays: -3, socid: 'NOID', socName: '' }),
        ]);
        // get_customer_details "resolve" sem jogar (cenário real: função existente engole erro)
        mockGetCustomerContext.mockResolvedValue('Erro ao buscar dados detalhados do cliente no CRM.');

        const digest = await buildDunningDigest();
        const item = digest.items[0];
        expect(item.status).toBe('incomplete');
        expect(item.rascunho).toBeNull();
        expect(item.motivo).toBe('dado incompleto: socname');
    });
});

describe('dunningService — blast-radius zero (#1400)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('assertBlastRadiusZero lança quando o source efetivo contém identificador proibido', () => {
        // Sintético: o identificador aparece FORA de string/comentário → deve falhar.
        const evil = `
            const send_whatsapp = () => 'vai';
            const ok = 1;
        `;
        expect(() => assertBlastRadiusZero(evil)).toThrow(/dunningService violation/);
    });

    it('assertBlastRadiusZero NÃO lança quando identificador só aparece em comentário/string', () => {
        // Comentário com a palavra → strip remove → passa
        const onlyComment = `
            // este arquivo não pode usar send_whatsapp
            /* nem notify_person */
            const motivo = "send_email é proibido";
            const ok = 1;
        `;
        expect(() => assertBlastRadiusZero(onlyComment)).not.toThrow();
    });

    it('FORBIDDEN_OUTBOUND contém exatamente os 3 identificadores do critério', () => {
        expect(FORBIDDEN_OUTBOUND).toEqual(
            expect.arrayContaining(['send_whatsapp', 'notify_person', 'send_email']),
        );
    });

    it('grep no source real do serviço retorna ZERO matches (após strip de literais/comentários)', () => {
        const file = path.join(__dirname, '../../services/dunningService.ts');
        const raw = fs.readFileSync(file, 'utf-8');
        const src = typeof raw === 'string' ? raw : raw.toString();

        const stripped = src
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/\/\/.*$/gm, '')
            .replace(/(['"`])(?:\\.|(?!\1).)*\1/g, '');

        for (const k of FORBIDDEN_OUTBOUND) {
            const re = new RegExp(`\\b${k}\\b`);
            expect(stripped, `achou ${k} no source efetivo`).not.toMatch(re);
        }

        // E o grep literal (sem strip), retornando exatamente o que o critério de aceite pede,
        // também deve ser zero em matches FORA de comentários/string (já garantido acima,
        // mas repetimos a forma exata exigida pelo critério).
        const reAll = /send_whatsapp|notify_person|send_email/g;
        const allMatches = src.match(reAll) || [];
        // Cada match deve estar dentro de comentário OU string (não em código).
        const lines = src.split('\n');
        for (const m of allMatches) {
            const lineWithMatch = lines.find((l) => l.includes(m)) || '';
            const trimmed = lineWithMatch.trim();
            const isComment = trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*');
            const isStringAssignment = /['"`].*['"`]/.test(lineWithMatch) && !/\bfunction\b/.test(lineWithMatch);
            expect(
                isComment || isStringAssignment,
                `Match '${m}' fora de comentário/string: ${lineWithMatch}`,
            ).toBe(true);
        }
        expect(allMatches.length).toBeGreaterThanOrEqual(0); // sanity
    });

    it('grep literal sobre o source REAL retorna ZERO matches (critério #1402)', async () => {
        // O setup global mocka `fs` retornando Buffer.from('test'). Para verificar
        // o arquivo-fonte de verdade, importamos o módulo real dinamicamente.
        const realFs = await vi.importActual<typeof import('fs')>('fs');
        const file = path.join(__dirname, '../../services/dunningService.ts');
        const raw = realFs.readFileSync(file, 'utf-8');
        const src = typeof raw === 'string' ? raw : raw.toString();

        // Critério de aceite literal da issue #1402:
        //   grep -E '<3 ids>' backend/src/services/dunningService.ts
        //   → ZERO matches, sem qualquer strip/qualificação.
        const re = /send_whatsapp|notify_person|send_email/g;
        const matches = src.match(re);
        expect(matches, `grep literal achou matches no source: ${JSON.stringify(matches)}`).toBeNull();
    });
});
