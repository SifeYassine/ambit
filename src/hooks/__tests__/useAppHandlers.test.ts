
import React from 'react';
import { QueryClient, QueryClientProvider, QueryObserver } from '@tanstack/react-query';
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useAppHandlers } from '../useAppHandlers';
import { AIImage, GeneratorTool } from '../../types';

const mockAddToast = vi.fn();
vi.mock('../useToast', () => ({
    useToast: () => ({
        addToast: mockAddToast,
    }),
}));

const mockUpdateImageMetadataFields = vi.fn();
const mockRemoveImagesFromLibrary = vi.fn();
const mockRestoreRemovedImages = vi.fn();
const mockDeleteRemovedImagesFromDisk = vi.fn();
const mockGetImagesByIds = vi.fn();
const mockRebuildFacetCache = vi.fn().mockResolvedValue(0);
const mockRevertImageMetadata = vi.fn();
const mockRebuildFacetCacheIncremental = vi.fn();
const mockRefreshFacetCacheForResourcesStrict = vi.fn();
const mockIncrementFacetCacheVersion = vi.fn();
const mockResolveExactDuplicateGroups = vi.fn();

vi.mock('../../services/db/imageRepo', () => ({
    updateImageMetadataFields: (...args: any[]) => mockUpdateImageMetadataFields(...args),
    removeImagesFromLibrary: (...args: any[]) => mockRemoveImagesFromLibrary(...args),
    restoreRemovedImages: (...args: any[]) => mockRestoreRemovedImages(...args),
    deleteRemovedImagesFromDisk: (...args: any[]) => mockDeleteRemovedImagesFromDisk(...args),
    getImagesByIds: (...args: any[]) => mockGetImagesByIds(...args),
    revertImageMetadata: (...args: any[]) => mockRevertImageMetadata(...args),
    rebuildFacetCache: (...args: any[]) => mockRebuildFacetCache(...args),
    rebuildFacetCacheIncremental: (...args: any[]) => mockRebuildFacetCacheIncremental(...args),
    refreshFacetCacheForResourcesStrict: (...args: any[]) => mockRefreshFacetCacheForResourcesStrict(...args),
}));

vi.mock('../../services/db/exactDuplicateRepo', () => ({
    resolveExactDuplicateGroups: (...args: unknown[]) => mockResolveExactDuplicateGroups(...args),
}));

vi.mock('../../stores/libraryStore', () => ({
    useLibraryStore: (selector: (state: { incrementFacetCacheVersion: typeof mockIncrementFacetCacheVersion }) => unknown) => selector({ incrementFacetCacheVersion: mockIncrementFacetCacheVersion }),
}));

