// Janela de PICO do Z.AI/GLM (consumo 3x da cota): 14:00–18:00 UTC+8 = 06:00–10:00 UTC.
// Função pura (testável) — o TaskRunner usa com a hora UTC atual para segurar o dispatch no pico.

/** true se `utcHour` (0–23) está na janela [startUtc, endUtc). Suporta wrap-around (start > end). */
export function isPeakUtcHour(utcHour: number, startUtc: number, endUtc: number): boolean {
  return startUtc <= endUtc
    ? utcHour >= startUtc && utcHour < endUtc
    : utcHour >= startUtc || utcHour < endUtc;
}
