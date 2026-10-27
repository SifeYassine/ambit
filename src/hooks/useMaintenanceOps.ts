import * as React from 'react';
import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AIImage } from '../types';
import { useToast } from './useToast';
import { useLibraryStore } from '../stores/libraryStore';
import {
    refreshFacetCacheForResourcesStrict,
    removeImagesFromLibrary,
} from '../services/db/imageRepo';
import { removeImagesFromQueryCaches } from '../utils/imageQueryCache';
import type { ActiveImageStateAdapter } from './activeImageState';
import { invalidateInvokeReferenceQueries } from '../services/db/invokeReferenceRepo';

interface UseMaintenanceOpsProps {
    images: AIImage[];
    setImages: React.Dispatch<React.SetStateAction<AIImage[]>>;
    refreshCollections: () => Promise<void>;
    activeImageState?: ActiveImageStateAdapter;
}

export const useMaintenanceOps = ({
    images,
    setImages,
    refreshCollections,
    activeImageState
}: UseMaintenanceOpsProps) => {
    const { addToast } = useToast();
    const queryClient = useQueryClient();
    const incrementFacetCacheVersion = useLibraryStore(state => state.incrementFacetCacheVersion);

    const deleteImages = useCallback(async (ids: string[]): Promise<boolean> => {
        const logPrefix = '[MaintenanceOps] removeFromLibrary';
        let rebuildSucceeded = false;

        try {
            console.info(`${logPrefix}: tombstoning images`, { count: ids.length });
            const result = await removeImagesFromLibrary(ids);
            const affectedIds = new Set(result.affectedIds);
            setImages(prev => prev.filter(img => !affectedIds.has(img.id)));
            removeImagesFromQueryCaches(queryClient, affectedIds);
            addToast(`Removed ${affectedIds.size} item${affectedIds.size === 1 ? '' : 's'} from the library`, 'success');

            try {
                console.info(`${logPrefix}: refreshing collections`);
                await refreshCollections();
            } catch (collectionRefreshError) {
                console.error(`${logPrefix}: collection refresh failed`, collectionRefreshError);
                addToast('Removed from library, but collections may need a refresh.', 'warning');
            }

            try {
                await Promise.all([
                    queryClient.invalidateQueries({ queryKey: ['images'] }),
                    invalidateInvokeReferenceQueries(queryClient),
                ]);
            } catch (queryRefreshError) {
                console.error(`${logPrefix}: dependent view refresh failed`, queryRefreshError);
                addToast('Removed from library, but some views may need a refresh.', 'warning');
            }

            try {
                console.info(`${logPrefix}: refreshing affected facet resources`);
                await refreshFacetCacheForResourcesStrict(result.touchedResources);
                rebuildSucceeded = true;
            } catch (facetError) {
                console.error(`${logPrefix}: facet refresh failed`, facetError);
            }

            if (rebuildSucceeded) {
                incrementFacetCacheVersion();
            } else {
                addToast('Library update succeeded, but filters may take a moment to refresh.', 'info');
            }
            return true;
        } catch (e) {
            console.error(`${logPrefix}: mutation failed`, e);
            addToast("Failed to update library state", "error");
            return false;
        }
    }, [setImages, addToast, refreshCollections, incrementFacetCacheVersion, queryClient]);

    return {
        deleteImages,
    };
};
