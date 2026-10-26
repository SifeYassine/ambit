import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { FilterState } from '../../../types';
import { getGenerationPresets, rebuildGenerationPresets, type GenerationPreset } from '../../../services/db/presetRepo';
import { useLibraryStore } from '../../../stores/libraryStore';
import { useSettingsStore } from '../../../stores/settingsStore';
import { useInvokeOwnerScopeStore } from '../../../stores/invokeOwnerScopeStore';
import { getInvokeOwnerQueryScopeKey } from '../../../utils/invokeOwnerQueryScope';
import { getEffectiveMaskedKeywords } from '../../../utils/maskingUtils';
import { buildSqlWhereClause } from '../../../utils/sqlHelpers';
import { createPresetScopeFilters } from '../../../utils/filterState';

export interface PresetsState {
    presets: GenerationPreset[];
    isLoading: boolean;
    error: Error | null;
    retry: () => void;
}

/**
 * Rebuilds the preset cache whenever library data changes (facet cache version), then groups the
 * images that the gallery would show for a preset, so badge counts match the filtered gallery.
 */
export const usePresets = (filters: FilterState, matchWeights: boolean): PresetsState => {
    const facetCacheVersion = useLibraryStore(state => state.facetCacheVersion);
    const settings = useSettingsStore(state => state.settings);
    const privacyEnabled = useSettingsStore(state => state.privacyEnabled);
    const settingsLoaded = useSettingsStore(state => state.isLoaded);
    const invokeOwnerScopeKey = useInvokeOwnerScopeStore(state => (
        getInvokeOwnerQueryScopeKey(settings.invokeAiPath, state.ownerScopeState)
    ));
    const maskedKeywords = getEffectiveMaskedKeywords(settings);

    const scope = useMemo(
        () => buildSqlWhereClause(createPresetScopeFilters(filters), privacyEnabled, settings.maskingMode, maskedKeywords),
        [filters, maskedKeywords, privacyEnabled, settings.maskingMode]
    );

    const rebuildQuery = useQuery({
        queryKey: ['presets', 'rebuild', facetCacheVersion],
        queryFn: rebuildGenerationPresets,
        staleTime: Infinity,
        enabled: settingsLoaded,
    });

    const presetsQuery = useQuery({
        queryKey: ['presets', 'list', rebuildQuery.dataUpdatedAt, matchWeights, scope.where, scope.params, invokeOwnerScopeKey],
        queryFn: () => getGenerationPresets(scope.where, scope.params, matchWeights),
        enabled: rebuildQuery.isSuccess,
        staleTime: Infinity,
    });

    return {
        presets: presetsQuery.data ?? [],
        isLoading: rebuildQuery.isPending || presetsQuery.isPending,
        error: rebuildQuery.error ?? presetsQuery.error ?? null,
        retry: () => {
            if (rebuildQuery.isError) void rebuildQuery.refetch();
            else void presetsQuery.refetch();
        },
    };
};
