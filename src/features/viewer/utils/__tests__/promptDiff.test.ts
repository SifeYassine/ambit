import { describe, expect, it } from 'vitest';
import { diffPrompts, PromptDiffSegment } from '../promptDiff';

const render = (segments: PromptDiffSegment[]) =>
    segments.map(({ type, text }) => (type === 'equal' ? text : `[${text}]`)).join('');

describe('diffPrompts', () => {
    it('returns plain equal segments for identical prompts', () => {
        const result = diffPrompts('a cat, sitting', 'a cat, sitting');
        expect(result.original).toEqual([{ type: 'equal', text: 'a cat, sitting' }]);
        expect(result.modified).toEqual([{ type: 'equal', text: 'a cat, sitting' }]);
    });

    it('highlights only the changed parts of weighted tags', () => {
        const { original, modified } = diffPrompts(
            'highres, (glossy colors, vivid colors:1.1), 1girl, Mavis from Hotel Transylvania, blue eyes, smooth skin',
            'highres, glossy colors, vivid colors, colorful, 1girl, Mina Ashido from my hero academia, yellow eyes, smooth skin',
        );
        expect(render(original)).toBe('highres, [(]glossy colors, vivid colors[:1.1)], 1girl, [Mavis] from [Hotel Transylvania, blue] eyes, smooth skin');
        expect(render(modified)).toBe('highres, glossy colors, vivid colors[, colorful], 1girl, [Mina Ashido] from [my hero academia, yellow] eyes, smooth skin');
    });

    it('keeps whole tags intact when an edit could be aligned two ways', () => {
        const { original, modified } = diffPrompts(
            'looking at viewer, peek, (camel:0.7), (mole:1.1), black hip string',
            'looking at viewer, (peek:0.7), (camel:0.7)',
        );
        expect(render(original)).toBe('looking at viewer, peek, (camel:0.7)[, (mole:1.1), black hip string]');
        expect(render(modified)).toBe('looking at viewer, [(]peek[:0.7)], (camel:0.7)');
    });

    it('gives long prompts the same alignment as short ones', () => {
        const filler = Array.from({ length: 80 }, (_, i) => `tag number ${i}`).join(', ') + ', ';
        const { original, modified } = diffPrompts(
            filler + 'looking at viewer, peek, (camel:0.7), (mole:1.1), black hip string',
            filler + 'looking at viewer, (peek:0.7), (camel:0.7)',
        );
        expect(filler.length * 2).toBeGreaterThan(2000);
        expect(render(original)).toBe(filler + 'looking at viewer, peek, (camel:0.7)[, (mole:1.1), black hip string]');
        expect(render(modified)).toBe(filler + 'looking at viewer, [(]peek[:0.7)], (camel:0.7)');
    });

    it('marks added and removed lines and keeps line breaks unhighlighted', () => {
        const { original, modified } = diffPrompts('first line\nsecond line', 'first line\nnew line\nsecond line');
        expect(render(original)).toBe('first line\nsecond line');
        expect(render(modified)).toBe('first line\n[new line]\nsecond line');
    });

    it('handles empty prompts on either side', () => {
        expect(render(diffPrompts('', 'lowres').modified)).toBe('[lowres]');
        expect(render(diffPrompts('lowres', '').original)).toBe('[lowres]');
    });

    it('treats CRLF and LF line endings the same', () => {
        const result = diffPrompts('a\r\nb', 'a\nb');
        expect(result.original).toEqual([{ type: 'equal', text: 'a\nb' }]);
    });
});
