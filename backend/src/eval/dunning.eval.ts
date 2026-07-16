/**
 * dunning.eval.ts — issue #1405 / epic #1400
 *
 * Eval do digest de recebíveis (dunningService.buildDunningDigest) usando um
 * golden-set de 18 fixtures (goldenDunning.json). É um ROTEIRO standalone:
 * rodado por `npm run eval:dunning` via tsx (NÃO vitest), porque a saída
 * precisa ser um scoreboard textual imprimível no log da CI, e a verificação
 * comportamental de "nenhuma função de envio foi chamada" precisa de monkey-
 * patching em runtime (não há `vi.mock` aqui).
 *
 * Garantias:
 *   1. Pipeline funcional: cada fixture valida posição no ranking, status,
 *      e que o `rascunho` contém exatamente o que deveria (e NÃO contém o
 *      que não deveria). Falhas patológicas (valor absurdo, ref inexistente,
 *      fetch falhando) estão todas cobertas.
 *   2. Guard de saída externa: ANTES do `buildDunningDigest()` rodar, todos
 *      os canais de envio (channelRouter.send / sendWhatsApp / sendEmail;
 *      emailService.sendEmail; notificationService.notifyPerson) são trocados por
 *      spies. Se QUALQUER um for chamado mesmo UMA vez durante a geração
 *      do digest, o teste falha com `FAIL` claro apontando o spy violado.
 *      A verificação é puramente comportamental (não usa grep textual sobre
 *      o source — preserva a regra anti-ofuscação do issue #1402).
 *
 * Exit code: 0 quando todos passam, 1 quando qualquer um falha.
 */

import { dolibarrService } from '../services/dolibarr';
import { channelRouter } from '../services/channelRouter';
import { emailService } from '../services/emailService';
import { notificationService } from '../services/notificationService';
import { buildDunningDigest } from '../services/dunningService';
import type { DunningItem, DunningDigest } from '../services/dunningService';
import type { ReceivableItem } from '../services/dolibarr/finance';

import golden from './goldenDunning.json';

interface FixtureExpect {
    rank?: number;
    notInDigest?: boolean;
    status: 'ready' | 'incomplete' | 'absent';
    motivo?: string;
    rascunhoContains: string[];
    rascunhoNotContains: string[];
}

interface Fixture {
    id: string;
    ref: string;
    socid: string;
    socname: string;
    totalAberto: number;
    diasAtraso: number;
    isPaid?: boolean;
    customerContextThrows?: boolean;
    expect: FixtureExpect;
}

