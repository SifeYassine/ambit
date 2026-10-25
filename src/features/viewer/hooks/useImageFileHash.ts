import { useQuery } from '@tanstack/react-query';
import { computeImageFileHash } from '../../../services/db/maintenanceRepo';
import type { AIImage } from '../../../types';

export type ImageFileHashState =
    | { status: 'loading' }
    | { status: 'ready'; hash: string }
    | { status: 'unavailable' };

// The SHA-256 shown in the compare sidebar is always read from the file on disk, so an edited file never shows a
// stale hash. Size and timestamp are part of the key to recompute after a rescan.
export const useImageFileHash = (image: AIImage): ImageFileHashState => {
    const query = useQuery({
        queryKey: ['viewer', 'file-hash', image.id, image.fileSize, image.timestamp],
        queryFn: () => computeImageFileHash(image.id),
        staleTime: Infinity,
        gcTime: 1000 * 60 * 30,
        retry: false,
    });

    if (query.isPending) return { status: 'loading' };
    return query.data ? { status: 'ready', hash: query.data } : { status: 'unavailable' };
};

export const formatImageFileHash = (state: ImageFileHashState): string => {
    if (state.status === 'loading') return 'Calculating…';
    return state.status === 'ready' ? state.hash : 'Unavailable';
};
