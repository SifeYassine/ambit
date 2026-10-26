import { commands } from '../../bindings';
import type { AIImage } from '../../types';
import { timeDbCall } from '../../utils/dbTiming';
import { unwrap } from '../../utils/spectaUtils';
import { isBrowserMockMode } from '../runtime';
import { getDb } from './connection';
import { getImagesByIds } from './imageRepo';

export const PRESET_LIMIT = 200;
export const PRESET_SAMPLE_COUNT = 4;

export interface GenerationPreset {
    key: string;
    model: string;
    sampler: string;
    loras: string[];
    count: number;
    /** Most common value among the preset's images; null when none was recorded. */
    typicalSteps: number | null;
    typicalCfg: number | null;
    sampleImages: AIImage[];
}

interface PresetRow {
    preset_key: string;
    image_count: number;
    model: string;
    sampler: string;
    loras: string;
}

interface PresetValueRow {
    preset_key: string;
    value: number;
    image_count: number;
}

interface PresetSampleRow {
    preset_key: string;
    image_id: string;
}

/** Recomputes the image_presets cache from current metadata. Returns how many images have a preset. */
export const rebuildGenerationPresets = async (): Promise<number> => {
    if (isBrowserMockMode()) return 0;
    return unwrap(commands.rebuildGenerationPresets());
};

const parseLoras = (value: string): string[] => {
    try {
        const parsed: unknown = JSON.parse(value);
        return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
    } catch {
        return [];
    }
};

const mostCommonValues = (rows: PresetValueRow[]): Map<string, number> => {
    const best = new Map<string, PresetValueRow>();
    for (const row of rows) {
        const current = best.get(row.preset_key);
        if (!current || row.image_count > current.image_count) best.set(row.preset_key, row);
    }
    return new Map(Array.from(best, ([key, row]) => [key, row.value]));
};

/**
 * Groups visible images by preset. `where` comes from buildSqlWhereClause, so counts follow the
 * same scope, privacy, and view toggles as the gallery the preset opens.
 */
export const getGenerationPresets = async (
    where: string,
    params: unknown[],
    matchWeights: boolean
): Promise<GenerationPreset[]> => {
    if (isBrowserMockMode()) return [];

    const keyColumn = matchWeights ? 'strict_key' : 'loose_key';
    const lorasColumn = matchWeights ? 'preset_loras_strict' : 'preset_loras_loose';
    const from = `FROM image_presets p JOIN scoped_images AS images ON images.id = p.image_id ${where}`;
    const and = where ? 'AND' : 'WHERE';
    const db = await getDb();

    return timeDbCall('generationPresets', matchWeights ? 'strict' : 'loose', async () => {
        const presetRows = await db.select<PresetRow[]>(
            `SELECT p.${keyColumn} AS preset_key, COUNT(*) AS image_count,
                MIN(p.preset_model) AS model, MIN(p.preset_sampler) AS sampler, MIN(p.${lorasColumn}) AS loras
             ${from}
             GROUP BY p.${keyColumn}
             ORDER BY image_count DESC, model ASC
             LIMIT ${PRESET_LIMIT}`,
            params
        );
        if (presetRows.length === 0) return [];

        const [stepRows, cfgRows, sampleRows] = await Promise.all([
            db.select<PresetValueRow[]>(
                `SELECT p.${keyColumn} AS preset_key, images.steps AS value, COUNT(*) AS image_count
                 ${from} ${and} images.steps > 0
                 GROUP BY p.${keyColumn}, images.steps`,
                params
            ),
            db.select<PresetValueRow[]>(
                `SELECT p.${keyColumn} AS preset_key, images.cfg AS value, COUNT(*) AS image_count
                 ${from} ${and} images.cfg > 0
                 GROUP BY p.${keyColumn}, images.cfg`,
                params
            ),
            db.select<PresetSampleRow[]>(
                `SELECT preset_key, image_id FROM (
                    SELECT p.${keyColumn} AS preset_key, images.id AS image_id,
                        ROW_NUMBER() OVER (
                            PARTITION BY p.${keyColumn}
                            ORDER BY COALESCE(images.display_timestamp, images.timestamp) DESC, images.id DESC
                        ) AS sample_rank
                    ${from}
                 ) WHERE sample_rank <= ${PRESET_SAMPLE_COUNT}`,
                params
            ),
        ]);

        const presetKeys = new Set(presetRows.map(row => row.preset_key));
        const samplesByKey = new Map<string, string[]>();
        for (const row of sampleRows) {
            if (!presetKeys.has(row.preset_key)) continue;
            samplesByKey.set(row.preset_key, [...(samplesByKey.get(row.preset_key) ?? []), row.image_id]);
        }
        const sampleImages = await getImagesByIds(Array.from(samplesByKey.values()).flat());
        const imagesById = new Map(sampleImages.map(image => [image.id, image]));
        const typicalSteps = mostCommonValues(stepRows);
        const typicalCfg = mostCommonValues(cfgRows);

        return presetRows.map(row => ({
            key: row.preset_key,
            model: row.model,
            sampler: row.sampler,
            loras: parseLoras(row.loras),
            count: Number(row.image_count),
            typicalSteps: typicalSteps.get(row.preset_key) ?? null,
            typicalCfg: typicalCfg.get(row.preset_key) ?? null,
            sampleImages: (samplesByKey.get(row.preset_key) ?? [])
                .map(id => imagesById.get(id))
                .filter((image): image is AIImage => image !== undefined),
        }));
    });
};
