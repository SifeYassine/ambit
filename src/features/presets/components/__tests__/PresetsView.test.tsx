import * as React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '../../../../test/testUtils';
import { createDefaultFilters } from '../../../../utils/filterState';
import type { GenerationPreset } from '../../../../services/db/presetRepo';
import { PresetsView, usePresetsViewStore } from '../PresetsView';

const presetsState = vi.hoisted(() => ({
    value: { presets: [] as GenerationPreset[], isLoading: false, error: null as Error | null, retry: vi.fn() },
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
        presetsState.value = { presets: [], isLoading: false, error: null, retry: vi.fn() };
        presetsState.calls = [];
        usePresetsViewStore.setState({ matchWeights: true });
    });

    it('lists presets with settings, an image count badge, and typical steps and CFG', () => {
        presetsState.value.presets = [preset(), preset({ key: 'k2', model: 'Nova', loras: [], count: 1, typicalSteps: null, typicalCfg: null })];
        render(<PresetsView filters={createDefaultFilters()} onSelectPreset={vi.fn()} />);

        const cards = screen.getAllByRole('button', { name: /^Show / });
        expect(cards).toHaveLength(2);
        expect(screen.getByText('128 images')).toBeTruthy();
        expect(screen.getByText('1 image')).toBeTruthy();
        expect(screen.getByText('Frostbite (0.80)')).toBeTruthy();
        expect(screen.getByText('None')).toBeTruthy();
        expect(screen.getByText('Usually 28 steps · CFG 6')).toBeTruthy();
        expect(screen.getAllByText(/^Usually/)).toHaveLength(1);
    });

    it('lists up to five LoRAs, one per line, and counts the rest', () => {
        const loras = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'];
        presetsState.value.presets = [preset({ loras })];
        render(<PresetsView filters={createDefaultFilters()} onSelectPreset={vi.fn()} />);

        const list = screen.getByRole('list', { name: 'LoRAs' });
        expect(Array.from(list.querySelectorAll('li')).map(item => item.textContent)).toEqual([...loras.slice(0, 5), '+3 more']);
        expect(screen.getByTitle(loras.join(', '))).toBeTruthy();
    });

    it('opens the selected preset with its key, grouping, and label', () => {
        presetsState.value.presets = [preset()];
        const onSelectPreset = vi.fn();
        render(<PresetsView filters={createDefaultFilters()} onSelectPreset={onSelectPreset} />);

        fireEvent.click(screen.getByRole('button', { name: /^Show 128 images using preset 1/ }));

        expect(onSelectPreset).toHaveBeenCalledWith({ key: 'k1', matchWeights: true, label: 'WAI · Frostbite (0.80) · Moriime · euler' });
    });

    it('regroups without LoRA weights and remembers the choice', () => {
        const { unmount } = render(<PresetsView filters={createDefaultFilters()} onSelectPreset={vi.fn()} />);

        fireEvent.click(screen.getByLabelText('Group by LoRA weights'));

        expect(presetsState.calls.at(-1)).toBe(false);
        unmount();
        render(<PresetsView filters={createDefaultFilters()} onSelectPreset={vi.fn()} />);
        expect((screen.getByLabelText('Group by LoRA weights') as HTMLInputElement).checked).toBe(false);
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
