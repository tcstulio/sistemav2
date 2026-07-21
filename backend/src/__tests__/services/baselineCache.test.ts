import { describe, it, expect } from 'vitest';

// Testa a lógica de serialização do cache de baseline do captureBaseline SEM fs (o setup global
// mocka fs). O atomicWriteSync grava `JSON.stringify(data, null, 2)` — então o CONTEÚDO do arquivo,
// dado um objeto, é JSON.stringify(obj). O bug: captureBaseline passava JSON.stringify(obj) →
// atomicWriteSync stringificava DE NOVO → arquivo = string double-encoded.

// espelha o que o atomicWriteSync grava no arquivo p/ um `data` qualquer:
const fileContentFor = (data: unknown) => JSON.stringify(data, null, 2);

// espelha o read do captureBaseline (com a defesa contra cache legado double-encoded):
function readCache(content: string): { errors?: unknown; globals?: unknown } {
    let c = JSON.parse(content);
    if (typeof c === 'string') c = JSON.parse(c);
    return c;
}

describe('captureBaseline — cache de baseline (double-stringify fix)', () => {
    const errors = ['a.ts(1,1): erro X', 'b.ts(2,2): erro Y'];
    const globals = ['glob1'];

    it('FIX: grava o OBJETO → cache-hit lê errors/globals corretos', () => {
        // como o captureBaseline grava AGORA: atomicWriteSync(cacheFile, { errors, globals })
        const content = fileContentFor({ errors, globals });
        const c = readCache(content);
        expect(c.errors).toEqual(errors); // ANTES vinha undefined → baseline VAZIO
        expect(c.globals).toEqual(globals);
    });

    it('REGRESSÃO: o bug antigo (JSON.stringify → atomicWriteSync) gravava string double-encoded', () => {
        // como o captureBaseline gravava ANTES: atomicWriteSync(cacheFile, JSON.stringify({ errors, globals }))
        const content = fileContentFor(JSON.stringify({ errors, globals }));
        const naive = JSON.parse(content);
        expect(typeof naive).toBe('string');           // prova o double-encode
        expect((naive as any).errors).toBeUndefined();  // read ingênuo → baseline vazio (o bug)
        // a DEFESA do fix (re-parse se string) recupera o cache legado sem recomputar:
        expect(readCache(content).errors).toEqual(errors);
    });
});
