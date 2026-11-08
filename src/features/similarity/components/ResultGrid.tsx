import * as React from 'react';
import type { AIImage } from '../../../types';
import { ImageCard } from '../../library/components/ImageCard';
import { VirtualGrid } from '../../library/components/VirtualGrid';
import { useSettingsStore } from '../../../stores/settingsStore';
import { getEffectiveMaskedKeywords, isImageMasked } from '../../../utils/maskingUtils';

/** Same spacing as the gallery grid. */
const GRID_GAP = 16;
const GRID_PADDING = 24;

export interface ResultItem {
    id: string;
    image: AIImage;
    /** Shown on hover for search results; clusters have none. */
    similarity?: number;
}

/** A gallery card (same component and grid) with the similarity score shown on hover. */
const ResultCell = ({ item, style, isMasked, onOpen }: { item: ResultItem; style: React.CSSProperties; isMasked: boolean; onOpen: () => void }) => (
    <div style={style} className="group/result absolute left-0 top-0">
        <ImageCard image={item.image} isSelected={false} isMasked={isMasked} onClick={onOpen} />
        {item.similarity !== undefined && (
            <span className="pointer-events-none absolute left-1/2 top-2 z-30 -translate-x-1/2 whitespace-nowrap rounded-md border border-white/20 bg-black/70 px-2 py-1 text-[11px] font-bold text-green-300 opacity-0 shadow-lg backdrop-blur-md transition-opacity duration-200 group-hover/result:opacity-100">
                Similarity: {(item.similarity * 100).toFixed(1)}%
            </span>
        )}
    </div>
);

export interface ResultGridProps {
    items: ResultItem[];
    scrollContainerRef: React.RefObject<HTMLDivElement | null>;
    onOpenResult: (images: AIImage[], index: number) => void;
}

/** The gallery's grid and cards for search results and clusters alike. */
export const ResultGrid = ({ items, scrollContainerRef, onOpenResult }: ResultGridProps) => {
    const settings = useSettingsStore(state => state.settings);
    const privacyEnabled = useSettingsStore(state => state.privacyEnabled);
    const maskedKeywords = getEffectiveMaskedKeywords(settings);
    const images = React.useMemo(() => items.map(item => item.image), [items]);
    const getItemRatio = React.useCallback((item: ResultItem) => (item.image.width || 1) / (item.image.height || 1), []);
    if (items.length === 0) return null;
    return (
        <VirtualGrid<ResultItem>
            items={items}
            layout={settings.libraryLayoutMode ?? 'masonry'}
            minItemWidth={settings.thumbnailSize}
            gap={GRID_GAP}
            padding={GRID_PADDING}
            scrollContainerRef={scrollContainerRef}
            getItemRatio={getItemRatio}
            renderItem={(item, style, index) => (
                <ResultCell
                    key={item.id}
                    item={item}
                    style={style}
                    isMasked={isImageMasked(item.image, privacyEnabled, maskedKeywords)}
                    onOpen={() => onOpenResult(images, index)}
                />
            )}
        />
    );
};

/** Centered title (and optional subtitle) with Clear results at the right of the title row. */
export const ResultHeader = ({ center, subtitle, action }: { center: React.ReactNode; subtitle?: string; action: React.ReactNode }) => (
    <>
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 px-6">
            <span aria-hidden="true" />
            {center}
            <div className="flex justify-end">{action}</div>
        </div>
        {subtitle && (
            <p className="mt-1 truncate px-6 text-center text-sm text-gray-500 dark:text-zinc-400" title={subtitle}>{subtitle}</p>
        )}
    </>
);