interface GoldenSet {
    schemaVersion: number;
    issue: string;
    description: string;
    fixtures: Fixture[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
    return Array.isArray(value) && value.every(item => typeof item === 'string');
}

function assertGoldenSet(value: unknown): asserts value is GoldenSet {
    if (
        !isRecord(value) ||
        value.schemaVersion !== 1 ||
        typeof value.issue !== 'string' ||
        typeof value.description !== 'string' ||
        !Array.isArray(value.fixtures) ||
        value.fixtures.length < 18
    ) {
        throw new Error('goldenDunning.json inválido: schema ou quantidade de fixtures');
    }

    value.fixtures.forEach((rawFixture, index) => {
        const prefix = `goldenDunning.fixtures[${index}]`;
        if (!isRecord(rawFixture)) {
            throw new Error(`${prefix} deve ser um objeto`);
        }

        const requiredStrings = ['id', 'ref', 'socid', 'socname'];
        if (!requiredStrings.every(field => typeof rawFixture[field] === 'string')) {
            throw new Error(`${prefix} possui campo textual ausente ou inválido`);
        }
        if (
            typeof rawFixture.totalAberto !== 'number' ||
            !Number.isFinite(rawFixture.totalAberto) ||
            typeof rawFixture.diasAtraso !== 'number' ||
            !Number.isFinite(rawFixture.diasAtraso)
        ) {
            throw new Error(`${prefix} possui valor ou atraso inválido`);
        }
        if (rawFixture.isPaid !== undefined && typeof rawFixture.isPaid !== 'boolean') {
            throw new Error(`${prefix}.isPaid deve ser booleano`);
        }
        if (
            rawFixture.customerContextThrows !== undefined &&
            typeof rawFixture.customerContextThrows !== 'boolean'
        ) {
            throw new Error(`${prefix}.customerContextThrows deve ser booleano`);
        }

        const expected = rawFixture.expect;
        if (
            !isRecord(expected) ||
            typeof expected.status !== 'string' ||
            !['ready', 'incomplete', 'absent'].includes(expected.status) ||
            !isStringArray(expected.rascunhoContains) ||
            !isStringArray(expected.rascunhoNotContains)
        ) {
            throw new Error(`${prefix}.expect possui schema inválido`);
        }
        const rank = expected.rank;
        if (
            rank !== undefined &&
            (typeof rank !== 'number' || !Number.isInteger(rank) || rank < 0)
        ) {
            throw new Error(`${prefix}.expect.rank deve ser inteiro não negativo`);
        }
        if (expected.notInDigest !== undefined && typeof expected.notInDigest !== 'boolean') {
            throw new Error(`${prefix}.expect.notInDigest deve ser booleano`);
        }
        if (expected.motivo !== undefined && typeof expected.motivo !== 'string') {
            throw new Error(`${prefix}.expect.motivo deve ser textual`);
        }
    });
}

assertGoldenSet(golden);
const GOLDEN = golden;

const DAY_IN_SECONDS = 86400;

type ReceivableFn = typeof dolibarrService.getAccountsReceivable;
type CustomerContextFn = typeof dolibarrService.getCustomerContext;
type DolibarrServiceMock = Pick<typeof dolibarrService, 'getAccountsReceivable' | 'getCustomerContext'>;

function dueDateForDias(diasAtraso: number): string {
    const nowSec = Math.floor(Date.now() / 1000);
    const target = nowSec - diasAtraso * DAY_IN_SECONDS;
    return String(target);
}

class Spy {
    public readonly name: string;
    public calls: unknown[][] = [];
    constructor(name: string) {
        this.name = name;
    }
    record(...args: unknown[]): void {
        this.calls.push(args);
    }
    reset(): void {
        this.calls = [];
    }
    get called(): boolean {
        return this.calls.length > 0;
    }
}

interface SenderPatch {
    label: string;
    owner: object;
    method: string;
    original: unknown;
    hadOwnProperty: boolean;
}

function patchSenderMethod(owner: object, method: string, spy: Spy): SenderPatch {
    const original = Reflect.get(owner, method);
    if (typeof original !== 'function') {
        throw new Error(`sender "${spy.name}" não possui o método ${method}`);
    }

    const hadOwnProperty = Object.prototype.hasOwnProperty.call(owner, method);
    Reflect.set(owner, method, (...args: unknown[]) => {
        spy.record(...args);
        return undefined;
    });

    return { label: spy.name, owner, method, original, hadOwnProperty };
}

function restorePatch(patch: SenderPatch): void {
    if (patch.hadOwnProperty) {
        Reflect.set(patch.owner, patch.method, patch.original);
    } else {
        Reflect.deleteProperty(patch.owner, patch.method);
    }
}

function buildReceivables(fixtures: Fixture[]): ReceivableItem[] {
    return fixtures
        .filter(f => !f.isPaid)
        .map(f => ({
            id: f.ref,
            ref: f.ref,
            totalTtc: f.totalAberto,
            dueDate: dueDateForDias(f.diasAtraso),
            isOverdue: f.diasAtraso > 0,
            socid: f.socid,
            socName: f.socname,
        }));
}

interface CheckResult {
    fixtureId: string;
    passed: boolean;
    reason: string;
}

function checkFixture(
    fixture: Fixture,
    digest: DunningDigest
): CheckResult {
    const exp = fixture.expect;

    if (exp.notInDigest || exp.status === 'absent') {
        const refFound = digest.items.some(
            it => it.socid === fixture.socid || it.invoices.some(inv => inv.ref === fixture.ref)
        );
        if (refFound) {
            return {
                fixtureId: fixture.id,
                passed: false,
                reason: `esperava AUSÊNCIA no digest, mas encontrou item(s) com socid=${fixture.socid || '(vazio)'} ou ref=${fixture.ref}`,
            };
        }
        return { fixtureId: fixture.id, passed: true, reason: 'ausente (correto)' };
    }

    const rank = exp.rank;
    if (rank === undefined || rank < 0 || rank >= digest.items.length) {
        return {
            fixtureId: fixture.id,
            passed: false,
            reason: `rank esperado=${rank} está fora do range (digest tem ${digest.items.length} itens)`,
        };
    }

    const item = digest.items[rank];

    if (item.socid !== fixture.socid) {
        return {
            fixtureId: fixture.id,
            passed: false,
            reason: `socid do digest no rank ${rank} é "${item.socid || '(vazio)'}" mas a fixture esperava "${fixture.socid}" — ranking quebrou (regressão na ordenação por score?)`,
        };
    }

    if (!item.invoices.some(invoice => invoice.ref === fixture.ref)) {
        return {
            fixtureId: fixture.id,
            passed: false,
            reason: `a fatura ${fixture.ref} não está no item do digest no rank ${rank} — ranking ou agrupamento quebrou`,
        };
    }

    if (item.status !== exp.status) {
        return {
            fixtureId: fixture.id,
            passed: false,
            reason: `status esperado="${exp.status}" veio="${item.status}"`,
        };
    }

    if (exp.motivo !== undefined && item.motivo !== exp.motivo) {
        return {
            fixtureId: fixture.id,
            passed: false,
            reason: `motivo esperado="${exp.motivo}" veio="${item.motivo ?? '(vazio)'}"`,
        };
    }

    const rascunho = item.rascunho ?? '';
    for (const needle of exp.rascunhoContains ?? []) {
        if (!rascunho.includes(needle)) {
            return {
                fixtureId: fixture.id,
                passed: false,
                reason: `rascunho NÃO contém "${needle}". Rascunho real: ${JSON.stringify(rascunho)}`,
            };
        }
    }
    for (const needle of exp.rascunhoNotContains ?? []) {
        if (rascunho.includes(needle)) {
            return {
                fixtureId: fixture.id,
                passed: false,
                reason: `rascunho CONTÉM (mas não deveria) "${needle}". Rascunho real: ${JSON.stringify(rascunho)}`,
            };
        }
    }

    return {
        fixtureId: fixture.id,
        passed: true,
        reason: `rank=${rank} status=${item.status}${item.motivo ? ` motivo=${item.motivo}` : ''}`,
    };
}

function checkGuards(spies: Spy[]): CheckResult[] {
    const violations: CheckResult[] = [];
    for (const spy of spies) {
        if (spy.called) {
            violations.push({
                fixtureId: 'GUARD',
                passed: false,
                reason: `sender "${spy.name}" foi chamado ${spy.calls.length}x durante buildDunningDigest — viola blast-radius zero`,
            });
        }
    }
    return violations;
}

function printScoreboard(results: CheckResult[]): void {
    const passed = results.filter(r => r.passed);
    const failed = results.filter(r => !r.passed);
    const total = results.length;

    console.log('');
    console.log('┌──────────────────────────────────────────────────────────────┐');
    console.log('│              DUNNING EVAL — ISSUE #1405 / EPIC #1400          │');
    console.log('└──────────────────────────────────────────────────────────────┘');
    console.log('');
    console.log(`Score: ✓ ${passed.length}/${total}`);
    if (failed.length > 0) {
        console.log('');
        console.log('Falhas:');
        for (const f of failed) {
            console.log(`  ✗ [${f.fixtureId}] ${f.reason}`);
        }
    } else {
        console.log('');
        console.log('Todas as fixtures + guard de saída externa passaram.');
    }
    console.log('');
}

interface SenderTarget {
    label: string;
    module: object;
    method: string;
}

const SENDER_TARGETS: SenderTarget[] = [
    { label: 'channelRouter.send', module: channelRouter, method: 'send' },
    { label: 'channelRouter.sendWhatsApp', module: channelRouter, method: 'sendWhatsApp' },
    { label: 'channelRouter.sendEmail', module: channelRouter, method: 'sendEmail' },
    { label: 'emailService.sendEmail', module: emailService, method: 'sendEmail' },
    { label: 'notificationService.notifyPerson', module: notificationService, method: 'notifyPerson' },
];

async function main(): Promise<number> {
    console.log(`Carregando golden-set: ${GOLDEN.fixtures.length} fixtures (${GOLDEN.issue})`);

    const spies: Spy[] = [];
    const patches: SenderPatch[] = [];

    for (const target of SENDER_TARGETS) {
        const spy = new Spy(target.label);
        const patch = patchSenderMethod(target.module, target.method, spy);
        spies.push(spy);
        patches.push(patch);
    }

    const dolibarrMock: DolibarrServiceMock = dolibarrService;
    const origGetAccountsReceivable = dolibarrMock.getAccountsReceivable;
    const origGetCustomerContext = dolibarrMock.getCustomerContext;

    try {
        const fixturesReceivable = GOLDEN.fixtures;
        const throwingSocids = new Set(
            fixturesReceivable
                .filter(f => f.customerContextThrows && f.socid)
                .map(f => String(f.socid))
        );

        const mockReceivable: ReceivableFn = async () => buildReceivables(fixturesReceivable);
        const mockCustomer: CustomerContextFn = async (thirdPartyId: string) => {
            if (throwingSocids.has(String(thirdPartyId))) {
                throw new Error(`mock: customer context indisponível para ${thirdPartyId}`);
            }
            return `contexto-mock-${thirdPartyId}`;
        };

        dolibarrMock.getAccountsReceivable = mockReceivable;
        dolibarrMock.getCustomerContext = mockCustomer;

        const digest = await buildDunningDigest();

        const results: CheckResult[] = [];
        for (const fixture of GOLDEN.fixtures) {
            results.push(checkFixture(fixture, digest));
        }

        const guardViolations = checkGuards(spies);
        for (const violation of guardViolations) {
            results.push(violation);
        }

        printScoreboard(results);

        const failedCount = results.filter(r => !r.passed).length;
        return failedCount === 0 ? 0 : 1;
    } finally {
        dolibarrMock.getAccountsReceivable = origGetAccountsReceivable;
        dolibarrMock.getCustomerContext = origGetCustomerContext;

        for (const patch of patches) {
            restorePatch(patch);
        }
    }
}

main()
    .then(code => {
        process.exit(code);
    })
    .catch(err => {
        console.error('Eval crashed:', err);
        process.exit(2);
    });

export type { Fixture, FixtureExpect, GoldenSet };
export type { DunningItem };
