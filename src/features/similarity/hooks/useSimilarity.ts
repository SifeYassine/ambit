import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { FilterState } from '../../../types';
import {
    clusterSimilarImages,
    getClusterImages,
    getSimilarityStatus,
    searchSimilarImages,
    type SearchScope,
} from '../../../services/similarityService';
import { useLibraryStore } from '../../../stores/libraryStore';
import { useSettingsStore } from '../../../stores/settingsStore';
import { useSimilarityStore } from '../../../stores/similarityStore';
import { createPresetScopeFilters } from '../../../utils/filterState';
import { getEffectiveMaskedKeywords } from '../../../utils/maskingUtils';
import { buildSqlWhereClause } from '../../../utils/sqlHelpers';

export const SIMILARITY_STATUS_KEY = ['similarity', 'status'] as const;

/** Model and index state; refetched when library data changes so new imports show as pending. */
export const useSimilarityStatus = () => {
    const facetCacheVersion = useLibraryStore(state => state.facetCacheVersion);
    return useQuery({
        queryKey: [...SIMILARITY_STATUS_KEY, facetCacheVersion],
        queryFn: getSimilarityStatus,
        placeholderData: previous => previous,
    });
};

/**
 * Results use the same scope as the Presets page: the library view toggles, owner scope and
 * privacy, but not the gallery's search or filters, which would silently hide matches.
 */
export const useSimilarityScope = (filters: FilterState): SearchScope => {
    const settings = useSettingsStore(state => state.settings);
    const privacyEnabled = useSettingsStore(state => state.privacyEnabled);
    const maskedKeywords = getEffectiveMaskedKeywords(settings);
    return useMemo(() => {
        const { where, params } = buildSqlWhereClause(
            createPresetScopeFilters(filters),
            privacyEnabled,
            settings.maskingMode,
            maskedKeywords
        );
        return { where, params };
    }, [filters, maskedKeywords, privacyEnabled, settings.maskingMode]);
};

/** Results of the submitted search; kept until the user clears them or searches again. */
export const useSimilaritySearchResults = (scope: SearchScope) => {
    const submitted = useSimilarityStore(state => state.submittedSearch);
    return useQuery({
        queryKey: ['similarity', 'search', submitted, scope.where, scope.params],
        queryFn: () => submitted
            ? searchSimilarImages(submitted.query, submitted.topK, submitted.threshold, scope)
            : Promise.resolve([]),
        enabled: submitted !== null,
        staleTime: Infinity,
    });
};

/** Image ids per cluster for the submitted clustering. */
export const useSimilarityClusters = () => {
    const submitted = useSimilarityStore(state => state.submittedClustering);
    return useQuery({
        queryKey: ['similarity', 'clusters', submitted],
        queryFn: () => submitted ? clusterSimilarImages(submitted.options) : Promise.resolve([]),
        enabled: submitted !== null,
        staleTime: Infinity,
    });
};

/** The visible images of one cluster, in cluster order. */
export const useClusterImages = (ids: string[], scope: SearchScope) => useQuery({
    queryKey: ['similarity', 'cluster-images', ids, scope.where, scope.params],
    queryFn: () => getClusterImages(ids, scope),
    enabled: ids.length > 0,
    placeholderData: previous => previous,
    staleTime: Infinity,
});
