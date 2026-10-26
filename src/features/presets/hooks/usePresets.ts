import { useEffect, useMemo, useRef } from 'react';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { FilterState } from '../../../types';
import { getGenerationPresets, rebuildGenerationPresets, type GenerationPreset } from '../../../services/db/presetRepo';
import { useLibraryStore } from '../../../stores/libraryStore';
import { useSettingsStore } from '../../../stores/settingsStore';
import { useInvokeOwnerScopeStore } from '../../../stores/invokeOwnerScopeStore';
import { getInvokeOwnerQueryScopeKey } from '../../../utils/invokeOwnerQueryScope';
import { getEffectiveMaskedKeywords } from '../../../utils/maskingUtils';
import { buildSqlWhereClause } from '../../../utils/sqlHelpers';
import { createPresetScopeFilters } from '../../../utils/filterState';
import { usePresetsViewStore } from '../presetsViewStore';

export interface PresetsState {
    presets: GenerationPreset[];
    /** True only while nothing can be shown yet. */
    isLoading: boolean;
    /** True while newer results load behind the presets already on screen. */
    isRefreshing: boolean;
    error: Error | null;
    retry: () => void;
}

const WARMUP_DELAY_MS = 2000;

interface PresetQueryInput {
    facetCacheVersion: number;
    where: string;
    params: unknown[];
    matchWeights: boolean;
    invokeOwnerScopeKey: string;
}

/**
 * The backend reuses its cache unless library data changed (migration 87), so this is cheap
 * when nothing changed. The result records which library version it was refreshed for.
 */
const rebuildQueryOptions = (facetCacheVersion: number) => ({
    queryKey: ['presets', 'rebuild', facetCacheVersion] as const,
    queryFn: async () => ({ version: facetCacheVersion, count: await rebuildGenerationPresets() }),
    staleTime: Infinity,
    gcTime: Infinity,
});

const listQueryOptions = ({ facetCacheVersion, where, params, matchWeights, invokeOwnerScopeKey }: PresetQueryInput) => ({
    queryKey: ['presets', 'list', facetCacheVersion, matchWeights, where, params, invokeOwnerScopeKey] as const,
    queryFn: () => getGenerationPresets(where, params, matchWeights),
    staleTime: Infinity,
    gcTime: Infinity,
});

/** The preset scope ignores search and gallery filters, so it only changes with view toggles. */
const usePresetQueryScope = (filters: FilterState) => {
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

    return { facetCacheVersion, scope, invokeOwnerScopeKey, settingsLoaded };
};

const warmPresets = async (queryClient: QueryClient, input: PresetQueryInput) => {
    const rebuilt = await queryClient.fetchQuery(rebuildQueryOptions(input.facetCacheVersion));
    await queryClient.prefetchQuery(listQueryOptions({ ...input, facetCacheVersion: rebuilt.version }));
};

/**
 * Like the gallery, which loads at startup: refreshes the preset cache and groups the presets in
 * the background shortly after launch, so the first visit to the page is instant. Runs once; later
 * library changes refresh when the page opens, so imports never wait on a background rebuild.
 */
export const usePresetsWarmup = (filters: FilterState): void => {
    const queryClient = useQueryClient();
    const { facetCacheVersion, scope, invokeOwnerScopeKey, settingsLoaded } = usePresetQueryScope(filters);
    const latest = useRef<PresetQueryInput | null>(null);
    latest.current = {
        facetCacheVersion,
        where: scope.where,
        params: scope.params,
        matchWeights: usePresetsViewStore.getState().matchWeights,
        invokeOwnerScopeKey,
    };

    useEffect(() => {
        if (!settingsLoaded) return;
        const timer = setTimeout(() => {
            const input = latest.current;
            if (input) void warmPresets(queryClient, input).catch(() => undefined);
            // Also load the page's code, so opening it skips the lazy-load fallback.
            void import('../components/PresetsView').catch(() => undefined);
        }, WARMUP_DELAY_MS);
        return () => clearTimeout(timer);
    }, [queryClient, settingsLoaded]);
};

/**
 * Groups the images that the gallery would show for a preset, so badge counts match the filtered
 * gallery. Earlier results stay on screen while a newer library version or grouping loads.
 */
export const usePresets = (filters: FilterState, matchWeights: boolean): PresetsState => {
    const { facetCacheVersion, scope, invokeOwnerScopeKey, settingsLoaded } = usePresetQueryScope(filters);

    const rebuildQuery = useQuery({
        ...rebuildQueryOptions(facetCacheVersion),
        placeholderData: previous => previous,
        enabled: settingsLoaded,
    });

    // Placeholder rebuild data carries the previous version, so the list keeps its current key
    // (and cards) until the refreshed cache is ready.
    const rebuiltVersion = rebuildQuery.data?.version;
    const presetsQuery = useQuery({
        ...listQueryOptions({ facetCacheVersion: rebuiltVersion ?? -1, where: scope.where, params: scope.params, matchWeights, invokeOwnerScopeKey }),
        placeholderData: previous => previous,
        enabled: rebuiltVersion !== undefined,
    });

    const hasPresets = presetsQuery.data !== undefined;
    return {
        presets: presetsQuery.data ?? [],
        isLoading: !hasPresets,
        isRefreshing: hasPresets && (rebuildQuery.isFetching || presetsQuery.isFetching),
        error: rebuildQuery.error ?? presetsQuery.error ?? null,
        retry: () => {
            if (rebuildQuery.isError) void rebuildQuery.refetch();
            else void presetsQuery.refetch();
        },
    };
};
