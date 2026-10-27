import { describe, expect, it } from 'vitest';
import { diffResources } from '../resourceDiff';
import { parseResourceEntry } from '../resourceGroups';

describe('parseResourceEntry', () => {
    it('reads weights from the name or the weight map, to two decimals', () => {
        expect(parseResourceEntry('style (0.8)')).toEqual({ name: 'style', weight: '0.80' });
        expect(parseResourceEntry('frostbite', { frostbite: 0.7500000000000001 })).toEqual({ name: 'frostbite', weight: '0.75' });
        expect(parseResourceEntry('detail.safetensors')).toEqual({ name: 'detail', weight: null });
    });
});

describe('diffResources', () => {
    it('marks removed, added, and re-weighted entries per resource kind', () => {
        const diffs = diffResources(
            { loras: ['frostbite', 'moriimee'], loraWeights: { frostbite: 1, moriimee: 0.5 }, controlNets: ['openpose'] },
            { loras: ['Frostbite', 'gothic'], loraWeights: { Frostbite: 0.75, gothic: 1 }, controlNets: ['openpose'] },
        );

        expect(diffs.map(diff => diff.group.key)).toEqual(['loras', 'controlNets']);
        const [loras, controlNets] = diffs;
        expect(loras.a.map(entry => [entry.name, entry.status])).toEqual([['frostbite', 'reweighted'], ['moriimee', 'removed']]);
        expect(loras.b.map(entry => [entry.name, entry.status])).toEqual([['Frostbite', 'reweighted'], ['gothic', 'added']]);
        expect(loras.changed).toBe(true);
        expect(controlNets.a[0].status).toBe('same');
        expect(controlNets.changed).toBe(false);
    });

    it('skips resource kinds neither image uses', () => {
        expect(diffResources({ loras: [] }, {})).toEqual([]);
    });
});
