/**
 * #1547 — Declaração ambiente mínima para `sharp` (libvips).
 *
 * `sharp` é uma dependência de sistema OPCIONAL do renderer de PDF (fallback entre
 * `pdftoppm` e `pdf-parse`): NÃO é uma dependency do projeto e não há `@types/sharp`.
 * Declaramos aqui um módulo ambiente enxuto (apenas a superfície usada por
 * `services/analyzePdf.ts`) para que `await import('sharp')` passe no type-check sem
 * recorrer a `require` + `any` + `eslint-disable`. Em runtime, se o pacote não estiver
 * instalado, o `import()` rejeita e o renderer falha graciosamente (a próxima camada
 * assume). Se `sharp` vier a ser adicionado como dependency com tipos próprios, este
 * arquivo pode ser removido.
 */
declare module 'sharp' {
    export interface SharpImage {
        png(): SharpImage;
        toBuffer(): Promise<Buffer>;
    }
    export interface SharpOptions {
        page?: number;
        density?: number;
    }
    export default function sharp(input: Buffer, options?: SharpOptions): SharpImage;
}
