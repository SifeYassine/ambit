import type { Facets } from './searchRepo';

/** A Facets object with every section empty, kept apart from searchRepo so it has no DB imports. */
export const emptyFacets = (): Facets => ({
    checkpoints: [], loras: [], embeddings: [], hypernetworks: [], controlNets: [], ipAdapters: [], tools: [],
    vaes: [], upscalers: [], clipVisions: [], detectors: [],
});
