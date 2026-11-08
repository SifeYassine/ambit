import * as React from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { ImageOff, ImagePlus, Loader2, Search, Settings2, Type, X } from 'lucide-react';
import { PrivacyAwareThumbnail } from '../../../components/ui/PrivacyAwareThumbnail';
import { useSettingsStore } from '../../../stores/settingsStore';
import { MAX_TOP_K, useSimilarityStore } from '../../../stores/similarityStore';
import { getEffectiveMaskedKeywords, isImageMasked } from '../../../utils/maskingUtils';
import { getFilename } from '../../../utils/pathUtils';
import { useSimilarityStatus } from '../hooks/useSimilarity';
import { INPUT_CLASS, LABEL_CLASS, PRIMARY_BUTTON_CLASS, SECONDARY_BUTTON_CLASS, SimilarityCard, SimilarityError } from './SimilarityCard';

const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif', 'tif', 'tiff'];

const ImageQueryPreview = () => {
    const imageQuery = useSimilarityStore(state => state.imageQuery);
    const setImageQuery = useSimilarityStore(state => state.setImageQuery);
    const settings = useSettingsStore(state => state.settings);
    const privacyEnabled = useSettingsStore(state => state.privacyEnabled);
    const [fileFailed, setFileFailed] = React.useState(false);
    React.useEffect(() => setFileFailed(false), [imageQuery]);
    if (!imageQuery) return null;

    const name = imageQuery.kind === 'file' ? getFilename(imageQuery.path) : getFilename(imageQuery.image.filename);
    return (
        <div className="flex items-center gap-3">
            <div className="relative h-32 w-32 shrink-0">
                <div className="h-full w-full overflow-hidden rounded-lg border border-gray-200 bg-gray-100 dark:border-white/10 dark:bg-white/5">
                    {imageQuery.kind === 'libraryImage' ? (
                        <PrivacyAwareThumbnail
                            src={imageQuery.image.thumbnailUrl}
                            alt={name}
                            isSensitive={isImageMasked(imageQuery.image, privacyEnabled, getEffectiveMaskedKeywords(settings))}
                            wrapperClassName="h-full w-full"
                            fallback={<ImageOff className="h-6 w-6" />}
                        />
                    ) : fileFailed ? (
                        <div className="flex h-full w-full items-center justify-center text-gray-300 dark:text-zinc-600">
                            <ImageOff className="h-6 w-6" aria-hidden="true" />
                        </div>
                    ) : (
                        <img
                            src={convertFileSrc(imageQuery.path.replace(/\\/g, '/'))}
                            alt={name}
                            className="h-full w-full object-cover"
                            onError={() => setFileFailed(true)}
                        />
                    )}
                </div>
                <button
                    type="button"
                    onClick={() => setImageQuery(null)}
                    aria-label="Remove query image"
                    className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-red-500 text-white shadow hover:bg-red-600"
                >
                    <X className="h-3 w-3" aria-hidden="true" />
                </button>
            </div>
            <div className="min-w-0 text-sm">
                <p className="truncate font-medium text-gray-800 dark:text-zinc-100" title={name}>{name}</p>
                <p className="text-xs text-gray-500 dark:text-zinc-400">
                    {imageQuery.kind === 'libraryImage' ? 'From your library' : 'From a file'}
                </p>
            </div>
        </div>
    );
};

/** SmartSim's search tab: parameters, search by text and search by image. */
export const SearchPanel = ({ isSearching, error }: { isSearching: boolean; error: string | null }) => {
    const { data: status } = useSimilarityStatus();
    const topK = useSimilarityStore(state => state.topK);
    const threshold = useSimilarityStore(state => state.threshold);
    const textQuery = useSimilarityStore(state => state.textQuery);
    const imageQuery = useSimilarityStore(state => state.imageQuery);
    const { setTopK, setThreshold, setTextQuery, setImageQuery, submitTextSearch, submitImageSearch } = useSimilarityStore.getState();

    const canSearchText = Boolean(status?.modelInstalled);
    // An indexed library image is searched by its stored embedding, so it works without the model.
    const canSearchImage = imageQuery !== null
        && (Boolean(status?.modelInstalled) || (imageQuery.kind === 'libraryImage' && (status?.indexedCount ?? 0) > 0));
    const searchIcon = isSearching
        ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        : <Search className="h-4 w-4" aria-hidden="true" />;

    const chooseImageFile = async () => {
        const { open } = await import('@tauri-apps/plugin-dialog');
        const selected = await open({ multiple: false, directory: false, filters: [{ name: 'Images', extensions: IMAGE_EXTENSIONS }] });
        if (typeof selected === 'string') setImageQuery({ kind: 'file', path: selected });
    };

    return (
        <>
            <SimilarityCard icon={<Settings2 className="h-5 w-5" aria-hidden="true" />} title="Search Parameters">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <label className={LABEL_CLASS}>
                        <span className="mb-1 block">Number of Results</span>
                        <input
                            type="number"
                            min={1}
                            max={MAX_TOP_K}
                            value={topK}
                            onChange={event => {
                                const value = Math.round(Number(event.target.value));
                                if (Number.isFinite(value)) setTopK(Math.min(MAX_TOP_K, Math.max(1, value)));
                            }}
                            className={INPUT_CLASS}
                        />
                    </label>
                    <label className={LABEL_CLASS}>
                        <span className="mb-1 block">Similarity Threshold</span>
                        <input
                            type="number"
                            step={0.01}
                            min={0}
                            max={1}
                            value={threshold}
                            onChange={event => {
                                const value = Number(event.target.value);
                                if (Number.isFinite(value)) setThreshold(Math.min(1, Math.max(0, value)));
                            }}
                            className={INPUT_CLASS}
                        />
                    </label>
                </div>
            </SimilarityCard>

            <SimilarityCard icon={<Type className="h-5 w-5" aria-hidden="true" />} title="Search by Text">
                <div className="flex flex-col gap-3">
                    <input
                        type="text"
                        placeholder="Describe what you're looking for..."
                        value={textQuery}
                        onChange={event => setTextQuery(event.target.value)}
                        onKeyDown={event => {
                            if (event.key === 'Enter' && canSearchText && textQuery.trim()) submitTextSearch();
                        }}
                        className={INPUT_CLASS}
                    />
                    <button
                        type="button"
                        onClick={submitTextSearch}
                        disabled={!canSearchText || !textQuery.trim() || isSearching}
                        className={PRIMARY_BUTTON_CLASS}
                    >
                        {searchIcon} Search
                    </button>
                </div>
            </SimilarityCard>

            <SimilarityCard icon={<ImagePlus className="h-5 w-5" aria-hidden="true" />} title="Search by Image">
                <div className="flex flex-col gap-3">
                    <div className="flex flex-wrap items-center gap-3">
                        <button type="button" onClick={() => void chooseImageFile()} className={SECONDARY_BUTTON_CLASS}>
                            <ImagePlus className="h-4 w-4" aria-hidden="true" /> Choose image file…
                        </button>
                        <span className="text-xs text-gray-500 dark:text-zinc-400">or use Find Similar in the image viewer</span>
                    </div>
                    <ImageQueryPreview />
                    <button
                        type="button"
                        onClick={submitImageSearch}
                        disabled={!canSearchImage || isSearching}
                        className={PRIMARY_BUTTON_CLASS}
                    >
                        {searchIcon} {isSearching ? 'Searching...' : 'Search'}
                    </button>
                </div>
            </SimilarityCard>

            {error && <SimilarityError message={error} />}
        </>
    );
};
