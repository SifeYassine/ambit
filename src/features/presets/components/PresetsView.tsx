import * as React from 'react';
import { create } from 'zustand';
import { AlertCircle, Boxes, ImageOff, Images, Layers, Loader2, RotateCcw, SlidersHorizontal } from 'lucide-react';
import type { FilterState, PresetFilter } from '../../../types';
import type { GenerationPreset } from '../../../services/db/presetRepo';
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

export const MAX_VISIBLE_LORAS = 3;

const KEY_PILL_CLASS = 'shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:bg-white/5 dark:text-zinc-400';
const VALUE_PILL_CLASS = 'min-w-0 truncate rounded-full border border-gray-200 bg-white px-2 py-0.5 text-xs text-gray-800 dark:border-white/10 dark:bg-zinc-800 dark:text-zinc-200';

const PresetSettingPills = ({ label, values, overflow = 0, emptyLabel, title }: {
    label: string;
    values: string[];
    overflow?: number;
    emptyLabel?: string;
    /** Full text on hover when some values are hidden. */
    title?: string;
}) => (
    <div className="flex min-w-0 items-center gap-1.5" title={title ?? (values.join(', ') || emptyLabel)}>
        <span className={KEY_PILL_CLASS}>{label}</span>
        {values.length > 0
            ? values.map((value, index) => <span key={`${value}-${index}`} className={`${VALUE_PILL_CLASS} max-w-[9rem]`}>{value}</span>)
            : <span className={`${VALUE_PILL_CLASS} italic text-gray-400 dark:text-zinc-500`}>{emptyLabel}</span>}
        {overflow > 0 && <span className="shrink-0 text-xs font-medium text-gray-500 dark:text-zinc-400">+{overflow}</span>}
    </div>
);

const PresetSample = ({ preset }: { preset: GenerationPreset }) => {
    const settings = useSettingsStore(state => state.settings);
    const privacyEnabled = useSettingsStore(state => state.privacyEnabled);
    const image = preset.sampleImages[0];

    return (
        <div className="aspect-[4/5] w-full overflow-hidden rounded-xl bg-gray-100 dark:bg-white/5">
            {image ? (
                <PrivacyAwareThumbnail
                    src={image.thumbnailUrl}
                    alt=""
                    isSensitive={isImageMasked(image, privacyEnabled, getEffectiveMaskedKeywords(settings))}
                    wrapperClassName="h-full w-full"
                    fallback={<ImageOff className="h-8 w-8" />}
                />
            ) : (
                <div className="flex h-full w-full items-center justify-center text-gray-300 dark:text-zinc-600">
                    <ImageOff className="h-8 w-8" aria-hidden="true" />
                </div>
            )}
        </div>
    );
};

const PresetCard = ({ preset, rank, onSelect }: { preset: GenerationPreset; rank: number; onSelect: () => void }) => {
    const typical = [
        preset.typicalSteps !== null ? `${preset.typicalSteps} steps` : null,
        preset.typicalCfg !== null ? `CFG ${formatCfg(preset.typicalCfg)}` : null,
    ].filter((part): part is string => part !== null);
    const visibleLoras = preset.loras.slice(0, MAX_VISIBLE_LORAS);

    return (
        <li className="h-full">
            <button
                type="button"
                onClick={onSelect}
                aria-label={`Show ${preset.count} images using preset ${rank}: ${getPresetLabel(preset)}`}
                className="group flex h-full w-full flex-col gap-3 rounded-2xl border border-gray-200 bg-white p-3 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-sage-300 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sage-500 dark:border-white/10 dark:bg-zinc-900 dark:hover:border-sage-500/40"
            >
                <PresetSample preset={preset} />
                <div className="flex items-center justify-between gap-2 px-1">
                    <h2 className="truncate text-base font-bold text-gray-900 dark:text-white">Preset {rank}</h2>
                    <span className="shrink-0 rounded-full bg-sage-500 px-2.5 py-1 text-xs font-bold text-white" title={`${preset.count} images`}>
                        {preset.count.toLocaleString()} {preset.count === 1 ? 'image' : 'images'}
                    </span>
                </div>
                <div className="space-y-2 px-1">
                    <PresetSettingPills label="Model" values={[formatModelName(preset.model)]} />
                    <PresetSettingPills
                        label="LoRAs"
                        values={visibleLoras}
                        overflow={preset.loras.length - visibleLoras.length}
                        emptyLabel="None"
                        title={preset.loras.join(', ') || 'None'}
                    />
                    <PresetSettingPills label="Sampler" values={[preset.sampler]} />
                </div>
                <p className="px-1 text-[11px] text-gray-500 dark:text-zinc-400">
                    {typical.length > 0 ? `Usually ${typical.join(' · ')}` : 'No recorded steps or CFG'}
                </p>
                <span className="mt-auto flex items-center justify-center gap-2 rounded-xl bg-sage-500 py-2 text-sm font-bold text-white transition-colors group-hover:bg-sage-600">
                    <Images className="h-4 w-4" aria-hidden="true" />
                    Show images
                </span>
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
                <ol aria-label="Presets" className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-4">
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
