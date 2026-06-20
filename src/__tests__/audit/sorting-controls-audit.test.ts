import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Auditoria #575: garante que NENHUMA tela de lista renderiza um <select> de
// ordenação ou botão de direção fora do ListToolbar. Toda UI de ordenação deve
// passar pelo componente padronizado (src/components/ui/ListToolbar.tsx).
//
// Este teste codifica a conclusão da auditoria como um invariant de regressão:
// se alguém introduzir um controle de ordenação manual (ícones ArrowDownAZ/
// ArrowUpAZ ou os affordances "Ordenar por"/"Inverter ordem") fora do
// ListToolbar, o teste falha apontando o arquivo responsável.

const here = path.dirname(fileURLToPath(import.meta.url));
const componentsDir = path.resolve(here, '../../components');

interface SourceFile {
    rel: string;
    content: string;
}

function normalize(p: string): string {
    return p.replace(/\\/g, '/');
}

function listComponentFiles(): SourceFile[] {
    return readdirSync(componentsDir, { recursive: true })
        .map((f) => normalize(String(f)))
        .filter((f) => f.endsWith('.tsx'))
        .map((rel) => ({
            rel,
            content: readFileSync(path.join(componentsDir, rel), 'utf8'),
        }));
}

const ALL_FILES = listComponentFiles();

// Marcadores que caracterizam um controle de ordenação manual (select de campo
// + botão de direção), todos presentes apenas no ListToolbar.
const SORT_DIRECTION_ICONS = ['ArrowDownAZ', 'ArrowUpAZ'];
const SORT_AFFORDANCES = ['Ordenar por', 'Inverter ordem'];

function filesContainingAny(needles: string[]): SourceFile[] {
    return ALL_FILES.filter((f) => needles.some((n) => f.content.includes(n)));
}

// Listas verificadas que JÁ usam ListToolbar (devem importá-lo).
const LISTS_USING_TOOLBAR = [
    'VenueList.tsx',
    'CustomerList.tsx',
    'ProductList.tsx',
    'InvoiceList.tsx',
    'ProposalList.tsx',
    'OrderList.tsx',
    'SupplierList.tsx',
    'ContactList.tsx',
    'CategoryList.tsx',
    'ContractList.tsx',
    'TicketList.tsx',
    'ShipmentList.tsx',
    'InterventionList.tsx',
    'BankAccountList.tsx',
    'HRList.tsx',
    'SupplierInvoiceList.tsx',
    'SupplierProposalList.tsx',
    'SupplierPaymentList.tsx',
    'PaymentList.tsx',
    'Finance/TaxPaymentList.tsx',
    'Finance/ExpenseReportPaymentList.tsx',
    'HR/SalaryPaymentList.tsx',
];

// Listas verificadas que NÃO usam ListToolbar e estavam corretas na auditoria
// (sem UI de ordenação manual). Se alguma delas passar a ter, o invariant abaixo
// dispara — este array apenas documenta o conjunto verificado.
const LISTS_WITHOUT_TOOLBAR_AUDITED = [
    'WarehouseList.tsx',
    'ProjectList.tsx',
    'CentroVibe/ClusterList.tsx',
    'CentroVibe/ArtistList.tsx',
    'whatsapp/ConversationList.tsx',
    'HR/tabs/RecruitmentCandidatesList.tsx',
    'HR/tabs/RecruitmentJobsList.tsx',
    'Email/EmailList.tsx',
    'Email/EmailAccountList.tsx',
];

const TOOLBAR_REL = 'ui/ListToolbar.tsx';

describe('Auditoria #575 — controles de ordenação centralizados no ListToolbar', () => {
    it('todos os arquivos .tsx foram indexados (sanity)', () => {
        expect(ALL_FILES.length).toBeGreaterThan(0);
        expect(ALL_FILES.some((f) => f.rel === TOOLBAR_REL)).toBe(true);
    });

    it('apenas o ListToolbar importa os ícones de direção de ordenação', () => {
        const offenders = filesContainingAny(SORT_DIRECTION_ICONS).map((f) => f.rel);
        expect(offenders).toEqual([TOOLBAR_REL]);
    });

    it('apenas o ListToolbar usa os affordances "Ordenar por" / "Inverter ordem"', () => {
        const offenders = filesContainingAny(SORT_AFFORDANCES).map((f) => f.rel);
        expect(offenders).toEqual([TOOLBAR_REL]);
    });

    it('nenhuma lista fora do ListToolbar implementa controle de ordenação manual', () => {
        const allMarkers = [...SORT_DIRECTION_ICONS, ...SORT_AFFORDANCES];
        const offenders = ALL_FILES
            .filter((f) => f.rel !== TOOLBAR_REL)
            .filter((f) => allMarkers.some((m) => f.content.includes(m)))
            .map((f) => f.rel);
        expect(offenders).toEqual([]);
    });

    it('todas as listas documentadas importam o ListToolbar', () => {
        const missing = LISTS_USING_TOOLBAR.filter((rel) => {
            const file = ALL_FILES.find((f) => f.rel === rel);
            return !file || !file.content.includes('ListToolbar');
        });
        expect(missing, `Listas sem import do ListToolbar: ${missing.join(', ')}`).toEqual([]);
    });

    it('listas auditadas sem ListToolbar não possuem UI de ordenação manual', () => {
        const allMarkers = [...SORT_DIRECTION_ICONS, ...SORT_AFFORDANCES];
        const offenders = LISTS_WITHOUT_TOOLBAR_AUDITED
            .map((rel) => ALL_FILES.find((f) => f.rel === rel))
            .filter((f): f is SourceFile => !!f)
            .filter((f) => allMarkers.some((m) => f.content.includes(m)))
            .map((f) => f.rel);
        expect(offenders).toEqual([]);
    });
});
