import { describe, it, expect } from 'vitest';
import { childrenOf, aggregateProgress } from '../../components/Tasks/taskProgress';

const tasks = [
    { id: 'a', fk_parent: '50', progress: 100 },
    { id: 'b', fk_parent: '50', progress: 0 },
    { id: 'c', fk_parent: '99', progress: 50 },
    { id: '50', progress: 30 }, // a própria mãe (sem fk_parent)
];

describe('childrenOf', () => {
    it('retorna apenas as filhas da mãe', () => {
        const kids = childrenOf(tasks, '50');
        expect(kids.map((k) => k.id)).toEqual(['a', 'b']);
    });

    it('ignora tarefas sem fk_parent e de outra mãe', () => {
        expect(childrenOf(tasks, '50')).toHaveLength(2);
        expect(childrenOf(tasks, '99').map((k) => k.id)).toEqual(['c']);
    });
});

describe('aggregateProgress', () => {
    it('média arredondada das filhas', () => {
        expect(aggregateProgress(childrenOf(tasks, '50'))).toBe(50); // (100+0)/2
    });

    it('null quando não há passos', () => {
        expect(aggregateProgress([])).toBeNull();
        expect(aggregateProgress(childrenOf(tasks, 'inexistente'))).toBeNull();
    });

    it('arredonda corretamente', () => {
        expect(aggregateProgress([{ progress: 10 }, { progress: 20 }, { progress: 25 }])).toBe(18); // 55/3 = 18.33
    });
});