describe('useAppHandlers', () => {
    const mockSetImages = vi.fn();
    const mockRefreshMaintenanceCounts = vi.fn();
    const mockRefreshHiddenAvailability = vi.fn();
    let queryClient: QueryClient;
    let dispatchedImages: AIImage[];

    const mockImages: AIImage[] = [
        {
            id: 'img1',
            timestamp: 100,
            url: 'url1',
            thumbnailUrl: 'thumb1',
            filename: 'img1.png',
            width: 512,
            height: 512,
            isFavorite: false,
            metadata: {
                positivePrompt: 'A cat',
                negativePrompt: 'low res',
                model: 'Model A',
                tool: GeneratorTool.AUTOMATIC1111,
                steps: 20
            } as any
        }
    ];

    const props = {
        images: mockImages,
        setImages: mockSetImages,
        refreshMaintenanceCounts: mockRefreshMaintenanceCounts,
        refreshHiddenAvailability: mockRefreshHiddenAvailability,
    };

    beforeEach(() => {
        vi.clearAllMocks();
        dispatchedImages = [...mockImages];
        mockSetImages.mockImplementation((update: AIImage[] | ((previous: AIImage[]) => AIImage[])) => {
            dispatchedImages = typeof update === 'function' ? update(dispatchedImages) : update;
        });
        queryClient = new QueryClient();
        mockGetImagesByIds.mockResolvedValue([mockImages[0]]);
        mockRevertImageMetadata.mockResolvedValue(undefined);
        mockUpdateImageMetadataFields.mockResolvedValue(undefined);
        mockRebuildFacetCache.mockResolvedValue(0);
        mockRebuildFacetCacheIncremental.mockResolvedValue(0);
        mockRefreshFacetCacheForResourcesStrict.mockResolvedValue(0);
        const lifecycleResult = (ids: string[]) => ({
            affectedIds: ids,
            notFoundIds: [],
            membershipWarningIds: [],
            touchedResources: {
                checkpoints: ['Unknown'], loras: [], embeddings: [], hypernetworks: [],
                controlNets: [], ipAdapters: [], tools: ['Unknown'],
            },
        });
        mockRemoveImagesFromLibrary.mockImplementation(async (ids: string[]) => lifecycleResult(ids));
        mockRestoreRemovedImages.mockImplementation(async (ids: string[]) => lifecycleResult(ids));
        mockRefreshHiddenAvailability.mockResolvedValue(undefined);
        mockResolveExactDuplicateGroups.mockResolvedValue({
            resolvedGroups: 1,
            removedIds: ['img2'],
            keepers: [{ id: 'img1', isFavorite: true, isPinned: true, userMasked: null }],
        });
        mockDeleteRemovedImagesFromDisk.mockResolvedValue({
            clearedIds: ['img1'],
            trashedIds: ['img1'],
            alreadyMissingIds: [],
            failedIds: [],
            cleanupPendingIds: [],
            thumbnailWarningIds: [],
            notFoundIds: [],
        });
    });

    const renderHandlers = () => renderHook(() => useAppHandlers(props), {
        wrapper: ({ children }: { children: React.ReactNode }) => React.createElement(
            QueryClientProvider,
            { client: queryClient },
            children,
        ),
    });

    it('should handle grouping images into a stack', () => {
        const { result } = renderHandlers();

        act(() => {
            result.current.handleGroupImages(['img1']);
        });

        expect(mockSetImages).toHaveBeenCalled();
        const updater = mockSetImages.mock.calls[0][0];
        const nextState = updater(mockImages);
        expect(nextState[0].groupId).toBeDefined();
        expect(nextState[0].groupId).toContain('stack_');
    });

    it('should handle remove from library', async () => {
        const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
        const queryKey = ['images', { scope: 'library' }] as const;
        queryClient.setQueryData(queryKey, {
            pages: [{ images: mockImages, totalCount: 1, globalCount: 1 }],
            pageParams: [undefined],
        });
        const { result } = renderHandlers();

        await act(async () => {
            await result.current.handleRemoveFromLibrary(['img1']);
        });

        expect(mockRemoveImagesFromLibrary).toHaveBeenCalledWith(['img1']);
        expect(mockSetImages).toHaveBeenCalled();
        expect(mockRefreshMaintenanceCounts).toHaveBeenCalled();
        expect(queryClient.getQueryData<{
            pages: Array<{ images: AIImage[]; totalCount: number; globalCount: number }>;
        }>(queryKey)?.pages[0]).toMatchObject({ images: [], totalCount: 0, globalCount: 0 });
        expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['images'] });
        expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['invoke-image-references'] });
    });

    it('does not change local state when remove persistence fails', async () => {
        const failure = new Error('database unavailable');
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        mockRemoveImagesFromLibrary.mockRejectedValueOnce(failure);
        const { result } = renderHandlers();

        try {
            await act(async () => {
                await expect(result.current.handleRemoveFromLibrary(['img1'])).rejects.toThrow(failure);
            });

            expect(mockSetImages).not.toHaveBeenCalled();
            expect(mockAddToast).toHaveBeenCalledWith(
                'Could not remove the selected items. The library was left unchanged.',
                'error'
            );
        } finally {
            errorSpy.mockRestore();
        }
    });

    it('keeps a committed removal successful when reference refresh fails', async () => {
        const refreshError = new Error('refresh unavailable');
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        vi.spyOn(queryClient, 'invalidateQueries').mockRejectedValueOnce(refreshError);
        const { result } = renderHandlers();

        try {
            await act(async () => result.current.handleRemoveFromLibrary(['img1']));

            expect(dispatchedImages).toEqual([]);
            expect(mockAddToast).toHaveBeenCalledWith('Removed 1 item from the library', 'success');
            expect(mockAddToast).toHaveBeenCalledWith(
                'Items were removed, but some views may need a refresh.',
                'warning'
            );
        } finally {
            errorSpy.mockRestore();
        }
    });

    it.each([false, true])(
        'refetches restored images through the active query when InvokeAI asset visibility is %s',
        async (showInvokeImageAssets) => {
            dispatchedImages = [];
            const restoredAsset: AIImage = {
                ...mockImages[0],
                id: 'invoke-control',
                invokeImageCategory: 'control',
            };
            let isRestored = false;
            mockRestoreRemovedImages.mockImplementationOnce(async (ids: string[]) => {
                isRestored = true;
                return {
                    affectedIds: ids,
                    notFoundIds: [],
                    membershipWarningIds: [],
                    touchedResources: { checkpoints: [], loras: [], embeddings: [], hypernetworks: [], controlNets: [], ipAdapters: [], tools: [] },
                };
            });
            const queryKey = ['images', { showInvokeImageAssets }] as const;
            const emptyResult: {
                pages: Array<{ images: AIImage[]; totalCount: number; globalCount: number }>;
                pageParams: undefined[];
            } = {
                pages: [{ images: [], totalCount: 0, globalCount: 0 }],
                pageParams: [undefined],
            };
            const observer = new QueryObserver(queryClient, {
                queryKey,
                queryFn: async () => ({
                    pages: [{
                        images: isRestored && showInvokeImageAssets ? [restoredAsset] : [],
                        totalCount: isRestored && showInvokeImageAssets ? 1 : 0,
                        globalCount: 1,
                    }],
                    pageParams: [undefined],
                }),
                initialData: emptyResult,
                staleTime: Infinity,
            });
            const unsubscribe = observer.subscribe(() => undefined);
            const { result } = renderHandlers();

            try {
                await act(async () => {
                    await result.current.handleRestoreImages(['invoke-control']);
                });

                const refreshed = queryClient.getQueryData<typeof emptyResult>(queryKey);
                expect(mockRestoreRemovedImages).toHaveBeenCalledWith(['invoke-control']);
                expect(refreshed?.pages[0].images.map(image => image.id)).toEqual(
                    showInvokeImageAssets ? ['invoke-control'] : []
                );
                expect(mockSetImages).not.toHaveBeenCalled();
                expect(mockRefreshHiddenAvailability).toHaveBeenCalledOnce();
            } finally {
                unsubscribe();
            }
        }
    );

    it('should handle delete file for removed items', async () => {
        const queryKey = ['images', { scope: 'stale-library' }] as const;
        queryClient.setQueryData(queryKey, {
            pages: [{ images: mockImages, totalCount: 1, globalCount: 1 }],
            pageParams: [undefined],
        });
        const { result } = renderHandlers();

        await act(async () => {
            await result.current.handleDeleteFile(['img1']);
        });

        expect(mockDeleteRemovedImagesFromDisk).toHaveBeenCalledWith(['img1']);
        expect(dispatchedImages).toEqual([]);
        expect(queryClient.getQueryData<{
            pages: Array<{ images: AIImage[]; totalCount: number; globalCount: number }>;
        }>(queryKey)?.pages[0]).toMatchObject({ images: [], totalCount: 0, globalCount: 0 });
    });

    it('keeps a committed disk deletion successful when gallery refresh fails', async () => {
        const refreshError = new Error('refresh unavailable');
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        vi.spyOn(queryClient, 'invalidateQueries').mockRejectedValueOnce(refreshError);
        const { result } = renderHandlers();

        try {
            await act(async () => {
                await expect(result.current.handleDeleteFile(['img1'])).resolves.toMatchObject({
                    clearedIds: ['img1'],
                });
            });

            expect(dispatchedImages).toEqual([]);
            expect(mockAddToast).toHaveBeenCalledWith(
                'Moved 1 file to OS trash and removed it from Ambit',
                'success'
            );
            expect(mockAddToast).toHaveBeenCalledWith(
                'Files were deleted, but some views may need a refresh.',
                'warning'
            );
            expect(mockAddToast).not.toHaveBeenCalledWith(
                'Could not finish deleting the selected files. The Removed entries were kept.',
                'error'
            );
        } finally {
            errorSpy.mockRestore();
        }
    });

    it('should show warning toast when removed delete partially fails', async () => {
        mockDeleteRemovedImagesFromDisk.mockResolvedValue({
            clearedIds: ['img1'],
            trashedIds: ['img1'],
            alreadyMissingIds: [],
            failedIds: ['img2'],
            cleanupPendingIds: [],
            thumbnailWarningIds: [],
            notFoundIds: [],
        });
        const { result } = renderHandlers();

        await act(async () => {
            await result.current.handleDeleteFile(['img1', 'img2']);
        });

        expect(mockAddToast).toHaveBeenCalledWith(expect.stringContaining('still need attention'), 'warning');
    });

    it('groups only requested images and applies the transactional duplicate result', async () => {
        const duplicate = { ...mockImages[0], id: 'img2' };
        dispatchedImages = [mockImages[0], duplicate];
        const queryKey = ['images', { scope: 'library' }] as const;
        queryClient.setQueryData(queryKey, {
            pages: [{ images: [mockImages[0], duplicate], totalCount: 2, globalCount: 2 }],
            pageParams: [undefined],
        });
        const { result } = renderHandlers();
        act(() => result.current.handleGroupImages(['img1']));
        expect(dispatchedImages[0].groupId).toBeTruthy();
        expect(dispatchedImages[1].groupId).toBeUndefined();

        const resolutions = [{ keepId: 'img1', removeIds: ['img2'] }];
        await act(async () => result.current.handleResolveDuplicate(resolutions));
        expect(mockResolveExactDuplicateGroups).toHaveBeenCalledWith(resolutions);
        expect(dispatchedImages).toHaveLength(1);
        expect(dispatchedImages[0]).toMatchObject({ id: 'img1', isFavorite: true, isPinned: true, userMasked: undefined });
        expect(queryClient.getQueryData<{
            pages: Array<{ images: AIImage[]; totalCount: number; globalCount: number }>;
        }>(queryKey)?.pages[0]).toMatchObject({
            images: [expect.objectContaining({ id: 'img1', isFavorite: true, isPinned: true, userMasked: undefined })],
            totalCount: 1,
            globalCount: 1,
        });
        expect(mockAddToast).toHaveBeenCalledWith('Moved 1 duplicate to Removed', 'success');
        expect(mockRefreshMaintenanceCounts).toHaveBeenCalled();
    });

    it('uses plural duplicate and existing removal messages', async () => {
        mockResolveExactDuplicateGroups.mockResolvedValueOnce({
            resolvedGroups: 1,
            removedIds: ['img2', 'img3'],
            keepers: [{ id: 'img1', isFavorite: false, isPinned: false, userMasked: false }],
        });
        const { result } = renderHandlers();
        await act(async () => result.current.handleResolveDuplicate([{ keepId: 'img1', removeIds: ['img2', 'img3'] }]));
        expect(mockAddToast).toHaveBeenCalledWith('Moved 2 duplicates to Removed', 'success');
        await act(async () => result.current.handleRemoveFromLibrary(['img1', 'img2']));
        expect(mockAddToast).toHaveBeenCalledWith('Removed 2 items from the library', 'success');
    });

    it('keeps local images unchanged and reports a failed duplicate transaction', async () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        mockResolveExactDuplicateGroups.mockRejectedValueOnce(new Error('stale group'));
        const { result } = renderHandlers();

        await act(async () => {
            await expect(result.current.handleResolveDuplicate([{ keepId: 'img1', removeIds: ['img2'] }]))
                .rejects.toThrow('stale group');
        });

        expect(dispatchedImages).toEqual(mockImages);
        expect(mockAddToast).toHaveBeenCalledWith('Could not resolve duplicates. Run the scan again and retry.', 'error');
        error.mockRestore();
    });

    it('keeps a committed duplicate resolution successful when query invalidation fails', async () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        vi.spyOn(queryClient, 'invalidateQueries').mockRejectedValueOnce(new Error('refresh failed'));
        const { result } = renderHandlers();

        await act(async () => {
            await result.current.handleResolveDuplicate([{ keepId: 'img1', removeIds: ['img2'] }]);
        });

        expect(dispatchedImages).toEqual([expect.objectContaining({ id: 'img1', isFavorite: true })]);
        expect(mockAddToast).toHaveBeenCalledWith('Moved 1 duplicate to Removed', 'success');
        expect(error).toHaveBeenCalledWith(
            'Failed to refresh image queries after resolving duplicates',
            expect.any(Error)
        );
        error.mockRestore();
    });

    it('contains facet refresh failures after a committed duplicate resolution', async () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        mockRebuildFacetCache.mockRejectedValueOnce(new Error('facet refresh failed'));
        const { result } = renderHandlers();

        await act(async () => {
            await result.current.handleResolveDuplicate([{ keepId: 'img1', removeIds: ['img2'] }]);
            await Promise.resolve();
        });

        expect(mockAddToast).toHaveBeenCalledWith('Moved 1 duplicate to Removed', 'success');
        expect(error).toHaveBeenCalledWith('Failed to refresh facet cache', expect.any(Error));
        error.mockRestore();
    });

    it('refreshes hidden availability when restoring the first active asset', async () => {
        dispatchedImages = [];
        const { result } = renderHandlers();
        await act(async () => result.current.handleRestoreImages(['img1']));
        expect(mockRefreshHiddenAvailability).toHaveBeenCalledOnce();
        expect(mockSetImages).not.toHaveBeenCalled();
        expect(mockAddToast).toHaveBeenCalledWith('Restored 1 item to the library', 'success');
    });

    it('completes restore updates when hidden availability refresh fails', async () => {
        const refreshError = new Error('availability unavailable');
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        mockRefreshHiddenAvailability.mockRejectedValueOnce(refreshError);
        const { result } = renderHandlers();

        try {
            await act(async () => result.current.handleRestoreImages(['img1']));

            expect(mockRestoreRemovedImages).toHaveBeenCalledWith(['img1']);
            expect(mockAddToast).toHaveBeenCalledWith('Restored 1 item to the library', 'success');
            expect(mockRefreshMaintenanceCounts).toHaveBeenCalledOnce();
            expect(mockRefreshFacetCacheForResourcesStrict).toHaveBeenCalledOnce();
            expect(errorSpy).toHaveBeenCalledWith(
                '[Restore] Restored images, but failed to refresh dependent views',
                refreshError
            );
            expect(mockAddToast).toHaveBeenCalledWith(
                'Items were restored, but some views may need a refresh.',
                'warning'
            );
        } finally {
            errorSpy.mockRestore();
        }
    });

    it('reports restore persistence failures without running committed-state refreshes', async () => {
        const failure = new Error('restore blocked');
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        mockRestoreRemovedImages.mockRejectedValueOnce(failure);
        const { result } = renderHandlers();

        try {
            await act(async () => {
                await expect(result.current.handleRestoreImages(['img1'])).rejects.toThrow(failure);
            });

            expect(mockRefreshMaintenanceCounts).not.toHaveBeenCalled();
            expect(mockRefreshFacetCacheForResourcesStrict).not.toHaveBeenCalled();
            expect(mockAddToast).toHaveBeenCalledWith(
                'Could not restore the selected items. Their Removed entries were kept.',
                'error'
            );
        } finally {
            errorSpy.mockRestore();
        }
    });

    it('covers successful plural deletion, warning cleanup, and total failure', async () => {
        const { result } = renderHandlers();
        mockDeleteRemovedImagesFromDisk.mockResolvedValueOnce({ clearedIds: ['a', 'b'], trashedIds: ['a', 'b'], alreadyMissingIds: [], failedIds: [], cleanupPendingIds: [], thumbnailWarningIds: [], notFoundIds: [] });
        await act(async () => result.current.handleDeleteFile(['a', 'b']));
        expect(mockAddToast).toHaveBeenCalledWith('Moved 2 files to OS trash and removed them from Ambit', 'success');

        mockDeleteRemovedImagesFromDisk.mockResolvedValueOnce({ clearedIds: ['a'], trashedIds: ['a'], alreadyMissingIds: [], failedIds: [], cleanupPendingIds: [], thumbnailWarningIds: ['a'], notFoundIds: [] });
        await act(async () => result.current.handleDeleteFile(['a']));
        expect(mockAddToast).toHaveBeenCalledWith(expect.stringContaining('thumbnail cleanup warnings'), 'warning');

        mockDeleteRemovedImagesFromDisk.mockResolvedValueOnce({ clearedIds: [], trashedIds: [], alreadyMissingIds: [], failedIds: ['a'], cleanupPendingIds: [], thumbnailWarningIds: [], notFoundIds: [] });
        await act(async () => result.current.handleDeleteFile(['a']));
        expect(mockAddToast).toHaveBeenCalledWith('Failed to move selected files to OS trash. The Removed entries were kept.', 'error');
    });

    it('does not report success when the selected Removed entries no longer exist', async () => {
        mockDeleteRemovedImagesFromDisk.mockResolvedValueOnce({
            clearedIds: [],
            trashedIds: [],
            alreadyMissingIds: [],
            failedIds: [],
            cleanupPendingIds: [],
            thumbnailWarningIds: [],
            notFoundIds: ['stale-entry'],
        });
        const { result } = renderHandlers();

        await act(async () => result.current.handleDeleteFile(['stale-entry']));

        expect(mockAddToast).toHaveBeenCalledWith(
            'Removed 0 entries from Ambit; 1 selected entry was already unavailable.',
            'warning'
        );
    });

    it('explains the Removed-tab trash workflow', async () => {
        const { result } = renderHandlers();
        await act(async () => result.current.handleEmptyTrash());
        expect(mockAddToast).toHaveBeenCalledWith('Removed items are now handled through the Removed tab actions.', 'info');
        expect(mockRefreshMaintenanceCounts).toHaveBeenCalled();
    });

    it('uses plural warning wording for partially deleted multiple files', async () => {
        mockDeleteRemovedImagesFromDisk.mockResolvedValueOnce({
            clearedIds: ['a', 'b'], trashedIds: ['a', 'b'], alreadyMissingIds: [], failedIds: ['c'], cleanupPendingIds: [], thumbnailWarningIds: [], notFoundIds: []
        });
        const { result } = renderHandlers();
        await act(async () => result.current.handleDeleteFile(['a', 'b', 'c']));
        expect(mockAddToast).toHaveBeenCalledWith(expect.stringContaining('Removed 2 entries from Ambit'), 'warning');
    });
});
