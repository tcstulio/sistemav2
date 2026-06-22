import { describe, it, expect } from 'vitest';
import { isPeakUtcHour } from '../../utils/peakWindow';

describe('isPeakUtcHour', () => {
  // Janela real do Z.AI: 06:00–10:00 UTC (= 03:00–07:00 BRT = 14:00–18:00 UTC+8).
  const START = 6;
  const END = 10;

  it('marca como pico as horas dentro de [06:00, 10:00) UTC', () => {
    expect(isPeakUtcHour(6, START, END)).toBe(true);   // 03:00 BRT — início
    expect(isPeakUtcHour(7, START, END)).toBe(true);
    expect(isPeakUtcHour(9, START, END)).toBe(true);   // 06:00 BRT — ainda pico
  });

  it('NÃO marca como pico as horas fora da janela (off-peak = 1x)', () => {
    expect(isPeakUtcHour(10, START, END)).toBe(false); // 07:00 BRT — fim (exclusivo)
    expect(isPeakUtcHour(5, START, END)).toBe(false);  // 02:00 BRT
    expect(isPeakUtcHour(13, START, END)).toBe(false); // 10:00 BRT — horário comercial BR
    expect(isPeakUtcHour(0, START, END)).toBe(false);
    expect(isPeakUtcHour(23, START, END)).toBe(false);
  });

  it('suporta janela com wrap-around (start > end)', () => {
    // Ex.: pico 22:00–02:00 UTC
    expect(isPeakUtcHour(23, 22, 2)).toBe(true);
    expect(isPeakUtcHour(1, 22, 2)).toBe(true);
    expect(isPeakUtcHour(2, 22, 2)).toBe(false);
    expect(isPeakUtcHour(12, 22, 2)).toBe(false);
  });
});
