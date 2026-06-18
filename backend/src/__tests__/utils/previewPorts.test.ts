import { describe, it, expect } from 'vitest';
import { previewPortsFor } from '../../utils/previewPorts';

describe('previewPortsFor (#374)', () => {
    it('deriva as portas frontend/backend do issueNumber', () => {
        expect(previewPortsFor(0)).toEqual({ frontendPort: 5174, backendPort: 3014 });
        expect(previewPortsFor(7)).toEqual({ frontendPort: 5181, backendPort: 3021 });
        expect(previewPortsFor(123)).toEqual({ frontendPort: 5174 + 3, backendPort: 3014 + 3 });
    });

    it('usa a MESMA fórmula que o preview serve — não a antiga 3000+(n%1000) do Judge', () => {
        // Regressão do #374: o Judge Visual montava afterUrl com 3000+(n%1000), uma porta sem
        // servidor, enquanto startPreview servia em 5174+(n%10). Agora ambos derivam daqui.
        for (const n of [1, 9, 42, 100, 2050]) {
            const { frontendPort } = previewPortsFor(n);
            expect(frontendPort).toBe(5174 + (n % 10));
            expect(frontendPort).not.toBe(3000 + (n % 1000));
        }
    });
});
