import type { ImageMetadata } from '../../../types';
import { getResourceEntries, RESOURCE_GROUPS, type ResourceEntry, type ResourceGroupDefinition } from './resourceGroups';

export type ResourceDiffStatus = 'same' | 'added' | 'removed' | 'reweighted';

export interface ResourceDiffEntry extends ResourceEntry {
    status: ResourceDiffStatus;
}

export interface ResourceGroupDiff {
    group: ResourceGroupDefinition;
    a: ResourceDiffEntry[];
    b: ResourceDiffEntry[];
    changed: boolean;
}

const matchKey = (entry: ResourceEntry) => entry.name.toLowerCase();

const markEntries = (entries: ResourceEntry[], others: ResourceEntry[], missingStatus: 'added' | 'removed'): ResourceDiffEntry[] => {
    const otherByName = new Map(others.map(entry => [matchKey(entry), entry]));
    return entries.map(entry => {
        const other = otherByName.get(matchKey(entry));
        if (!other) return { ...entry, status: missingStatus };
        return { ...entry, status: other.weight === entry.weight ? 'same' : 'reweighted' };
    });
};

/** Per resource kind used by either image: which entries only one image has, and which changed weight. */
export const diffResources = (a: Partial<ImageMetadata>, b: Partial<ImageMetadata>): ResourceGroupDiff[] =>
    RESOURCE_GROUPS.flatMap(group => {
        const entriesA = getResourceEntries(a, group);
        const entriesB = getResourceEntries(b, group);
        if (entriesA.length === 0 && entriesB.length === 0) return [];
        const diffA = markEntries(entriesA, entriesB, 'removed');
        const diffB = markEntries(entriesB, entriesA, 'added');
        return [{ group, a: diffA, b: diffB, changed: [...diffA, ...diffB].some(entry => entry.status !== 'same') }];
    });
