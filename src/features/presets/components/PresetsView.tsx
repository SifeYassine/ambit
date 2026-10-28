import * as React from 'react';
import { AlertCircle, CheckCircle, ImageOff, Layers, Loader2, RotateCcw } from 'lucide-react';
import type { FilterState, PresetFilter } from '../../../types';
import type { GenerationPreset } from '../../../services/db/presetRepo';
import { PrivacyAwareThumbnail } from '../../../components/ui/PrivacyAwareThumbnail';
import { useSettingsStore } from '../../../stores/settingsStore';
import { getEffectiveMaskedKeywords, isImageMasked } from '../../../utils/maskingUtils';
import { formatModelName } from '../../../utils/formatUtils';
import { usePresets } from '../hooks/usePresets';
import { usePresetsViewStore } from '../presetsViewStore';

const MIN_CARD_WIDTH = 160;

export { usePresetsViewStore };

interface PresetsViewProps {
    filters: FilterState;
    onSelectPreset: (preset: PresetFilter) => void;
}

const HAS_LORA_WEIGHT = /\s\(-?\d+(?:\.\d+)?\)$/;

/** With weight grouping on, an implicit weight is shown as (1.00) so every LoRA carries one. */
export const formatPresetLora = (lora: string, matchWeights: boolean): string =>
    matchWeights && !HAS_LORA_WEIGHT.test(lora) ? `${lora} (1.00)` : lora;

export const getPresetLabel = (preset: GenerationPreset, matchWeights: boolean): string =>
    [formatModelName(preset.model), ...preset.loras.map(lora => formatPresetLora(lora, matchWeights)), preset.sampler].join(' · ');

const formatCfg = (cfg: number): string => String(Math.round(cfg * 100) / 100);

// Rounded "smart tag" boxes; each setting key gets its own colour so rows scan quickly.
const TAG_BOX_CLASS = 'rounded-md px-2 py-1';
const KEY_TAG_CLASS = `${TAG_BOX_CLASS} shrink-0 text-[10px] font-bold uppercase tracking-wider`;
const KEY_TAG_COLORS = {
    model: 'bg-purple-100 text-purple-700 dark:bg-purple-500/15 dark:text-purple-300',
    loras: 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300',
    sampler: 'bg-pink-100 text-pink-700 dark:bg-pink-500/15 dark:text-pink-300',
} as const;
// Hover matches the viewer's resource chips.
const VALUE_TAG_CLASS = `${TAG_BOX_CLASS} min-w-0 truncate border border-gray-200 bg-white text-xs text-gray-800 transition-colors hover:border-sage-500/30 hover:bg-gray-200 dark:border-white/10 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-white/10`;

const PresetSettingTag = ({ label, keyColor, value }: { label: string; keyColor: keyof typeof KEY_TAG_COLORS; value: string }) => (
    <div className="flex min-w-0 items-center gap-1.5">
        <span className={`${KEY_TAG_CLASS} ${KEY_TAG_COLORS[keyColor]}`}>{label}</span>
        <span className={VALUE_TAG_CLASS} title={value}>{value}</span>
    </div>
);

export const COLLAPSED_LORA_COUNT = 2;

/**
 * Collapsed, every card reserves exactly two LoRA lines so collapsed cards match, and the toggle
 * sits on the label row. Expanding grows only this card: the grid aligns cards to the row top.
 */
const PresetLoraList = ({ loras }: { loras: string[] }) => {
    const [isExpanded, setIsExpanded] = React.useState(false);
    const hidden = Math.max(0, loras.length - COLLAPSED_LORA_COUNT);
    const visible = isExpanded ? loras : loras.slice(0, COLLAPSED_LORA_COUNT);

    return (
        <div className="min-w-0">
            <div className="flex items-center justify-between gap-2">
                <span className={`${KEY_TAG_CLASS} ${KEY_TAG_COLORS.loras}`}>LoRAs</span>
                {hidden > 0 && (
                    <button
                        type="button"
                        aria-expanded={isExpanded}
                        onClick={event => {
                            event.stopPropagation();
                            setIsExpanded(expanded => !expanded);
                        }}
                        className="relative z-10 rounded-md px-1.5 py-0.5 text-xs font-medium text-sky-700 hover:bg-sky-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 dark:text-sky-300 dark:hover:bg-sky-500/10"
                    >
                        {isExpanded ? 'Show less' : `+${hidden} more`}
                    </button>
                )}
            </div>
            <ul aria-label="LoRAs" className="mt-1.5 flex min-h-[3.5rem] flex-col gap-1">
                {visible.length > 0
                    ? visible.map((lora, index) => (
                        <li key={`${lora}-${index}`} title={lora} className={`${VALUE_TAG_CLASS} block w-fit max-w-full`}>{lora}</li>
                    ))
                    : <li className={`${VALUE_TAG_CLASS} block w-fit italic text-gray-400 dark:text-zinc-500`}>None</li>}
            </ul>
        </div>
    );
};

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
                    // Hovering the card zooms the image inside its frame, like gallery cards (the frame clips it).
                    wrapperClassName="h-full w-full transition-transform duration-700 ease-spring group-hover/card:scale-[1.15] motion-reduce:transition-none"
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

