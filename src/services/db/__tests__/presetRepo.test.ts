import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GeneratorTool, type AIImage } from '../../../types';

const mocks = vi.hoisted(() => ({
    select: vi.fn(),
    getImagesByIds: vi.fn(),
    rebuildGenerationPresets: vi.fn(),
    isBrowserMockMode: vi.fn(() => false),
}));

vi.mock('../connection', () => ({ getDb: async () => ({ select: mocks.select }) }));
vi.mock('../imageRepo', () => ({ getImagesByIds: mocks.getImagesByIds }));
vi.mock('../../runtime', () => ({ isBrowserMockMode: mocks.isBrowserMockMode }));
vi.mock('../../../bindings', () => ({ commands: { rebuildGenerationPresets: mocks.rebuildGenerationPresets } }));

const image = (id: string): AIImage => ({
    id, url: `${id}.png`, thumbnailUrl: `${id}-thumb.png`, filename: `${id}.png`, timestamp: 1,
    width: 1, height: 1, isFavorite: false, isPinned: false,
    metadata: { tool: GeneratorTool.COMFYUI, model: 'WAI', steps: 28, cfg: 6, sampler: 'euler', positivePrompt: '', negativePrompt: '' },
});

const respond = () => {
    mocks.select.mockImplementation(async (sql: string) => {
        if (sql.includes('ROW_NUMBER()')) {
            return [
                { preset_key: 'k1', image_id: 'a' },
                { preset_key: 'k2', image_id: 'c' },
                { preset_key: 'outside-top', image_id: 'z' },
            ];
        }
        if (sql.includes('images.steps AS value')) {
            return [
                { preset_key: 'k1', value: 20, image_count: 1 },
                { preset_key: 'k1', value: 28, image_count: 4 },
            ];
        }
        if (sql.includes('images.cfg AS value')) {
            return [{ preset_key: 'k1', value: 6.5, image_count: 3 }];
        }
        return [
            { preset_key: 'k1', image_count: 5, model: 'WAI', sampler: 'euler', loras: '["Frostbite (0.80)","Moriime"]' },
            { preset_key: 'k2', image_count: 2, model: 'Nova', sampler: 'dpmpp 2m', loras: 'not json' },
        ];
    });
};

describe('presetRepo', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.isBrowserMockMode.mockReturnValue(false);
        mocks.getImagesByIds.mockImplementation(async (ids: string[]) => ids.map(image));
        respond();
    });

    it('groups presets with counts, most common steps and CFG, and recent sample images', async () => {
        const { getGenerationPresets } = await import('../presetRepo');

        const presets = await getGenerationPresets('WHERE is_deleted = ?', [0], true);

        expect(presets).toEqual([
            expect.objectContaining({ key: 'k1', model: 'WAI', sampler: 'euler', loras: ['Frostbite (0.80)', 'Moriime'], count: 5, typicalSteps: 28, typicalCfg: 6.5 }),
            expect.objectContaining({ key: 'k2', model: 'Nova', loras: [], count: 2, typicalSteps: null, typicalCfg: null }),
        ]);
        expect(presets[0].sampleImages.map(sample => sample.id)).toEqual(['a']);
        expect(mocks.getImagesByIds).toHaveBeenCalledWith(['a', 'c']);
        expect(String(mocks.select.mock.calls[3][0])).toContain('WHERE sample_rank <= 1');

        const groupingSql = String(mocks.select.mock.calls[0][0]);
        expect(groupingSql).toContain('GROUP BY p.strict_key');
        expect(groupingSql).toContain('MIN(p.preset_loras_strict)');
        expect(groupingSql).toContain('JOIN scoped_images AS images ON images.id = p.image_id WHERE is_deleted = ?');
        expect(mocks.select.mock.calls.every(([, params]) => JSON.stringify(params) === '[0]')).toBe(true);
        expect(String(mocks.select.mock.calls[1][0])).toContain('AND images.steps > 0');
    });

    it('uses the loose key and LoRA names when weights are merged', async () => {
        const { getGenerationPresets } = await import('../presetRepo');

        await getGenerationPresets('', [], false);

        const groupingSql = String(mocks.select.mock.calls[0][0]);
        expect(groupingSql).toContain('GROUP BY p.loose_key');
        expect(groupingSql).toContain('MIN(p.preset_loras_loose)');
        expect(String(mocks.select.mock.calls[1][0])).toContain('WHERE images.steps > 0');
    });

    it('skips follow-up queries when no image has a preset', async () => {
        mocks.select.mockResolvedValue([]);
        const { getGenerationPresets } = await import('../presetRepo');

        await expect(getGenerationPresets('', [], true)).resolves.toEqual([]);
        expect(mocks.select).toHaveBeenCalledTimes(1);
        expect(mocks.getImagesByIds).not.toHaveBeenCalled();
    });

    it('rebuilds through the backend command and stays inert in browser mock mode', async () => {
        mocks.rebuildGenerationPresets.mockResolvedValue({ status: 'ok', data: 12 });
        const { getGenerationPresets, rebuildGenerationPresets } = await import('../presetRepo');

        await expect(rebuildGenerationPresets()).resolves.toBe(12);

        mocks.isBrowserMockMode.mockReturnValue(true);
        await expect(rebuildGenerationPresets()).resolves.toBe(0);
        await expect(getGenerationPresets('', [], true)).resolves.toEqual([]);
        expect(mocks.rebuildGenerationPresets).toHaveBeenCalledTimes(1);
    });
});
