/**
 * Sanitiza o valor bruto (string) de um input numérico para uso em payloads
 * de mutação (qty de pedido, linha de fatura, etc.).
 *
 * Garante que o backend NUNCA receba `NaN` no body (o que geraria erro 400
 * ou sanitização silenciosa para 0 no servidor).
 *
 * Comportamento:
 * - `''`           → 0   (campo apagado)
 * - `'abc'`        → 0   (parseInt não converte → NaN, cai no fallback)
 * - `'5'`          → 5
 * - `'5abc'`       → 5   (parseInt extrai dígitos iniciais)
 * - `'5.5'`        → 5   (parseInt trunca decimal)
 * - `'-3'`         → -3
 *
 * Equivalente em uma linha: `raw === '' ? 0 : parseInt(raw) || 0` — porém
 * isolado em função pura para (a) ser diretamente testável (cobre o caminho
 * `NaN` que o `<input type="number">` do jsdom esconde via sanitização
 * automática de caracteres não-numéricos) e (b) evitar `||` em encadeamento.
 *
 * @see https://github.com/tcstulio/sistemav2/issues/1582
 */
export function sanitizeQtyInput(raw: string): number {
    if (raw === '') return 0;
    const parsed = parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : 0;
}