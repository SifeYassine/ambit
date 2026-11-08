import { useCallback, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
    deleteSimilarityModel,
    downloadSimilarityModel,
    indexSimilarityEmbeddings,
} from '../../../services/similarityService';
import type { SyncProgress } from '../../../stores/libraryStore';
import { useSimilarityStore } from '../../../stores/similarityStore';
import { listenWithCleanup } from '../../../utils/tauriListener';
import { SIMILARITY_STATUS_KEY, useSimilarityStatus } from './useSimilarity';

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * The model download and library indexing jobs. Their progress lives in the similarity store, so
 * a job keeps reporting after the page is left and shows again when it reopens.
 */
export const useSimilarityJobs = () => {
    const queryClient = useQueryClient();
    const refreshStatus = useCallback(
        () => queryClient.invalidateQueries({ queryKey: SIMILARITY_STATUS_KEY }),
        [queryClient]
    );

    const index = useCallback(async () => {
        const store = useSimilarityStore.getState();
        if (store.isIndexing) return;
        store.setJobError(null);
        store.setIndexState({ isIndexing: true, indexProgress: null });
        const listener = listenWithCleanup<SyncProgress>(
            'similarity_index_progress',
            event => useSimilarityStore.getState().setIndexState({ isIndexing: true, indexProgress: event.payload }),
            'Similarity index progress'
        );
        try {
            await listener.ready;
            const result = await indexSimilarityEmbeddings();
            useSimilarityStore.getState().setIndexState({ isIndexing: true, lastIndexResult: result });
        } catch (error) {
            useSimilarityStore.getState().setJobError(errorMessage(error));
        } finally {
            listener.cleanup();
            useSimilarityStore.getState().setIndexState({ isIndexing: false, indexProgress: null });
            await refreshStatus();
        }
    }, [refreshStatus]);

    /** Downloads the model, then indexes the library. Returns whether the download completed. */
    const download = useCallback(async (): Promise<boolean> => {
        const store = useSimilarityStore.getState();
        if (store.isDownloading) return false;
        store.setJobError(null);
        store.setDownloadState({ isDownloading: true, downloadProgress: null });
        const listener = listenWithCleanup<SyncProgress>(
            'similarity_model_download_progress',
            event => useSimilarityStore.getState().setDownloadState({ isDownloading: true, downloadProgress: event.payload }),
            'Similarity model download progress'
        );
        let completed = false;
        try {
            await listener.ready;
            await downloadSimilarityModel();
            completed = true;
        } catch (error) {
            useSimilarityStore.getState().setJobError(errorMessage(error));
        } finally {
            listener.cleanup();
            useSimilarityStore.getState().setDownloadState({ isDownloading: false });
            await refreshStatus();
        }
        if (completed) await index();
        return completed;
    }, [index, refreshStatus]);

    const removeModel = useCallback(async () => {
        useSimilarityStore.getState().setJobError(null);
        try {
            await deleteSimilarityModel();
        } catch (error) {
            useSimilarityStore.getState().setJobError(errorMessage(error));
        } finally {
            await refreshStatus();
        }
    }, [refreshStatus]);

    return { download, index, removeModel };
};

/**
 * Like SmartSim indexing on upload: images added since the last visit are indexed when the page
 * opens. Indexing can be stopped at any time and resumes where it left off.
 */
export const useAutoIndexing = (index: () => Promise<void>) => {
    const { data: status } = useSimilarityStatus();
    const isIndexing = useSimilarityStore(state => state.isIndexing);
    const isDownloading = useSimilarityStore(state => state.isDownloading);
    const started = useRef(false);
    const pending = status?.pendingCount ?? 0;
    useEffect(() => {
        if (started.current || !status?.modelInstalled || pending === 0 || isIndexing || isDownloading) return;
        started.current = true;
        void index();
    }, [index, isDownloading, isIndexing, pending, status?.modelInstalled]);
};
