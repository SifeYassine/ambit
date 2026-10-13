import { describe, expect, it } from 'vitest';
import { matchRegistryWidgetNames, matchWidgetNamesInTable, type RegistryTable } from '../registryWidgets';

const table: RegistryTable = {
    names: ['seed', 'steps', 'cfg', 'sampler_name', 'scale_by', 'method', 'mode'],
    nodes: {
        KSampler: [['Iifc', 0, 1, 2, 3]],
        // Two versions of one node: the newer one inserted `mode` (a combo) in the middle.
        Upscale: [['fcc', 4, 6, 5], ['fc', 4, 5]]
    }
};

describe('matchWidgetNamesInTable', () => {
    it('names every value, including the seed control value', () => {
        expect(matchWidgetNamesInTable(table, 'KSampler', [7, 'randomize', 20, 7.5, 'euler']))
            .toEqual(['seed', 'control_after_generate', 'steps', 'cfg', 'sampler_name']);
    });

    it('picks the node version whose widgets fit the saved values', () => {
        expect(matchWidgetNamesInTable(table, 'Upscale', [1.5, 'tiled', 'lanczos'])).toEqual(['scale_by', 'mode', 'method']);
        expect(matchWidgetNamesInTable(table, 'Upscale', [1.5, 'lanczos'])).toEqual(['scale_by', 'method']);
    });

    it('rejects values of the wrong kind or extra plain values, and leaves extension state unnamed', () => {
        expect(matchWidgetNamesInTable(table, 'Upscale', ['lanczos', 1.5])).toBeNull();
        expect(matchWidgetNamesInTable(table, 'Upscale', [1.5, 'a', 'b', 'c'])).toBeNull();
        expect(matchWidgetNamesInTable(table, 'Upscale', [1.5, 'lanczos', [false, true]])).toEqual(['scale_by', 'method', '']);
        expect(matchWidgetNamesInTable(table, 'Unknown', [1])).toBeNull();
    });

    it('accepts an older save that has fewer widgets than every known version', () => {
        expect(matchWidgetNamesInTable(table, 'KSampler', [7, 'fixed', 20])).toEqual(['seed', 'control_after_generate', 'steps']);
    });
});

describe('generated Registry table', () => {
    it('loads and names custom nodes, choosing the version that fits', () => {
        expect(matchRegistryWidgetNames('AIO_Preprocessor', ['DepthAnythingV2Preprocessor', 1024])).toEqual(['preprocessor', 'resolution']);
        // RMBG changed its widgets across versions; this older save has `background` before `invert_output`.
        expect(matchRegistryWidgetNames('RMBG', ['INSPYRENET', 0, 1248, 0, 1, 'white', false, 'default']))
            .toEqual(['model', 'sensitivity', 'process_res', 'mask_blur', 'mask_offset', 'background', 'invert_output', 'optimize']);
        // Core ComfyUI is not a Registry pack.
        expect(matchRegistryWidgetNames('KSampler', [1, 'fixed', 20, 7, 'euler', 'normal', 1])).toBeNull();
    });
});
