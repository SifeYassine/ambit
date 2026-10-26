import { describe, expect, it } from 'vitest';
import { createPromptTagCounter, extractPromptTags } from '../promptTagStats';

describe('extractPromptTags', () => {
    it('keeps whole comma-separated tags and strips weights, brackets, and LoRA directives', () => {
        expect(extractPromptTags('1girl, (long hair:1.2), [blue_eyes], ((smile)), <lora:frostbite:0.8>, Looking at viewer\nred dress BREAK night'))
            .toEqual(['1girl', 'long hair', 'blue eyes', 'smile', 'looking at viewer', 'red dress', 'night']);
    });

    it('returns each tag once per prompt and drops numbers and empty pieces', () => {
        expect(extractPromptTags('cat, cat, CAT, 1.2, , 42, embedding:EasyNegative, 2d'))
            .toEqual(['cat', 'easynegative', '2d']);
    });

    it('unescapes literal brackets in character names', () => {
        expect(extractPromptTags('frieren \\(sousou no frieren\\)')).toEqual(['frieren (sousou no frieren)']);
    });
});

describe('createPromptTagCounter', () => {
    it('counts images per tag and leaves out positive quality boilerplate', () => {
        const positive = createPromptTagCounter('positive');
        positive.add('masterpiece, best quality, score_9, score_8_up, 1girl, long hair');
        positive.add('masterpiece, 1girl, long hair, long hair');
        positive.add('absurdres, 1girl');
        positive.add(null);

        expect(positive.finish()).toEqual([
            { text: '1girl', value: 3 },
            { text: 'long hair', value: 2 },
        ]);
    });

    it('keeps quality tags in negative prompts, ordered by count then name', () => {
        const negative = createPromptTagCounter('negative');
        negative.add('worst quality, low quality, bad anatomy');
        negative.add('low quality, watermark');

        expect(negative.finish(3)).toEqual([
            { text: 'low quality', value: 2 },
            { text: 'bad anatomy', value: 1 },
            { text: 'watermark', value: 1 },
        ]);
    });
});
