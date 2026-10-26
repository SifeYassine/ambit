import * as React from 'react';
import { create } from 'zustand';
import { AlertCircle, Boxes, ImageOff, Layers, Loader2, RotateCcw, SlidersHorizontal } from 'lucide-react';
import type { FilterState, PresetFilter } from '../../../types';
import type { GenerationPreset } from '../../../services/db/presetRepo';
import { PRESET_SAMPLE_COUNT } from '../../../services/db/presetRepo';
import { PrivacyAwareThumbnail } from '../../../components/ui/PrivacyAwareThumbnail';
import { useSettingsStore } from '../../../stores/settingsStore';
import { getEffectiveMaskedKeywords, isImageMasked } from '../../../utils/maskingUtils';
import { formatModelName } from '../../../utils/formatUtils';
import { usePresets } from '../hooks/usePresets';

interface PresetsViewState {
    matchWeights: boolean;
    setMatchWeights: (matchWeights: boolean) => void;
}

// Kept across visits so returning from a preset's gallery keeps the chosen grouping.
export const usePresetsViewStore = create<PresetsViewState>(set => ({
    matchWeights: true,
    setMatchWeights: matchWeights => set({ matchWeights }),
}));

interface PresetsViewProps {
    filters: FilterState;
    onSelectPreset: (preset: PresetFilter) => void;
}

export const getPresetLabel = (preset: GenerationPreset): string =>
    [formatModelName(preset.model), ...preset.loras, preset.sampler].join(' · ');

const formatCfg = (cfg: number): string => String(Math.round(cfg * 100) / 100);

const PresetSettingRow = ({ label, value }: { label: string; value: string }) => (
    <div className="flex min-w-0 gap-2 text-xs">
        <dt className="w-14 shrink-0 text-gray-500 dark:text-zinc-500">{label}</dt>
        <dd className="min-w-0 break-words text-gray-800 dark:text-zinc-200" title={value}>{value}</dd>
    </div>
);

const PresetSamples = ({ preset }: { preset: GenerationPreset }) => {
    const settings = useSettingsStore(state => state.settings);
    const privacyEnabled = useSettingsStore(state => state.privacyEnabled);
    const maskedKeywords = getEffectiveMaskedKeywords(settings);

    return (
        <div className="grid h-24 w-24 shrink-0 grid-cols-2 grid-rows-2 gap-0.5 overflow-hidden rounded-xl bg-gray-100 dark:bg-white/5">
            {Array.from({ length: PRESET_SAMPLE_COUNT }, (_, index) => {
                const image = preset.sampleImages[index];
                if (!image) return <div key={index} className="bg-gray-100 dark:bg-white/5" />;
                return (
                    <PrivacyAwareThumbnail
                        key={image.id}
                        src={image.thumbnailUrl}
                        alt=""
                        isSensitive={isImageMasked(image, privacyEnabled, maskedKeywords)}
                        wrapperClassName="h-full w-full"
                        fallback={<ImageOff className="h-4 w-4" />}
                    />
                );
            })}
        </div>
    );
};

const PresetCard = ({ preset, rank, onSelect }: { preset: GenerationPreset; rank: number; onSelect: () => void }) => {
    const typical = [
        preset.typicalSteps !== null ? `${preset.typicalSteps} steps` : null,
        preset.typicalCfg !== null ? `CFG ${formatCfg(preset.typicalCfg)}` : null,
    ].filter((part): part is string => part !== null);

    return (
        <li>
            <button
                type="button"
                onClick={onSelect}
                aria-label={`Show ${preset.count} images using preset ${rank}: ${getPresetLabel(preset)}`}
                className="flex h-full w-full gap-4 rounded-2xl border border-gray-200 bg-white p-4 text-left transition-colors hover:border-sage-300 hover:bg-sage-50/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sage-500 dark:border-white/10 dark:bg-zinc-900 dark:hover:border-sage-500/40 dark:hover:bg-sage-500/5"
            >
                <PresetSamples preset={preset} />
                <div className="min-w-0 flex-1">
                    <div className="mb-2 flex items-center justify-between gap-2">
                        <span className="text-xs font-bold uppercase tracking-wider text-gray-400 dark:text-zinc-500">Preset {rank}</span>
                        <span className="rounded-full bg-sage-500 px-2 py-0.5 text-xs font-bold text-white" title={`${preset.count} images`}>
                            {preset.count.toLocaleString()} {preset.count === 1 ? 'image' : 'images'}
                        </span>
                    </div>
                    <dl className="space-y-1">
                        <PresetSettingRow label="Model" value={formatModelName(preset.model)} />
                        {preset.loras.length > 0
                            ? preset.loras.map((lora, index) => <PresetSettingRow key={`${lora}-${index}`} label="LoRA" value={lora} />)
                            : <PresetSettingRow label="LoRA" value="None" />}
                        <PresetSettingRow label="Sampler" value={preset.sampler} />
                    </dl>
                    {typical.length > 0 && (
                        <p className="mt-2 text-[11px] text-gray-500 dark:text-zinc-400">Usually {typical.join(' · ')}</p>
                    )}
                </div>
            </button>
        </li>
    );
};

