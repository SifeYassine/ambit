import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFile } from '@tauri-apps/plugin-fs';
import { repairAssetUrl } from '../imageService';

vi.mock('@tauri-apps/plugin-fs', () => ({
    readFile: vi.fn(),
}));

const mockReadFile = vi.mocked(readFile);
const originalCreateImageBitmap = Object.getOwnPropertyDescriptor(globalThis, 'createImageBitmap');

describe('repairAssetUrl', () => {
    it.each([
        ['', ''],
        ['https://example.test/image.png', 'https://example.test/image.png'],
        ['blob:http://ambit/image', 'blob:http://ambit/image'],
        ['data:image/png;base64,abc', 'data:image/png;base64,abc'],
        ['C:/library/image.png', 'C:/library/image.png']
    ])('returns %s unchanged', (input, expected) => {
        expect(repairAssetUrl(input)).toBe(expected);
    });
});