const PresetCard = ({ preset, rank, matchWeights, onSelect }: {
    preset: GenerationPreset;
    rank: number;
    matchWeights: boolean;
    onSelect: () => void;
}) => {
    const typical = [
        preset.typicalSteps !== null ? `${preset.typicalSteps} steps` : null,
        preset.typicalCfg !== null ? `CFG ${formatCfg(preset.typicalCfg)}` : null,
    ].filter((part): part is string => part !== null);

    // The full-card button sits underneath the content (as in ImageCard) for keyboard users, so the
    // LoRA toggle can be its own button. The content stays hoverable for tooltips and opens the
    // preset on click itself.
    return (
        <li className="group/card relative flex flex-col gap-3 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm transition-all hover:border-sage-300 hover:shadow-lg dark:border-white/10 dark:bg-zinc-900 dark:hover:border-sage-500/40">
            <button
                type="button"
                onClick={onSelect}
                aria-label={`Show ${preset.count} images using preset ${rank}: ${getPresetLabel(preset, matchWeights)}`}
                className="absolute inset-0 cursor-pointer rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sage-500"
            />
            <div className="relative flex cursor-pointer flex-col gap-3" onClick={onSelect}>
                <PresetSample preset={preset} />
                <div className="flex items-center justify-between gap-2 px-1">
                    <h2 className="truncate text-base font-bold text-gray-900 dark:text-white">Preset {rank}</h2>
                    <span className={`${TAG_BOX_CLASS} shrink-0 bg-sage-500 text-xs font-bold text-white`} title={`${preset.count} images`}>
                        {preset.count.toLocaleString()} {preset.count === 1 ? 'image' : 'images'}
                    </span>
                </div>
                <div className="space-y-2 px-1">
                    <PresetSettingTag label="Model" keyColor="model" value={formatModelName(preset.model)} />
                    <PresetLoraList loras={preset.loras.map(lora => formatPresetLora(lora, matchWeights))} />
                    <PresetSettingTag label="Sampler" keyColor="sampler" value={preset.sampler} />
                </div>
                <p className="px-1 text-[11px] text-gray-500 dark:text-zinc-400">
                    {typical.length > 0 ? `Usually ${typical.join(' · ')}` : 'No recorded steps or CFG'}
                </p>
            </div>
        </li>
    );
};

export const PresetsView: React.FC<PresetsViewProps> = ({ filters, onSelectPreset }) => {
    const matchWeights = usePresetsViewStore(state => state.matchWeights);
    // The checkbox reads as "ignore", so checked merges presets that differ only in LoRA weights.
    const ignoreWeights = !matchWeights;
    const setMatchWeights = usePresetsViewStore(state => state.setMatchWeights);
    const toggleId = React.useId();
    const { presets, isLoading, isRefreshing, error, retry } = usePresets(filters, matchWeights);
    // Cards follow the gallery's Thumbnail Size slider, with a floor that keeps their text readable.
    const thumbnailSize = useSettingsStore(state => state.settings.thumbnailSize);
    const cardMinWidth = Math.max(thumbnailSize, MIN_CARD_WIDTH);

    return (
        <div className="flex h-full flex-col overflow-hidden">
            <div className="custom-scrollbar flex-1 overflow-y-auto px-6 pb-8 pt-4" style={{ scrollbarGutter: 'stable' }}>
            {/* Same round check as gallery selection; the native checkbox stays for keyboard and screen readers. */}
            <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1">
            <label htmlFor={toggleId} className="inline-flex cursor-pointer items-center gap-2 text-sm text-gray-700 dark:text-zinc-200">
                <input
                    id={toggleId}
                    type="checkbox"
                    checked={ignoreWeights}
                    onChange={event => setMatchWeights(!event.target.checked)}
                    className="peer sr-only"
                />
                <span
                    aria-hidden="true"
                    className={`flex h-5 w-5 items-center justify-center rounded-full border shadow-sm transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-sage-500 ${ignoreWeights
                        ? 'border-sage-500 bg-sage-500'
                        : 'border-gray-300 bg-white hover:bg-gray-100 dark:border-white/30 dark:bg-black/40 dark:hover:bg-black/60'}`}
                >
                    {ignoreWeights && <CheckCircle className="h-3.5 w-3.5 text-white" />}
                </span>
                Ignore LoRA weights
            </label>
            {!isLoading && !error && (
                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600 dark:bg-white/10 dark:text-zinc-300">
                    {presets.length.toLocaleString()} {presets.length === 1 ? 'preset' : 'presets'}
                </span>
            )}
            {isRefreshing && (
                <span role="status" className="inline-flex items-center gap-1.5 text-xs text-gray-500 dark:text-zinc-400">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Updating…
                </span>
            )}
            </div>


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
                <ol
                    aria-label="Presets"
                    className="grid items-start gap-4"
                    style={{ gridTemplateColumns: `repeat(auto-fill, minmax(min(100%, ${cardMinWidth}px), 1fr))` }}
                >
                    {presets.map((preset, index) => (
                        <PresetCard
                            key={preset.key}
                            preset={preset}
                            rank={index + 1}
                            matchWeights={matchWeights}
                            onSelect={() => onSelectPreset({ key: preset.key, matchWeights, label: getPresetLabel(preset, matchWeights) })}
                        />
                    ))}
                </ol>
            )}
            </div>
        </div>
    );
};