export const PresetsView: React.FC<PresetsViewProps> = ({ filters, onSelectPreset }) => {
    const matchWeights = usePresetsViewStore(state => state.matchWeights);
    const setMatchWeights = usePresetsViewStore(state => state.setMatchWeights);
    const toggleId = React.useId();
    const { presets, isLoading, error, retry } = usePresets(filters, matchWeights);

    return (
        <div className="custom-scrollbar h-full overflow-y-auto p-6">
            <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
                <div>
                    <h1 className="flex items-center gap-2 text-lg font-bold text-gray-900 dark:text-white">
                        <Boxes className="h-5 w-5 text-sage-500" aria-hidden="true" />
                        Presets
                    </h1>
                    <p className="mt-1 max-w-xl text-sm text-gray-500 dark:text-zinc-400">
                        Your most used model, LoRA, and sampler combinations. Select a preset to see its images.
                    </p>
                </div>
                <label htmlFor={toggleId} className="flex cursor-pointer items-center gap-2 rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-700 dark:border-white/10 dark:text-zinc-200">
                    <SlidersHorizontal className="h-4 w-4 text-gray-400" aria-hidden="true" />
                    Group by LoRA weights
                    <input
                        id={toggleId}
                        type="checkbox"
                        checked={matchWeights}
                        onChange={event => setMatchWeights(event.target.checked)}
                        className="h-4 w-4 accent-sage-500"
                    />
                </label>
            </header>

            {error ? (
                <div role="alert" className="flex flex-col items-center gap-3 rounded-2xl border border-red-200 bg-red-50 p-8 text-center text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
                    <AlertCircle className="h-6 w-6" aria-hidden="true" />
                    <p>Could not analyze presets.</p>
                    <button type="button" onClick={retry} className="flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-1.5 font-medium hover:bg-red-100 dark:border-red-500/30 dark:hover:bg-red-500/20">
                        <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" /> Retry
                    </button>
                </div>
            ) : isLoading ? (
                <div role="status" className="flex items-center justify-center gap-2 p-12 text-sm text-gray-500 dark:text-zinc-400">
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    Analyzing generation settings…
                </div>
            ) : presets.length === 0 ? (
                <div className="flex flex-col items-center gap-2 p-12 text-center text-sm text-gray-500 dark:text-zinc-400">
                    <Layers className="h-8 w-8 text-gray-300 dark:text-zinc-600" aria-hidden="true" />
                    <p className="font-semibold text-gray-700 dark:text-zinc-200">No presets found</p>
                    <p>Presets appear once images with a recorded model or LoRA are in the library.</p>
                </div>
            ) : (
                <ol aria-label="Presets" className="grid grid-cols-1 gap-3 xl:grid-cols-2 2xl:grid-cols-3">
                    {presets.map((preset, index) => (
                        <PresetCard
                            key={preset.key}
                            preset={preset}
                            rank={index + 1}
                            onSelect={() => onSelectPreset({ key: preset.key, matchWeights, label: getPresetLabel(preset) })}
                        />
                    ))}
                </ol>
            )}
        </div>
    );
};
