import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GeneratorTool, type AIImage, type AppSettings } from '../../types';
import { useMaintenanceOps } from '../useMaintenanceOps';

const mockAddToast = vi.fn();
const mockImageToAnalysisBase64 = vi.fn();
const mockRecoverImageMetadata = vi.fn();
const mockUpdateImageMetadataFields = vi.fn();
const mockIncrementFacetCacheVersion = vi.fn();
const mockGetSettingsState = vi.fn();
const imageRepoMocks = vi.hoisted(() => ({
    getImagesByIds: vi.fn(),
    refreshFacetCacheForResourcesStrict: vi.fn(),
    removeImagesFromLibrary: vi.fn(),
}));

vi.mock('../useToast', () => ({
    useToast: () => ({ addToast: mockAddToast }),
}));

vi.mock('../../services/imageService', () => ({
    imageToAnalysisBase64: (...args: unknown[]) => mockImageToAnalysisBase64(...args),
}));

vi.mock('../../services/geminiService', () => ({
    recoverImageMetadata: (...args: unknown[]) => mockRecoverImageMetadata(...args),
}));

vi.mock('../../services/db/imageRepo', () => ({
    getImagesByIds: imageRepoMocks.getImagesByIds,
    refreshFacetCacheForResourcesStrict: imageRepoMocks.refreshFacetCacheForResourcesStrict,
    removeImagesFromLibrary: imageRepoMocks.removeImagesFromLibrary,
    updateImageMetadataFields: (...args: unknown[]) => mockUpdateImageMetadataFields(...args),
}));

vi.mock('../../stores/libraryStore', () => ({
    useLibraryStore: (selector: (state: { incrementFacetCacheVersion: () => void }) => unknown) => (
        selector({ incrementFacetCacheVersion: mockIncrementFacetCacheVersion })
    ),
}));

vi.mock('../../stores/settingsStore', () => ({
    useSettingsStore: {
        getState: () => mockGetSettingsState(),
    },
}));

const image: AIImage = {
    id: 'C:/library/image.jpg',
    url: 'https://asset.localhost/C%3A/library/image.jpg',
    thumbnailUrl: 'thumb',
    filename: 'image.jpg',
    timestamp: 1,
    width: 100,
    height: 100,
    isFavorite: false,
    metadata: {
        tool: GeneratorTool.UNKNOWN,
        model: 'Unknown',
        seed: 0,
        steps: 0,
        cfg: 0,
        sampler: 'Unknown',
        positivePrompt: '',
        negativePrompt: '',
    },
};

const settings: AppSettings = {
    hasCompletedOnboarding: true,
    theme: 'dark',
    thumbnailSize: 240,
    confirmDelete: true,
    defaultTheaterMode: false,
    monitoredFolders: [],
    promptMaskingEnabled: true,
    maskedKeywords: [],
    maskingMode: 'blur',
    enableAI: true,
};

describe('useMaintenanceOps metadata recovery', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockImageToAnalysisBase64.mockResolvedValue('data:image/webp;base64,sanitized');
        mockRecoverImageMetadata.mockResolvedValue({ positivePrompt: 'Recovered prompt' });
        mockUpdateImageMetadataFields.mockResolvedValue(undefined);
        mockGetSettingsState.mockReturnValue({ geminiApiKey: 'test-key' });
        imageRepoMocks.getImagesByIds.mockResolvedValue([]);
        imageRepoMocks.refreshFacetCacheForResourcesStrict.mockResolvedValue(undefined);
        imageRepoMocks.removeImagesFromLibrary.mockImplementation(async (ids: string[]) => ({
            affectedIds: ids,
            notFoundIds: [],
            membershipWarningIds: [],
            touchedResources: { checkpoints: [], loras: [], embeddings: [], hypernetworks: [], controlNets: [], ipAdapters: [], tools: [] },
        }));
    });
});
