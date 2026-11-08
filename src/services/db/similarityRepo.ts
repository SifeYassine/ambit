import type { AIImage } from '../../types';
import { isBrowserMockMode } from '../runtime';
import { getDb } from './connection';
import { getImagesByIds } from './imageRepo';

const ID_CHUNK = 500;

/**
 * Keeps the ids the gallery scope would show, in their given order. `where` comes from
 * buildSqlWhereClause, so owner scope, privacy and view toggles apply as in the gallery.
 */
export const getVisibleImageIds = async (ids: string[], where: string, params: unknown[]): Promise<string[]> => {
    if (ids.length === 0 || isBrowserMockMode()) return [];
    const db = await getDb();
    const and = where ? 'AND' : 'WHERE';
    const visible = new Set<string>();
    for (let start = 0; start < ids.length; start += ID_CHUNK) {
        const chunk = ids.slice(start, start + ID_CHUNK);
        const rows = await db.select<{ id: string }[]>(
            `SELECT images.id AS id FROM scoped_images AS images ${where} ${and} images.id IN (${chunk.map(() => '?').join(',')})`,
            [...params, ...chunk]
        );
        rows.forEach(row => visible.add(row.id));
    }
    return ids.filter(id => visible.has(id));
};

/** The visible images among `ids`, in their given order. */
export const getVisibleImagesInOrder = async (ids: string[], where: string, params: unknown[]): Promise<AIImage[]> => {
    const visible = await getVisibleImageIds(ids, where, params);
    const imagesById = new Map((await getImagesByIds(visible)).map(image => [image.id, image]));
    return visible.flatMap(id => imagesById.get(id) ?? []);
};
