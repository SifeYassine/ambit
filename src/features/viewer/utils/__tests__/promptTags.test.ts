import { describe, expect, it } from 'vitest';
import { buildTagSegments, diffPromptTags, hasTagChanges, parsePromptTags, PromptTagEntry } from '../promptTags';

const summarize = (prompt: string) => parsePromptTags(prompt).map(({ text, weight }) => `${text}=${weight}`);

const describeEntries = (entries: PromptTagEntry[]) =>
    entries.map(({ tag, change, move, reweighted }) =>
        [tag.text, change, move, reweighted ? 'reweighted' : null].filter(Boolean).join(' '));

/** Renders highlighted segments as `[status arrow: text]`, and edited tags as `{a[changed]b}`. */
const renderSegments = (prompt: string, entries: PromptTagEntry[]) =>
    buildTagSegments(prompt, entries)
        .map(({ text, status, move, parts }) => {
            if (parts !== null) return '{' + parts.map((part) => (part.type === 'equal' ? part.text : `[${part.text}]`)).join('') + '}';
            return status === null ? text : `[${status}${move === 'up' ? ' ↑' : move === 'down' ? ' ↓' : ''}: ${text}]`;
        })
        .join('');

describe('parsePromptTags', () => {
    it('splits on commas and line breaks and normalizes spacing', () => {
        expect(summarize('1girl,  red   eyes\nmoonlight, ,')).toEqual(['1girl=1', 'red eyes=1', 'moonlight=1']);
    });

    it('applies A1111/ComfyUI emphasis weights', () => {
        expect(summarize('(smile:0.7), (fog), ((rim light)), [noise]')).toEqual([
            'smile=0.7',
            'fog=1.1',
            'rim light=1.21',
            'noise=0.91',
        ]);
    });

    it('applies a group weight to every tag in the group', () => {
        expect(summarize('(glossy colors, vivid colors:1.1), 1girl')).toEqual(['glossy colors=1.1', 'vivid colors=1.1', '1girl=1']);
    });

    it('reads LoRA weights and keeps escaped parentheses literal', () => {
        expect(summarize('<lora:detail_tweaker:0.8>, \\(artist\\), artist:moriimee')).toEqual([
            '<lora:detail_tweaker>=0.8',
            '(artist)=1',
            'artist:moriimee=1',
        ]);
    });

    it('records where each tag and its top-level group sit in the prompt', () => {
        const prompt = 'a, (b, c:1.05), d';
        const ranges = parsePromptTags(prompt).map((tag) => [prompt.slice(tag.start, tag.end), prompt.slice(tag.groupStart, tag.groupEnd)]);
        expect(ranges).toEqual([['a', 'a'], ['b', '(b, c:1.05)'], ['c', '(b, c:1.05)'], ['d', 'd']]);
    });
});

describe('diffPromptTags', () => {
    it('points each arrow toward the counterpart and marks re-weighted tags', () => {
        const diff = diffPromptTags('1girl, red eyes, (smile:0.7), castle, moonlight', 'moonlight, 1girl, red eyes, (smile:0.9), castle');
        expect(describeEntries(diff.original)).toEqual(['1girl', 'red eyes', 'smile reweighted', 'castle', 'moonlight up']);
        expect(describeEntries(diff.modified)).toEqual(['moonlight down', '1girl', 'red eyes', 'smile reweighted', 'castle']);
        expect(hasTagChanges(diff)).toBe(true);
    });

    it('marks added and removed tags, matching case-insensitively', () => {
        const diff = diffPromptTags('1girl, Blue Eyes, sword', '1girl, blue eyes, yellow hair');
        expect(describeEntries(diff.original)).toEqual(['1girl', 'Blue Eyes', 'sword removed']);
        expect(describeEntries(diff.modified)).toEqual(['1girl', 'blue eyes', 'yellow hair added']);
    });

    it('pairs similar removed and added tags as edits, even when other tags moved', () => {
        const original = 'masterpiece, 1girl, Mavis, blue eyes, short black bob hair, (smile:0.7), frostbite';
        const modified = 'masterpiece, frostbite, 1girl, Kindred, yellow eyes, short white hair, (smile:0.9)';
        const diff = diffPromptTags(original, modified);
        expect(renderSegments(original, diff.original)).toBe(
            'masterpiece, 1girl, [removed: Mavis], {[blue] eyes}, {short [black bob] hair}, [reweighted: (smile:0.7)], [moved ↑: frostbite]',
        );
        expect(renderSegments(modified, diff.modified)).toBe(
            'masterpiece, [moved ↓: frostbite], 1girl, [added: Kindred], {[yellow] eyes}, {short [white] hair}, [reweighted: (smile:0.9)]',
        );
    });

    it('diffs natural-language phrases word by word', () => {
        const original = 'a young woman standing in a gothic castle, holding a lantern, soft moonlight';
        const modified = 'a young woman sitting in a gothic castle, holding a candle, soft moonlight';
        const diff = diffPromptTags(original, modified);
        expect(renderSegments(original, diff.original)).toBe('{a young woman s[tand]ing in a gothic castle}, {holding a [lantern]}, soft moonlight');
        expect(renderSegments(modified, diff.modified)).toBe('{a young woman s[itt]ing in a gothic castle}, {holding a [candle]}, soft moonlight');
    });

    it('includes weight syntax in an edit when the tag stands alone', () => {
        const diff = diffPromptTags('(blue eyes:1.2), castle', 'yellow eyes, castle');
        expect(renderSegments('(blue eyes:1.2), castle', diff.original)).toBe('{[(blue] eyes[:1.2)]}, castle');
    });

    it('pairs repeated tags by occurrence', () => {
        expect(describeEntries(diffPromptTags('star, moon, star', 'star, moon').original)).toEqual(['star', 'moon', 'star removed']);
    });

    it('reports no changes when only formatting differs', () => {
        expect(hasTagChanges(diffPromptTags('(fog), Red  Eyes', '(fog:1.1), red eyes'))).toBe(false);
    });
});

describe('buildTagSegments', () => {
    it('highlights a weight group as one unit, keeping the prompt text as written', () => {
        const original = 'masterpiece, 1girl, smile, red eyes, castle, frostbite, (bold lines, sanguine lines:1.05)';
        const modified = 'masterpiece, frostbite, bold lines, sanguine lines, 1girl, smile, red eyes, castle';
        const diff = diffPromptTags(original, modified);
        expect(renderSegments(original, diff.original)).toBe(
            'masterpiece, 1girl, smile, red eyes, castle, [moved ↑: frostbite], [reweighted ↑: (bold lines, sanguine lines:1.05)]',
        );
        expect(renderSegments(modified, diff.modified)).toBe(
            'masterpiece, [moved ↓: frostbite], [reweighted ↓: bold lines], [reweighted ↓: sanguine lines], 1girl, smile, red eyes, castle',
        );
    });

    it('highlights tags one by one when a group has mixed changes', () => {
        const diff = diffPromptTags('(red eyes, smile:1.2), castle', '(red eyes, frown:1.2), castle');
        expect(renderSegments('(red eyes, smile:1.2), castle', diff.original)).toBe('(red eyes, [removed: smile]:1.2), castle');
    });
});
