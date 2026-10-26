import * as React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '../../../../test/testUtils';
import { createDefaultFilters } from '../../../../utils/filterState';
import type { GenerationPreset } from '../../../../services/db/presetRepo';
import { PresetsView, usePresetsViewStore } from '../PresetsView';

const presetsState = vi.hoisted(() => ({
    value: { presets: [] as GenerationPreset[], isLoading: false, isRefreshing: false, error: null as Error | null, retry: vi.fn() },
    calls: [] as boolean[],
}));

vi.mock('../../hooks/usePresets', () => ({
    usePresets: (_filters: unknown, matchWeights: boolean) => {
        presetsState.calls.push(matchWeights);
        return presetsState.value;
    },
}));

vi.mock('../../../../components/ui/PrivacyAwareThumbnail', () => ({
    PrivacyAwareThumbnail: ({ src }: { src: string }) => <img data-testid="preset-sample" src={src} alt="" />,
}));

const preset = (overrides: Partial<GenerationPreset> = {}): GenerationPreset => ({
    key: 'k1', model: 'WAI', sampler: 'euler', loras: ['Frostbite (0.80)', 'Moriime'], count: 128,
    typicalSteps: 28, typicalCfg: 6, sampleImages: [], ...overrides,
});

describe('PresetsView', () => {
    beforeEach(() => {
        presetsState.value = { presets: [], isLoading: false, isRefreshing: false, error: null, retry: vi.fn() };
        presetsState.calls = [];
        usePresetsViewStore.setState({ matchWeights: true });
    });

    it('keeps the cards on screen with an updating indicator while presets refresh', () => {
        presetsState.value.presets = [preset()];
        presetsState.value.isRefreshing = true;
        render(<PresetsView filters={createDefaultFilters()} onSelectPreset={vi.fn()} />);

        expect(screen.getAllByRole('button', { name: /^Show / })).toHaveLength(1);
        expect(screen.getByText('Updating…')).toBeTruthy();
        expect(screen.getByText('1 preset')).toBeTruthy();
        expect(screen.queryByText(/Analyzing generation settings/)).toBeNull();
    });

    it('lists presets with settings, an image count badge, and typical steps and CFG', () => {
        presetsState.value.presets = [preset(), preset({ key: 'k2', model: 'Nova', loras: [], count: 1, typicalSteps: null, typicalCfg: null })];
        render(<PresetsView filters={createDefaultFilters()} onSelectPreset={vi.fn()} />);

        const cards = screen.getAllByRole('button', { name: /^Show / });
        expect(cards).toHaveLength(2);
        expect(screen.getByText('2 presets')).toBeTruthy();
        expect(screen.getByText('128 images')).toBeTruthy();
        expect(screen.getByText('1 image')).toBeTruthy();
        expect(screen.getByText('Frostbite (0.80)')).toBeTruthy();
        expect(screen.getByText('None')).toBeTruthy();
        expect(screen.getByText('Usually 28 steps · CFG 6')).toBeTruthy();
        expect(screen.getAllByText(/^Usually/)).toHaveLength(1);
    });

    it('shows two LoRAs collapsed and expands only that card to show all of them', () => {
        const loras = ['one (0.50)', 'two', 'three', 'four'];
        presetsState.value.presets = [preset({ loras }), preset({ key: 'k2', loras: ['solo'] })];
        render(<PresetsView filters={createDefaultFilters()} onSelectPreset={vi.fn()} />);

        const [first, second] = screen.getAllByRole('list', { name: 'LoRAs' });
        const items = (list: HTMLElement) => Array.from(list.querySelectorAll('li')).map(item => item.textContent);
        expect(items(first)).toEqual(['one (0.50)', 'two (1.00)']);
        expect(items(second)).toEqual(['solo (1.00)']);

        fireEvent.click(screen.getByRole('button', { name: '+2 more' }));
        expect(items(first)).toEqual(['one (0.50)', 'two (1.00)', 'three (1.00)', 'four (1.00)']);
        expect(items(second)).toEqual(['solo (1.00)']);

        fireEvent.click(screen.getByRole('button', { name: 'Show less' }));
        expect(items(first)).toHaveLength(2);
    });

    it('shows no implicit weight once presets merge LoRA weights', () => {
        usePresetsViewStore.setState({ matchWeights: false });
        presetsState.value.presets = [preset({ loras: ['Frostbite', 'Moriime'] })];
        render(<PresetsView filters={createDefaultFilters()} onSelectPreset={vi.fn()} />);

        expect(Array.from(screen.getByRole('list', { name: 'LoRAs' }).querySelectorAll('li')).map(item => item.textContent))
            .toEqual(['Frostbite', 'Moriime']);
    });

    it('opens the selected preset with its key, grouping, and label', () => {
        presetsState.value.presets = [preset()];
        const onSelectPreset = vi.fn();
        render(<PresetsView filters={createDefaultFilters()} onSelectPreset={onSelectPreset} />);

        fireEvent.click(screen.getByRole('button', { name: /^Show 128 images using preset 1/ }));

        expect(onSelectPreset).toHaveBeenCalledWith({ key: 'k1', matchWeights: true, label: 'WAI · Frostbite (0.80) · Moriime (1.00) · euler' });
    });

    it('regroups without LoRA weights and remembers the choice', () => {
        const { unmount } = render(<PresetsView filters={createDefaultFilters()} onSelectPreset={vi.fn()} />);

        expect((screen.getByLabelText('Ignore LoRA weights') as HTMLInputElement).checked).toBe(false);
        fireEvent.click(screen.getByLabelText('Ignore LoRA weights'));

        expect(presetsState.calls.at(-1)).toBe(false);
        unmount();
        render(<PresetsView filters={createDefaultFilters()} onSelectPreset={vi.fn()} />);
        expect((screen.getByLabelText('Ignore LoRA weights') as HTMLInputElement).checked).toBe(true);
    });

    it('shows loading, empty, and retryable error states', () => {
        presetsState.value.isLoading = true;
        const { rerender } = render(<PresetsView filters={createDefaultFilters()} onSelectPreset={vi.fn()} />);
        expect(screen.getByRole('status').textContent).toContain('Analyzing');

        presetsState.value = { ...presetsState.value, isLoading: false };
        rerender(<PresetsView filters={createDefaultFilters()} onSelectPreset={vi.fn()} />);
        expect(screen.getByText('No presets found')).toBeTruthy();

        presetsState.value = { ...presetsState.value, error: new Error('busy') };
        rerender(<PresetsView filters={createDefaultFilters()} onSelectPreset={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
        expect(presetsState.value.retry).toHaveBeenCalled();
    });
});
