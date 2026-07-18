import { describe, it, expect } from 'vitest';
import { pickOpencodeOrphanTargets } from '../../utils/processTree';

// #kill-per-slot (red-team Fable): seletor PURO de opencode a matar no sweep de órfãos. Ao contrário
// do chrome (estrito), aqui over-matar é seguro pré-spawn — MAS runs VIVAS (protectNeedles) são
// poupadas por needle (proteção válida desde o instante 0 do processo, sem race). Ver killOpencodeOrphans.
describe('pickOpencodeOrphanTargets', () => {
    const NEEDLES = ['.taskrunner-prompt.md', 'taskrunner-visual-judge', '[tr-run:'];
    const CL_CODER = 'opencode run "Leia o arquivo .taskrunner-prompt.md ... [tr-run:5-111]"';
    const CL_JUDGE = 'opencode run "[taskrunner-visual-judge] [tr-run:judge-5-222] ..."';
    const CL_MANUAL = 'opencode run "refatora o módulo X"'; // opencode manual de outro projeto

    it('mata quem casa um needle; POUPA opencode manual com CommandLine conhecida', () => {
        const cls = new Map<number, string>([
            [10, CL_CODER],   // órfão do coder → mata
            [20, CL_MANUAL],  // manual, não casa needle → poupa
        ]);
        const { targets, strictAbort } = pickOpencodeOrphanTargets([10, 20], cls, NEEDLES);
        expect(targets).toEqual([10]);
        expect(strictAbort).toBe(false);
    });

    it('CommandLine vazia/desconhecida → mata (over-kill seguro pré-spawn)', () => {
        const cls = new Map<number, string>([[10, '']]); // vazia
        // pid 30 nem no Map (desconhecida) → também mata
        expect(pickOpencodeOrphanTargets([10, 30], cls, NEEDLES).targets.sort()).toEqual([10, 30]);
    });

    it('protectNeedles POUPA a run viva mesmo casando um needle genérico', () => {
        const protect = ['[tr-run:5-111]']; // needle único da run VIVA #5
        const cls = new Map<number, string>([
            [10, CL_CODER],   // é a run viva #5 (casa protect) → POUPA
            [20, CL_JUDGE],   // outra run (não casa este protect) → mata
        ]);
        const { targets } = pickOpencodeOrphanTargets([10, 20], cls, NEEDLES, protect);
        expect(targets).toEqual([20]);
    });

    it('excludePids POUPA (proteção secundária, ex.: vizinho com CommandLine vazia)', () => {
        const cls = new Map<number, string>([[10, ''], [20, '']]);
        const { targets } = pickOpencodeOrphanTargets([10, 20], cls, NEEDLES, [], [20]);
        expect(targets).toEqual([10]); // 20 poupado por excludePids
    });

    it('cls == null SEM protectNeedles → over-kill de todos (comportamento #335)', () => {
        const { targets, strictAbort } = pickOpencodeOrphanTargets([10, 20], null, NEEDLES);
        expect(targets.sort()).toEqual([10, 20]);
        expect(strictAbort).toBe(false);
    });

    it('cls == null COM protectNeedles → strictAbort (NÃO over-mata o vizinho vivo)', () => {
        const { targets, strictAbort } = pickOpencodeOrphanTargets([10, 20], null, NEEDLES, ['[tr-run:5-111]']);
        expect(targets).toEqual([]);
        expect(strictAbort).toBe(true);
    });

    it('cls == null COM protectNeedles mas excludePids também respeitado? strictAbort tem precedência', () => {
        // Sem CommandLine não dá p/ distinguir; com run viva a proteger, aborta (não arrisca o vizinho).
        const { targets, strictAbort } = pickOpencodeOrphanTargets([10], null, NEEDLES, ['[tr-run:1-1]'], [10]);
        expect(strictAbort).toBe(true);
        expect(targets).toEqual([]);
    });

    it('sem processos → vazio', () => {
        expect(pickOpencodeOrphanTargets([], new Map(), NEEDLES).targets).toEqual([]);
    });
});
