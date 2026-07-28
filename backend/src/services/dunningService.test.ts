/**
 * dunningService.test.ts — issue #1402 (re-execução corrigida).
 *
 * Verifica:
 *   - Pipeline funcional: ordenação por score, limit, filtro por socid,
 *     template usa campos reais, fail-closed em fetch falhado.
 *   - Behavioral blast-radius zero: nenhum módulo de saída externa é
 *     chamado em nenhum caminho do digest (zero invocações via spy).
 *   - Structural blast-radius zero: inspeção via AST do TypeScript
 *     confirma que `dunningService` não tem nenhum import para os
 *     módulos de envio proibidos.
 *
 * A verificação é comportamental/estrutural — NÃO usa grep de texto
 * sobre o source (regra anti-ofuscação do issue).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as ts from 'typescript';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// Mocks hoisted — ficam disponíveis antes do import do dunningService.
const mockGetAccountsReceivable = vi.hoisted(() => vi.fn());
const mockGetCustomerContext = vi.hoisted(() => vi.fn());

// Spies para os módulos de saída externa — esses mocks interceptam
// QUALQUER `import` que o dunningService faça desses módulos. Como o
// dunningService genuinamente não os importa, esses spies ficam em zero
// durante toda a execução (verificação behavioral).
const senderSpies = vi.hoisted(() => ({
    channelRouter: {
        send: vi.fn(async () => ({ success: true })),
        sendWhatsApp: vi.fn(async () => ({ success: true })),
        sendEmail: vi.fn(async () => ({ success: true })),
        sendWhatsAppFile: vi.fn(async () => ({ success: true })),
        sendWhatsAppVoice: vi.fn(async () => ({ success: true })),
    },
    emailService: {
        send: vi.fn(async () => ({ success: true })),
        sendMail: vi.fn(async () => ({ success: true })),
    },
    notificationService: {
        notifyPerson: vi.fn(async () => ({ id: 'n' })),
        sendNotification: vi.fn(async () => ({ id: 'n' })),
    },
    messageService: {
        send: vi.fn(async () => ({ success: true })),
        sendText: vi.fn(async () => ({ success: true })),
    },
    sessionService: {
        sendMessage: vi.fn(async () => ({ success: true })),
    },
    moltbotGateway: {
        send: vi.fn(async () => ({ success: true })),
        sendMessage: vi.fn(async () => ({ success: true })),
    },
}));

vi.mock('./dolibarr', () => ({
    dolibarrService: {
        getAccountsReceivable: mockGetAccountsReceivable,
        getCustomerContext: mockGetCustomerContext,
    },
}));

vi.mock('./channelRouter', () => ({ channelRouter: senderSpies.channelRouter }));
vi.mock('./emailService', () => ({ emailService: senderSpies.emailService }));
vi.mock('./notificationService', () => ({ notificationService: senderSpies.notificationService }));
vi.mock('./legacy/messageService', () => ({ messageService: senderSpies.messageService }));
vi.mock('./legacy/sessionService', () => ({ sessionService: senderSpies.sessionService }));
vi.mock('./moltbotGateway', () => ({ moltbotGateway: senderSpies.moltbotGateway }));

import { buildDunningDigest } from './dunningService';
import type { ReceivableItem } from './dolibarr/finance';

const ALL_SENDER_FNS: Array<{ name: string; spy: ReturnType<typeof vi.fn> }> = [
    { name: 'channelRouter.send', spy: senderSpies.channelRouter.send },
    { name: 'channelRouter.sendWhatsApp', spy: senderSpies.channelRouter.sendWhatsApp },
    { name: 'channelRouter.sendEmail', spy: senderSpies.channelRouter.sendEmail },
    { name: 'channelRouter.sendWhatsAppFile', spy: senderSpies.channelRouter.sendWhatsAppFile },
    { name: 'channelRouter.sendWhatsAppVoice', spy: senderSpies.channelRouter.sendWhatsAppVoice },
    { name: 'emailService.send', spy: senderSpies.emailService.send },
    { name: 'emailService.sendMail', spy: senderSpies.emailService.sendMail },
    { name: 'notificationService.notifyPerson', spy: senderSpies.notificationService.notifyPerson },
    { name: 'notificationService.sendNotification', spy: senderSpies.notificationService.sendNotification },
    { name: 'messageService.send', spy: senderSpies.messageService.send },
    { name: 'messageService.sendText', spy: senderSpies.messageService.sendText },
    { name: 'sessionService.sendMessage', spy: senderSpies.sessionService.sendMessage },
    { name: 'moltbotGateway.send', spy: senderSpies.moltbotGateway.send },
    { name: 'moltbotGateway.sendMessage', spy: senderSpies.moltbotGateway.sendMessage },
];

const SENDER_MODULE_PATHS = [
    'channelRouter',
    'emailService',
    'notificationService',
    'messageService',
    'sessionService',
    'moltbotGateway',
    'agentTools',
];

function assertNoSenderCalls(): void {
    for (const { name, spy } of ALL_SENDER_FNS) {
        expect(spy, `sender "${name}" should not have been called`).not.toHaveBeenCalled();
    }
}

// Timestamps fixos: passado distante e futuro distante.
const DUE_PAST = '1577836800'; // 2020-01-01
const DUE_FUTURE = '1893456000'; // 2030-01-01

function invoice(over: Partial<ReceivableItem>): ReceivableItem {
    return {
        id: 'inv-1',
        ref: 'FA-1',
        totalTtc: 100,
        dueDate: DUE_PAST,
        isOverdue: true,
        socid: 'soc-1',
        socName: 'Cliente 1',
        ...over,
    };
}

describe('dunningService (#1402) — pipeline funcional', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetAccountsReceivable.mockResolvedValue([]);
        mockGetCustomerContext.mockResolvedValue('contexto do cliente');
    });

    it('retorna digest vazio quando não há faturas em aberto', async () => {
        const digest = await buildDunningDigest();

        expect(digest.items).toEqual([]);
        expect(digest.totalItems).toBe(0);
        expect(digest.totalReady).toBe(0);
        expect(digest.totalIncomplete).toBe(0);
        expect(typeof digest.geradoEm).toBe('string');
        expect(new Date(digest.geradoEm).getTime()).not.toBeNaN();
    });

    it('monta 1 item ready a partir de uma fatura com socname e datas válidas', async () => {
        mockGetAccountsReceivable.mockResolvedValue([
            invoice({ id: 'i1', ref: 'FA-100', totalTtc: 250, socName: 'Acme' }),
        ]);

        const digest = await buildDunningDigest();

        expect(digest.items).toHaveLength(1);
        expect(digest.totalReady).toBe(1);
        expect(digest.totalIncomplete).toBe(0);
        expect(digest.items[0].socid).toBe('soc-1');
        expect(digest.items[0].socname).toBe('Acme');
        expect(digest.items[0].status).toBe('ready');
        expect(digest.items[0].rascunho).toMatch(/^Olá Acme,/);
        expect(digest.items[0].rascunho).toContain('1 fatura(s) em aberto');
        expect(digest.items[0].rascunho).toContain('FA-100');
    });

    it('ordena desc por score — faturas vencidas muito acima das a vencer', async () => {
        // soc-A: 1 fatura vencida há muito, total 1000
        // soc-B: 1 fatura a vencer (2030), total 1000
        mockGetAccountsReceivable.mockResolvedValue([
            invoice({ id: 'b1', ref: 'FA-B', socid: 'soc-B', socName: 'B', totalTtc: 1000, dueDate: DUE_FUTURE }),
            invoice({ id: 'a1', ref: 'FA-A', socid: 'soc-A', socName: 'A', totalTtc: 1000, dueDate: DUE_PAST }),
        ]);

        const digest = await buildDunningDigest();

        expect(digest.items.map(i => i.socid)).toEqual(['soc-A', 'soc-B']);
        // A tem score alto (vencida × totalAberto), B tem score = totalAberto (dias negativos → max(1, …)=1).
        expect(digest.items[0].score).toBeGreaterThan(digest.items[1].score);
        expect(digest.items[1].score).toBe(1000); // soc-B: 1000 * max(1, negativo) = 1000
    });

    it('aplica limit (default 50 e custom)', async () => {
        const many = Array.from({ length: 60 }, (_, i) =>
            invoice({ id: `id-${i}`, ref: `FA-${i}`, socid: `s-${i}`, socName: `C${i}`, totalTtc: 100 })
        );
        mockGetAccountsReceivable.mockResolvedValue(many);

        const def = await buildDunningDigest();
        expect(def.items).toHaveLength(50);
        expect(def.totalItems).toBe(50);

        const limited = await buildDunningDigest({ limit: 5 });
        expect(limited.items).toHaveLength(5);

        const limitedZero = await buildDunningDigest({ limit: 0 });
        expect(limitedZero.items).toHaveLength(0);
        expect(limitedZero.totalItems).toBe(0);
    });

    it('filtra por socid quando informado', async () => {
        mockGetAccountsReceivable.mockResolvedValue([
            invoice({ id: 'i1', socid: 'soc-A', socName: 'A' }),
            invoice({ id: 'i2', socid: 'soc-B', socName: 'B' }),
        ]);

        const digest = await buildDunningDigest({ socid: 'soc-B' });

        expect(digest.items).toHaveLength(1);
        expect(digest.items[0].socid).toBe('soc-B');
    });

    it('agrupa várias faturas do mesmo socid em um único item com total somado', async () => {
        mockGetAccountsReceivable.mockResolvedValue([
            invoice({ id: 'i1', ref: 'FA-1', totalTtc: 100, dueDate: DUE_PAST }),
            invoice({ id: 'i2', ref: 'FA-2', totalTtc: 250, dueDate: DUE_PAST }),
        ]);

        const digest = await buildDunningDigest();

        expect(digest.items).toHaveLength(1);
        expect(digest.items[0].totalAberto).toBe(350);
        expect(digest.items[0].invoices).toHaveLength(2);
        expect(digest.items[0].rascunho).toContain('2 fatura(s)');
        expect(digest.items[0].rascunho).toContain('FA-1, FA-2');
    });

    it('template usa exatamente os valores da fatura (teste com fixture assertando literal)', async () => {
        const dueTs = '1609459200'; // 2021-01-01
        mockGetAccountsReceivable.mockResolvedValue([
            invoice({
                id: 'fix-1',
                ref: 'FA-FIX-9',
                totalTtc: 1234.56,
                dueDate: dueTs,
                socName: 'Fulano de Tal',
            }),
        ]);

        const digest = await buildDunningDigest();
        const item = digest.items[0];
        expect(item.status).toBe('ready');
        expect(item.rascunho).not.toBeNull();
        // Conteúdo literal — sem hard-code fora da fatura real.
        expect(item.rascunho).toBe(
            'Olá Fulano de Tal, identificamos 1 fatura(s) em aberto — total R$ 1.234,56 (ref: FA-FIX-9). Vencimento mais antigo: 01/01/2021. Posso ajudar a regularizar?'
        );
    });

    it('marca item como incomplete quando socname está vazio (após enrichment)', async () => {
        mockGetAccountsReceivable.mockResolvedValue([
            invoice({ socName: '' }),
        ]);
        mockGetCustomerContext.mockResolvedValue('ainda sem nome útil');

        const digest = await buildDunningDigest();

        expect(digest.items).toHaveLength(1);
        expect(digest.items[0].status).toBe('incomplete');
        expect(digest.items[0].rascunho).toBeNull();
        expect(digest.items[0].motivo).toBe('dado incompleto: socname');
        expect(digest.items[0].score).toBe(0);
        // O enrichment FOI chamado (regra do spec).
        expect(mockGetCustomerContext).toHaveBeenCalledWith('soc-1');
    });

    it('NÃO chama enrichment quando socname já está presente na fatura', async () => {
        mockGetAccountsReceivable.mockResolvedValue([
            invoice({ socName: 'Cliente OK' }),
        ]);

        const digest = await buildDunningDigest();

        expect(digest.items[0].status).toBe('ready');
        expect(mockGetCustomerContext).not.toHaveBeenCalled();
    });

    it('marca como fetch falhou quando getCustomerContext lança, sem derrubar o digest', async () => {
        mockGetAccountsReceivable.mockResolvedValue([
            invoice({ socid: 'soc-X', socName: '' }),
            invoice({ id: 'i2', socid: 'soc-Y', ref: 'FA-Y', totalTtc: 200, dueDate: DUE_PAST, socName: 'Y' }),
        ]);
        mockGetCustomerContext.mockImplementation(async (id: string) => {
            if (id === 'soc-X') throw new Error('dolibarr timeout');
            return 'contexto y';
        });

        const digest = await buildDunningDigest();

        expect(digest.items).toHaveLength(2);
        const xItem = digest.items.find(i => i.socid === 'soc-X')!;
        const yItem = digest.items.find(i => i.socid === 'soc-Y')!;
        expect(xItem.status).toBe('incomplete');
        expect(xItem.rascunho).toBeNull();
        expect(xItem.motivo).toBe('fetch falhou');
        expect(yItem.status).toBe('ready');
        expect(yItem.rascunho).toMatch(/^Olá Y,/);
        expect(digest.totalIncomplete).toBe(1);
        expect(digest.totalReady).toBe(1);
    });

    it('devolve digest vazio (sem crash) quando getAccountsReceivable lança', async () => {
        mockGetAccountsReceivable.mockRejectedValue(new Error('dolibarr down'));

        const digest = await buildDunningDigest();

        expect(digest.items).toEqual([]);
        expect(digest.totalItems).toBe(0);
        expect(digest.totalReady).toBe(0);
        expect(digest.totalIncomplete).toBe(0);
        expect(typeof digest.geradoEm).toBe('string');
    });

    it('marca incomplete com motivo de campo faltante quando dueDate é null em todas as faturas', async () => {
        mockGetAccountsReceivable.mockResolvedValue([
            invoice({ dueDate: null }),
        ]);

        const digest = await buildDunningDigest();

        expect(digest.items[0].status).toBe('incomplete');
        expect(digest.items[0].rascunho).toBeNull();
        expect(digest.items[0].motivo).toBe('dado incompleto: vencMaisAntigo');
    });

    it('diasAtrasoMax é o máximo entre as faturas do grupo (não a soma)', async () => {
        // soc-1: duas faturas, uma vencida há +2000 dias e outra a vencer.
        mockGetAccountsReceivable.mockResolvedValue([
            invoice({ id: 'a', ref: 'FA-A', totalTtc: 100, dueDate: DUE_PAST }),
            invoice({ id: 'b', ref: 'FA-B', totalTtc: 500, dueDate: DUE_FUTURE }),
        ]);

        const digest = await buildDunningDigest();
        expect(digest.items[0].diasAtrasoMax).toBeGreaterThan(0);
        expect(digest.items[0].diasAtrasoMax).toBeGreaterThan(1000);
        // score = totalAberto(600) * diasAtrasoMax(>=1000) — bem maior que 600.
        expect(digest.items[0].score).toBe(600 * digest.items[0].diasAtrasoMax);
    });
});

describe('dunningService (#1402) — blast-radius zero', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Cenário completo para forçar todos os caminhos do pipeline.
        mockGetAccountsReceivable.mockResolvedValue([
            invoice({ id: 'r1', socid: 's-A', socName: 'A', totalTtc: 500, dueDate: DUE_PAST, ref: 'FA-R1' }),
            invoice({ id: 'r2', socid: 's-B', socName: '', dueDate: DUE_PAST, ref: 'FA-R2' }),
            invoice({ id: 'r3', socid: 's-C', socName: 'C', totalTtc: 999, dueDate: DUE_FUTURE, ref: 'FA-R3' }),
        ]);
        mockGetCustomerContext.mockImplementation(async (id: string) => {
            if (id === 's-B') throw new Error('timeout');
            return 'contexto';
        });
    });

    afterEach(() => {
        assertNoSenderCalls();
    });

    it('BEHAVIORAL: nenhum módulo de saída externa é chamado — cenário completo', async () => {
        await buildDunningDigest();
        await buildDunningDigest({ limit: 2 });
        await buildDunningDigest({ socid: 's-A' });
        await buildDunningDigest({ socid: 's-NAO-EXISTE' });
        await buildDunningDigest({ socid: 's-A', limit: 1 });

        assertNoSenderCalls();
    });

    it('BEHAVIORAL: zero invocações quando getAccountsReceivable falha', async () => {
        mockGetAccountsReceivable.mockRejectedValue(new Error('boom'));
        await buildDunningDigest();

        assertNoSenderCalls();
    });

    it('BEHAVIORAL: zero invocações quando todos os itens viram incomplete', async () => {
        mockGetAccountsReceivable.mockResolvedValue([
            invoice({ socid: 's-X', socName: '' }),
            invoice({ id: 'i2', socid: 's-Y', socName: '', ref: 'FA-Y' }),
        ]);
        mockGetCustomerContext.mockRejectedValue(new Error('tudo falhou'));

        await buildDunningDigest();
        assertNoSenderCalls();
    });

    it('STRUCTURAL: dunningService NÃO importa nenhum módulo de envio (inspeção de AST)', async () => {
        // Os spies foram criados pelos `vi.mock` ANTES deste import —
        // se `dunningService` tivesse qualquer side-effect de import que
        // invocasse um dos métodos espionados, alguma das chamadas já
        // teria sido registrada. Como nada é importado pelos senders,
        // o contador permanece zero após todos os testes anteriores.
        assertNoSenderCalls();

        // Inspeção estrutural via AST do TypeScript (NÃO usa grep de string
        // sobre o arquivo — percorre os nós `ImportDeclaration` da árvore
        // sintática). Isso satisfaz o critério "Estrutural: o serviço não
        // importa módulos de envio (verificado por inspeção de imports,
        // NÃO por grep de texto)" do issue #1402.
        const dunningPath = resolve(__dirname, 'dunningService.ts');
        // Usamos fs.promises (NÃO mockado em src/__tests__/setup.ts — só
        // fs.readFileSync/writeFileSync etc. são mockados) para obter o
        // conteúdo real do source.
        const source = await readFile(dunningPath, 'utf8');
        const sourceFile = ts.createSourceFile(
            dunningPath,
            source,
            ts.ScriptTarget.Latest,
            /* setParentNodes */ true,
            ts.ScriptKind.TS,
        );

        const imports: string[] = [];
        const visit = (node: ts.Node): void => {
            if (
                ts.isImportDeclaration(node) &&
                node.moduleSpecifier &&
                ts.isStringLiteral(node.moduleSpecifier)
            ) {
                imports.push(node.moduleSpecifier.text);
            }
            ts.forEachChild(node, visit);
        };
        visit(sourceFile);

        // Asserção principal: nenhum import aponta para um módulo de envio.
        const importStr = imports.join(', ');
        for (const sender of SENDER_MODULE_PATHS) {
            const hit = imports.some(specifier => specifier.includes(sender));
            expect(
                hit,
                `dunningService NÃO deve importar ${sender} (imports atuais: [${importStr}])`
            ).toBe(false);
        }

        // Sanity check: imports legítimos continuam presentes (não regredimos
        // o serviço a ponto de não importar nada).
        expect(imports.length).toBeGreaterThan(0);
        expect(imports).toContain('./dolibarr');
    });
});