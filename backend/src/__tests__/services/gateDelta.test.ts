import { describe, it, expect } from 'vitest';
import {
    parseTscErrors, parseGlobalTscErrors, serializeErrors, deserializeErrors,
    newErrors, isTouched, computeBlocking,
} from '../../services/gateDelta';

// Amostra REAL do formato do tsc (inclui o caso heic2any que reprovava TODA task antes do item-1).
const SAMPLE = [
    "src/components/VirtualAssistant.tsx(116,38): error TS2307: Cannot find module 'heic2any'.",
    "src/components/VirtualAssistant.tsx(200,10): error TS2307: Cannot find module 'heic2any'.",
    "backend/src/services/foo.ts(10,5): error TS2345: Argument of type 'x' is not assignable.",
].join('\n');
const WITH_FOOTER = SAMPLE + "\n\nFound 3 errors in 2 files.\n";
const HEIC = "src/components/VirtualAssistant.tsx|TS2307|Cannot find module 'heic2any'.";
const FOO = "backend/src/services/foo.ts|TS2345|Argument of type 'x' is not assignable.";

describe('gateDelta — parseTscErrors', () => {
    it('extrai chave estável (arquivo|code|msg) e conta ocorrências', () => {
        const m = parseTscErrors(SAMPLE);
        expect(m.get(HEIC)).toBe(2); // mesma msg, linhas diferentes → mesma chave
        expect(m.get(FOO)).toBe(1);
        expect(m.size).toBe(2);
    });
    it('footer "Found N errors" NÃO vira erro', () => {
        expect(parseTscErrors(WITH_FOOTER).size).toBe(2);
    });
    it('normaliza backslash do Windows na chave', () => {
        expect([...parseTscErrors('src\\a\\b.ts(1,1): error TS1000: x').keys()][0]).toBe('src/a/b.ts|TS1000|x');
    });
});

describe('gateDelta — parseGlobalTscErrors (erros sem posição)', () => {
    it('pega erro global TS18003', () => {
        expect(parseGlobalTscErrors("error TS18003: No inputs were found in config file 'tsconfig.json'."))
            .toEqual(["TS18003|No inputs were found in config file 'tsconfig.json'."]);
    });
    it('erros POSICIONAIS não viram globais (sem dupla contagem)', () => {
        expect(parseGlobalTscErrors(SAMPLE)).toEqual([]);
    });
    it('footer não é global; pega múltiplos globais', () => {
        expect(parseGlobalTscErrors(WITH_FOOTER)).toEqual([]);
        expect(parseGlobalTscErrors("error TS6053: File 'x.ts' not found.\nerror TS18003: nada"))
            .toEqual(["TS6053|File 'x.ts' not found.", 'TS18003|nada']);
    });
});

describe('gateDelta — serialize/deserialize + newErrors', () => {
    it('round-trip preserva contagens', () => {
        const m = parseTscErrors(SAMPLE);
        expect(deserializeErrors(serializeErrors(m))).toEqual(m);
    });
    it('newErrors ignora pré-existentes, sinaliza só o novo', () => {
        const baseline = parseTscErrors(SAMPLE);
        const current = parseTscErrors(SAMPLE + "\nsrc/novo.ts(3,3): error TS9999: novo erro");
        expect(newErrors(current, baseline)).toEqual(['src/novo.ts|TS9999|novo erro']);
    });
    it('newErrors count-aware: 3ª ocorrência do heic vira 1 novo', () => {
        const baseline = parseTscErrors(SAMPLE);
        const current = parseTscErrors(SAMPLE + "\nsrc/components/VirtualAssistant.tsx(9,9): error TS2307: Cannot find module 'heic2any'.");
        expect(newErrors(current, baseline)).toEqual([HEIC]);
    });
    it('baseline vazio → estrito (todos os atuais); sem erros atuais → vazio', () => {
        expect(newErrors(parseTscErrors(SAMPLE), new Map()).length).toBe(3);
        expect(newErrors(new Map(), parseTscErrors(SAMPLE))).toEqual([]);
    });
});

describe('gateDelta — isTouched (casamento de path tsc × git diff)', () => {
    it('casa igual, e por sufixo (tsc relativo ao tsconfig vs git diff relativo à raiz)', () => {
        expect(isTouched('backend/src/foo.ts', new Set(['backend/src/foo.ts']))).toBe(true);
        expect(isTouched('src/services/foo.ts', new Set(['backend/src/services/foo.ts']))).toBe(true);
        expect(isTouched('backend\\src\\foo.ts', new Set(['backend/src/foo.ts']))).toBe(true);
    });
    it('não casa arquivo diferente no mesmo dir', () => {
        expect(isTouched('src/components/A.tsx', new Set(['src/components/B.tsx']))).toBe(false);
    });
});

describe('gateDelta — computeBlocking (v2: filtro por arquivo tocado)', () => {
    const base = parseTscErrors(SAMPLE); // 2 heic (VirtualAssistant) + 1 foo.ts
    it('erro novo em arquivo TOCADO → bloqueia', () => {
        const cur = parseTscErrors(SAMPLE + "\nbackend/src/services/foo.ts(99,9): error TS1111: novo em foo");
        expect(computeBlocking(cur, base, [], [], ['backend/src/services/foo.ts']))
            .toEqual(['backend/src/services/foo.ts|TS1111|novo em foo']);
    });
    it('erro novo em arquivo NÃO tocado (outro PR/cascata) → ignora [mata furo 1 e 4]', () => {
        const cur = parseTscErrors(SAMPLE + "\nbackend/src/services/bar.ts(1,1): error TS2222: erro de outro PR");
        expect(computeBlocking(cur, base, [], [], ['backend/src/services/foo.ts'])).toEqual([]);
    });
    it('pré-existente em arquivo tocado (no baseline) → ignora', () => {
        expect(computeBlocking(base, base, [], [], ['backend/src/services/foo.ts'])).toEqual([]);
    });
    it('estrito (baseline vazio): só o erro do arquivo tocado bloqueia [mitiga furo 2]', () => {
        expect(computeBlocking(parseTscErrors(SAMPLE), new Map(), [], [], ['backend/src/services/foo.ts']))
            .toEqual([FOO]); // o heic (em arquivo NÃO tocado) é ignorado mesmo sem baseline
    });
    it('erro GLOBAL novo → bloqueia SEMPRE; global pré-existente → ignora', () => {
        expect(computeBlocking(new Map(), new Map(), ['TS18003|broken tsconfig'], [], []))
            .toEqual(['TS18003|broken tsconfig']);
        expect(computeBlocking(new Map(), new Map(), ['TS18003|x'], ['TS18003|x'], [])).toEqual([]);
    });
    it('path do tsc relativo ao tsconfig casa com git diff por sufixo', () => {
        expect(computeBlocking(parseTscErrors('src/services/foo.ts(1,1): error TS1: x'), new Map(), [], [], ['backend/src/services/foo.ts']))
            .toEqual(['src/services/foo.ts|TS1|x']);
    });
});
