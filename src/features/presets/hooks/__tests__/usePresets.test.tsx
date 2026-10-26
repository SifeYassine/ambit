import * as React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultFilters } from '../../../../utils/filterState';
import { useLibraryStore } from '../../../../stores/libraryStore';
import { useSettingsStore } from '../../../../stores/settingsStore';
import type { GenerationPreset } from '../../../../services/db/presetRepo';
import { usePresets, usePresetsWarmup } from '../usePresets';

const repo = vi.hoisted(() => ({
    rebuildGenerationPresets: vi.fn(),
    getGenerationPresets: vi.fn(),
}));
vi.mock('../../../../services/db/presetRepo', () => repo);
vi.mock('../../components/PresetsView', () => ({ PresetsView: () => null }));

const preset = (key: string): GenerationPreset => ({
    key, model: 'WAI', sampler: 'euler', loras: [], count: 1, typicalSteps: null, typicalCfg: null, sampleImages: [],
});

const deferred = <T,>() => {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(done => { resolve = done; });
    return { promise, resolve };
};

const createWrapper = (client: QueryClient) => ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
);

describe('usePresets', () => {
    let client: QueryClient;
    const filters = createDefaultFilters();

    beforeEach(() => {
        vi.clearAllMocks();
        client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        useSettingsStore.setState({ isLoaded: true });
        useLibraryStore.setState({ facetCacheVersion: 0 });
        repo.rebuildGenerationPresets.mockResolvedValue(1);
        repo.getGenerationPresets.mockResolvedValue([preset('first')]);
    });

    afterEach(() => {
        vi.useRealTimers();
        client.clear();
    });

    it('loads once, then keeps the cards on screen while a library change refreshes them', async () => {
        const { result } = renderHook(() => usePresets(filters, true), { wrapper: createWrapper(client) });
        expect(result.current.isLoading).toBe(true);
        await waitFor(() => expect(result.current.presets.map(item => item.key)).toEqual(['first']));
        expect(result.current.isLoading).toBe(false);

        const rebuild = deferred<number>();
        repo.rebuildGenerationPresets.mockReturnValueOnce(rebuild.promise);
        repo.getGenerationPresets.mockResolvedValue([preset('second')]);
        act(() => useLibraryStore.setState({ facetCacheVersion: 1 }));

        await waitFor(() => expect(result.current.isRefreshing).toBe(true));
        expect(result.current.isLoading).toBe(false);
        expect(result.current.presets.map(item => item.key)).toEqual(['first']);

        await act(async () => rebuild.resolve(1));
        await waitFor(() => expect(result.current.presets.map(item => item.key)).toEqual(['second']));
        expect(result.current.isRefreshing).toBe(false);
        expect(repo.rebuildGenerationPresets).toHaveBeenCalledTimes(2);
    });

    it('keeps the current cards while switching the LoRA weight grouping', async () => {
        const { result, rerender } = renderHook(({ weights }) => usePresets(filters, weights), {
            wrapper: createWrapper(client),
            initialProps: { weights: true },
        });
        await waitFor(() => expect(result.current.presets).toHaveLength(1));

        const loose = deferred<GenerationPreset[]>();
        repo.getGenerationPresets.mockReturnValueOnce(loose.promise);
        rerender({ weights: false });
        expect(result.current.isLoading).toBe(false);
        expect(result.current.isRefreshing).toBe(true);

        await act(async () => loose.resolve([preset('loose'), preset('other')]));
        await waitFor(() => expect(result.current.presets).toHaveLength(2));
        expect(repo.getGenerationPresets).toHaveBeenLastCalledWith(expect.any(String), expect.any(Array), false);
        expect(repo.rebuildGenerationPresets).toHaveBeenCalledOnce();
    });

    it('warms the cache after launch so the page opens with presets already loaded', async () => {
        vi.useFakeTimers();
        renderHook(() => usePresetsWarmup(filters), { wrapper: createWrapper(client) });
        expect(repo.rebuildGenerationPresets).not.toHaveBeenCalled();

        await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
        expect(repo.rebuildGenerationPresets).toHaveBeenCalledOnce();
        expect(repo.getGenerationPresets).toHaveBeenCalledOnce();
        vi.useRealTimers();

        const { result } = renderHook(() => usePresets(filters, true), { wrapper: createWrapper(client) });
        expect(result.current.isLoading).toBe(false);
        expect(result.current.presets.map(item => item.key)).toEqual(['first']);
        expect(repo.rebuildGenerationPresets).toHaveBeenCalledOnce();
    });
});
