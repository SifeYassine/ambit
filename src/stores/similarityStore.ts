import { create } from 'zustand';
import type { ClusterOptions, SimilarityIndexResult, SimilarityQuery } from '../bindings';
import type { AIImage } from '../types';
import type { SyncProgress } from './libraryStore';

/** SmartSim's defaults. */
export const DEFAULT_TOP_K = 5;
export const DEFAULT_THRESHOLD = 0.12;
export const MAX_TOP_K = 100;

export type ImageQuery =
    | { kind: 'libraryImage'; image: AIImage }
    | { kind: 'file'; path: string };

export type SimilarityTab = 'search' | 'cluster';

/** SmartSim's clustering inputs, kept as typed text so empty means "not set". */
export interface ClusterInputs {
    maxClusters: string;
    threshold: string;
    minImages: string;
    maxImages: string;
}

/**
 * A search the user ran. Results are React Query data keyed by this request; `runId` makes
 * pressing Search again re-run it, as in SmartSim.
 */
export interface SubmittedSearch {
    query: SimilarityQuery;
    label: string;
    topK: number;
    threshold: number;
    runId: number;
}

export interface SubmittedClustering {
    options: ClusterOptions;
    runId: number;
}

interface SimilarityState {
    tab: SimilarityTab;
    topK: number;
    threshold: number;
    textQuery: string;
    imageQuery: ImageQuery | null;
    /** Set by "Find similar" in the viewer; the page submits it once it has a search scope. */
    pendingImageSearch: boolean;
    submittedSearch: SubmittedSearch | null;
    clusterInputs: ClusterInputs;
    submittedClustering: SubmittedClustering | null;
    clusterIndex: number;

    isDownloading: boolean;
    downloadProgress: SyncProgress | null;
    isIndexing: boolean;
    indexProgress: SyncProgress | null;
    lastIndexResult: SimilarityIndexResult | null;
    jobError: string | null;

    setTab: (tab: SimilarityTab) => void;
    setTopK: (topK: number) => void;
    setThreshold: (threshold: number) => void;
    setTextQuery: (text: string) => void;
    setImageQuery: (query: ImageQuery | null) => void;
    findSimilarTo: (image: AIImage) => void;
    submitTextSearch: () => void;
    submitImageSearch: () => void;
    clearSearch: () => void;
    setClusterInput: (field: keyof ClusterInputs, value: string) => void;
    submitClustering: () => void;
    setClusterIndex: (index: number) => void;
    clearClusters: () => void;
    setDownloadState: (state: { isDownloading: boolean; downloadProgress?: SyncProgress | null }) => void;
    setIndexState: (state: { isIndexing: boolean; indexProgress?: SyncProgress | null; lastIndexResult?: SimilarityIndexResult }) => void;
    setJobError: (message: string | null) => void;
}

const imageQueryLabel = (query: ImageQuery): string =>
    query.kind === 'file' ? query.path.split(/[\\/]/).pop() ?? query.path : query.image.filename;

const parseOptionalNumber = (value: string): number | null => {
    const parsed = Number(value);
    return value.trim() && Number.isFinite(parsed) ? parsed : null;
};

let nextRunId = 0;

// Kept across visits so results and inputs survive opening an image and coming back. Lives in
// src/stores so App can hand over "Find similar" without loading the lazily loaded page.
export const useSimilarityStore = create<SimilarityState>((set, get) => ({
    tab: 'search',
    topK: DEFAULT_TOP_K,
    threshold: DEFAULT_THRESHOLD,
    textQuery: '',
    imageQuery: null,
    pendingImageSearch: false,
    submittedSearch: null,
    clusterInputs: { maxClusters: '', threshold: '', minImages: '', maxImages: '' },
    submittedClustering: null,
    clusterIndex: 0,

    isDownloading: false,
    downloadProgress: null,
    isIndexing: false,
    indexProgress: null,
    lastIndexResult: null,
    jobError: null,

    setTab: tab => set({ tab }),
    setTopK: topK => set({ topK }),
    setThreshold: threshold => set({ threshold }),
    setTextQuery: textQuery => set({ textQuery }),
    setImageQuery: imageQuery => set({ imageQuery }),
    findSimilarTo: image => set({ tab: 'search', imageQuery: { kind: 'libraryImage', image }, pendingImageSearch: true }),

    submitTextSearch: () => {
        const { textQuery, topK, threshold } = get();
        const text = textQuery.trim();
        if (!text) return;
        set({ submittedSearch: { query: { kind: 'text', text }, label: `"${text}"`, topK, threshold, runId: ++nextRunId } });
    },

    submitImageSearch: () => {
        const { imageQuery, topK, threshold } = get();
        set({ pendingImageSearch: false });
        if (!imageQuery) return;
        const query: SimilarityQuery = imageQuery.kind === 'file'
            ? { kind: 'file', path: imageQuery.path }
            : { kind: 'libraryImage', imageId: imageQuery.image.id };
        set({ submittedSearch: { query, label: imageQueryLabel(imageQuery), topK, threshold, runId: ++nextRunId } });
    },

    clearSearch: () => set({ submittedSearch: null }),

    setClusterInput: (field, value) => set(state => ({ clusterInputs: { ...state.clusterInputs, [field]: value } })),

    submitClustering: () => {
        const inputs = get().clusterInputs;
        set({
            clusterIndex: 0,
            submittedClustering: {
                options: {
                    maxClusters: parseOptionalNumber(inputs.maxClusters),
                    similarityThreshold: parseOptionalNumber(inputs.threshold),
                    minImages: parseOptionalNumber(inputs.minImages),
                    maxImages: parseOptionalNumber(inputs.maxImages),
                },
                runId: ++nextRunId,
            },
        });
    },

    setClusterIndex: clusterIndex => set({ clusterIndex }),
    clearClusters: () => set({ submittedClustering: null, clusterIndex: 0 }),

    setDownloadState: state => set(state),
    setIndexState: state => set(state),
    setJobError: jobError => set({ jobError }),
}));
