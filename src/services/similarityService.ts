import { commands, type ClusterOptions, type SimilarityIndexResult, type SimilarityQuery, type SimilarityStatus } from '../bindings';
import type { AIImage } from '../types';
import { unwrap } from '../utils/spectaUtils';
import { isBrowserMockMode } from './runtime';
import { getImagesByIds } from './db/imageRepo';
import { getVisibleImageIds, getVisibleImagesInOrder } from './db/similarityRepo';

export type { ClusterOptions, SimilarityQuery, SimilarityStatus, SimilarityIndexResult };

/** Ranked candidates fetched before scope filtering, so hidden images do not starve top-K. */
const CANDIDATE_LIMIT = 1000;

export interface SimilarityResult {
    image: AIImage;
    similarity: number;
}

export interface SearchScope {
    where: string;
    params: unknown[];
}

export const getSimilarityStatus = async (): Promise<SimilarityStatus | null> => {
    if (isBrowserMockMode()) return null;
    return unwrap(commands.getSimilarityStatus());
};

export const downloadSimilarityModel = async (): Promise<void> => {
    await unwrap(commands.downloadSimilarityModel());
};

export const cancelSimilarityModelDownload = (): Promise<void> => commands.cancelSimilarityModelDownload();

export const deleteSimilarityModel = async (): Promise<void> => {
    await unwrap(commands.deleteSimilarityModel());
};

export const indexSimilarityEmbeddings = (): Promise<SimilarityIndexResult> =>
    unwrap(commands.indexSimilarityEmbeddings());

export const cancelSimilarityIndexing = (): Promise<void> => commands.cancelSimilarityIndexing();

/**
 * SmartSim's search: the `topK` most similar images at or above `threshold`, best first,
 * limited to what the gallery scope shows.
 */
export const searchSimilarImages = async (
    query: SimilarityQuery,
    topK: number,
    threshold: number,
    scope: SearchScope
): Promise<SimilarityResult[]> => {
    if (isBrowserMockMode()) return [];
    const matches = await unwrap(commands.searchSimilarImages(query, CANDIDATE_LIMIT, threshold));
    const scores = new Map(matches.map(match => [match.imageId, match.similarity]));
    const ids = (await getVisibleImageIds(matches.map(match => match.imageId), scope.where, scope.params)).slice(0, topK);
    const imagesById = new Map((await getImagesByIds(ids)).map(image => [image.id, image]));
    return ids.flatMap(id => {
        const image = imagesById.get(id);
        return image ? [{ image, similarity: scores.get(id) ?? 0 }] : [];
    });
};

/** SmartSim's clustering over the indexed library: image ids per cluster. */
export const clusterSimilarImages = async (options: ClusterOptions): Promise<string[][]> => {
    if (isBrowserMockMode()) return [];
    return unwrap(commands.clusterSimilarImages(options));
};

/** One cluster's images in cluster order, limited to what the gallery scope shows. */
export const getClusterImages = (ids: string[], scope: SearchScope): Promise<AIImage[]> =>
    getVisibleImagesInOrder(ids, scope.where, scope.params);
