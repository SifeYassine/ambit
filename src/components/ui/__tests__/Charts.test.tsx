import * as React from 'react';
import { fireEvent, render, screen, waitFor } from '../../../test/testUtils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildTagSearchTerm, StatsDashboard } from '../Charts';
import type { SettingBreakdownDimension, SettingBreakdownItem } from '../../../services/db/searchRepo';

const SCOPE = { where: 'WHERE is_deleted = 0', params: [0], collectionId: undefined, loraName: undefined, cacheKey: 'scope-1' };

const createLibraryContextState = () => ({
    stats: {
        totalImages: 2,
        totalGenerations: 2,
        avgSteps: 28,
        estSizeMB: '4.8',
        modelStats: [],
        keywordStats: [{ text: 'long hair', value: 2 }],
        negativeKeywordStats: [{ text: 'bad anatomy', value: 3 }],
    },
    setFilters: vi.fn(),
    isFiltering: false,
    globalTotal: 118000,
    isStatsSummaryLoading: false,
    isKeywordStatsLoading: false,
    statsScope: SCOPE as typeof SCOPE | null,
});

const mocks = vi.hoisted(() => ({
    context: {} as Record<string, unknown>,
    setKeywordStatsEnabled: vi.fn(),
    getSettingBreakdown: vi.fn(),
}));

vi.mock('../../../hooks/useLibraryContext', () => ({ useLibraryContext: () => mocks.context }));
vi.mock('../../../stores/libraryStore', () => ({
    useLibraryStore: (selector: (state: { setKeywordStatsEnabled: typeof mocks.setKeywordStatsEnabled }) => unknown) =>
        selector({ setKeywordStatsEnabled: mocks.setKeywordStatsEnabled }),
}));
vi.mock('../../../services/runtime', () => ({ isBrowserMockMode: () => false }));
vi.mock('../../../services/db/searchRepo', () => ({ getSettingBreakdown: mocks.getSettingBreakdown }));

const BREAKDOWNS: Record<SettingBreakdownDimension, SettingBreakdownItem[]> = {
    model: [
        { label: 'wai_nsfw_illustrious_sdxl_v10.0', value: 'wai_nsfw_illustrious_sdxl_v10.0', count: 273 },
        { label: 'nova_furry_xl', value: 'nova_furry_xl', count: 68 },
    ],
    lora: [{ label: 'frostbite', value: 'frostbite', count: 166 }],
    sampler: [{ label: 'dpmpp 2m (karras)', value: 'dpmpp 2m (karras)', count: 367 }],
    steps: [{ label: '28 steps', value: 28, count: 300 }],
    cfg: [],
};

describe('StatsDashboard', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.context = createLibraryContextState();
        mocks.getSettingBreakdown.mockImplementation(async (dimension: SettingBreakdownDimension) => BREAKDOWNS[dimension]);
    });

    it('enables keyword analysis only while mounted and shows no summary cards', () => {
        const { unmount } = render(<StatsDashboard images={[]} onFilter={vi.fn()} />);

        expect(mocks.setKeywordStatsEnabled).toHaveBeenCalledWith(true);
        expect(screen.queryByText('Total Items')).toBeNull();
        expect(screen.queryByText('Storage Used')).toBeNull();
        unmount();
        expect(mocks.setKeywordStatsEnabled).toHaveBeenLastCalledWith(false);
    });

    it('charts the top models over the shared stats scope and filters by a clicked bar', async () => {
        const onFilter = vi.fn();
        render(<StatsDashboard images={[]} onFilter={onFilter} />);

        const bar = await screen.findByRole('button', { name: 'Filter by wai_nsfw_illustrious_sdxl_v10.0 (273 images)' });
        expect(mocks.getSettingBreakdown).toHaveBeenCalledWith('model', SCOPE.where, SCOPE.params, undefined, undefined);
        expect(screen.getByText(/Top 10 Models/)).toBeTruthy();
        expect(screen.getByText('Number of images')).toBeTruthy();

        fireEvent.click(bar);
        expect(onFilter).toHaveBeenCalledWith('model', 'wai_nsfw_illustrious_sdxl_v10.0');
    });

    it('switches the chart setting with the dropdown', async () => {
        const onFilter = vi.fn();
        render(<StatsDashboard images={[]} onFilter={onFilter} />);

        fireEvent.change(screen.getByLabelText('Chart setting'), { target: { value: 'steps' } });
        fireEvent.click(await screen.findByRole('button', { name: 'Filter by 28 steps (300 images)' }));
        expect(screen.getByText(/Top 10 Step Counts/)).toBeTruthy();
        expect(onFilter).toHaveBeenCalledWith('steps', 28);

        fireEvent.change(screen.getByLabelText('Chart setting'), { target: { value: 'cfg' } });
        expect(await screen.findByText('No cfg recorded')).toBeTruthy();
    });

    it('switches between positive and negative prompt tags and filters the gallery by a clicked tag', () => {
        const onFilter = vi.fn();
        render(<StatsDashboard images={[]} onFilter={onFilter} />);

        fireEvent.click(screen.getByText('long hair'));
        expect(onFilter).toHaveBeenLastCalledWith('keyword', '"long hair"');

        expect(screen.getByText('long hair')).toBeTruthy();
        fireEvent.change(screen.getByLabelText('Prompt type'), { target: { value: 'negative' } });
        expect(screen.queryByText('long hair')).toBeNull();
        expect(screen.getByText(/Top Negative Prompt Tags/)).toBeTruthy();

        fireEvent.click(screen.getByText('bad anatomy'));
        expect(onFilter).toHaveBeenLastCalledWith('keyword', '"neg:bad anatomy"');
    });

    it('waits for the stats scope before querying, and the tip can be dismissed', async () => {
        mocks.context = { ...createLibraryContextState(), statsScope: null };
        render(<StatsDashboard images={[]} onFilter={vi.fn()} />);

        await waitFor(() => expect(screen.getByText('No models recorded')).toBeTruthy());
        expect(mocks.getSettingBreakdown).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: 'Dismiss Tip' }));
        expect(screen.queryByText('Tip of the Day')).toBeNull();
    });
});

describe('buildTagSearchTerm', () => {
    it('quotes whole terms so multi-word tags stay one search token', () => {
        expect(buildTagSearchTerm('aurora', 'positive')).toBe('aurora');
        expect(buildTagSearchTerm('long hair', 'positive')).toBe('"long hair"');
        expect(buildTagSearchTerm('blurry', 'negative')).toBe('neg:blurry');
        expect(buildTagSearchTerm('say "hi"', 'positive')).toBe('"say \\"hi\\""');
    });
});
