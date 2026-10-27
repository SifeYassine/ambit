import type { ImageMetadata } from '../../../types';

type ResourceListKey = 'loras' | 'embeddings' | 'hypernetworks' | 'controlNets' | 'ipAdapters'
    | 'vaes' | 'upscalers' | 'clipVisions' | 'detectors';
type ResourceWeightsKey = 'loraWeights' | 'controlNetWeights' | 'ipAdapterWeights';

export interface ResourceGroupDefinition {
    key: ResourceListKey;
    title: string;
    /** Parsers that keep names weightless store weights here, keyed by the exact list entry. */
    weightsKey?: ResourceWeightsKey;
}

/** The resource kinds shown by the viewer and the comparer, in display order. */
export const RESOURCE_GROUPS: readonly ResourceGroupDefinition[] = [
    { key: 'loras', title: 'LoRAs', weightsKey: 'loraWeights' },
    { key: 'embeddings', title: 'Embeddings' },
    { key: 'hypernetworks', title: 'Hypernetworks' },
    { key: 'controlNets', title: 'ControlNets', weightsKey: 'controlNetWeights' },
    { key: 'ipAdapters', title: 'IP adapters', weightsKey: 'ipAdapterWeights' },
    { key: 'vaes', title: 'VAEs' },
    { key: 'upscalers', title: 'Upscale models' },
    { key: 'clipVisions', title: 'CLIP Vision' },
    { key: 'detectors', title: 'Detection models' },
];

export interface ResourceEntry {
    name: string;
    /** Two-decimal weight label, or null when the resource has no recorded weight. */
    weight: string | null;
}

// A1111-style names carry their weight: `Frostbite (0.80)`.
const WEIGHT_SUFFIX = /\s+\((-?\d+(?:\.\d+)?)\)$/;
const RESOURCE_EXTENSION = /\.(safetensors|pt|ckpt)$/i;

/** Weights print to two decimals, so 0.8 and 0.80000001 read and compare the same. */
export const formatResourceWeight = (weight: number): string => weight.toFixed(2);

export const parseResourceEntry = (item: string, weights?: Partial<Record<string, number>>): ResourceEntry => {
    const suffix = item.match(WEIGHT_SUFFIX)?.[1];
    const name = (suffix ? item.replace(WEIGHT_SUFFIX, '').trim() : item).replace(RESOURCE_EXTENSION, '');
    if (suffix !== undefined) return { name, weight: formatResourceWeight(Number(suffix)) };
    const stored = weights?.[item];
    return { name, weight: typeof stored === 'number' && Number.isFinite(stored) ? formatResourceWeight(stored) : null };
};

export const getResourceWeights = (metadata: Partial<ImageMetadata>, group: ResourceGroupDefinition) =>
    group.weightsKey ? metadata[group.weightsKey] : undefined;

/** The named resources of one kind, with weights from the name or the parser's weight map. */
export const getResourceEntries = (metadata: Partial<ImageMetadata>, group: ResourceGroupDefinition): ResourceEntry[] => {
    const items = metadata[group.key];
    if (!Array.isArray(items)) return [];
    const weights = getResourceWeights(metadata, group);
    return items.filter((item): item is string => typeof item === 'string').map(item => parseResourceEntry(item, weights));
};
