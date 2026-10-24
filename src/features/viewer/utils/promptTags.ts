/**
 * Tag-level prompt comparison: splits prompts into comma-separated tags with
 * their effective A1111/ComfyUI attention weights, then marks each tag as
 * added, removed, re-weighted, and/or moved. Similar removed/added tags in the
 * same spot are paired as edits and diffed character by character. Highlights
 * are mapped back onto the prompt text as written, so weight groups stay intact.
 */

import { diffPrompts, PromptDiffSegment } from './promptDiff';

export interface PromptTag {
    /** Tag text without weight syntax, e.g. `smile` or `<lora:detail>`. */
    text: string;
    /** Effective weight, rounded to 2 decimals (1 when unweighted). */
    weight: number;
    /** Zero-based position of the tag in its prompt. */
    index: number;
    /** Source range of the tag text in the prompt. */
    start: number;
    end: number;
    /** Source range of the top-level item holding the tag, e.g. a whole `(a, b:1.2)` group. */
    groupStart: number;
    groupEnd: number;
}

/** Points toward the counterpart's position in the other prompt. */
export type PromptTagMove = 'up' | 'down';

export interface PromptTagEdit {
    /** Source range in this prompt covered by `segments`. */
    start: number;
    end: number;
    /** Character-level diff of the range against its counterpart (this side's view). */
    segments: PromptDiffSegment[];
}

export interface PromptTagEntry {
    tag: PromptTag;
    /**
     * `added`/`removed` when the tag exists on one side only; `edited` when it
     * was paired with a similar tag in the same spot of the other prompt.
     */
    change: 'added' | 'removed' | 'edited' | null;
    move: PromptTagMove | null;
    /** The tag's counterpart has a different weight. */
    reweighted: boolean;
    /** Character-level changes, set when `change` is `edited`. */
    edit: PromptTagEdit | null;
}

export interface PromptTagDiff {
    /** Tags of the original prompt, in order. */
    original: PromptTagEntry[];
    /** Tags of the modified prompt, in order. */
    modified: PromptTagEntry[];
}

export type PromptTagStatus = 'added' | 'removed' | 'edited' | 'reweighted' | 'moved';

export interface PromptTagSegment {
    text: string;
    status: PromptTagStatus | null;
    move: PromptTagMove | null;
    /** For `edited` segments: the character-level diff to render inside. */
    parts: PromptDiffSegment[] | null;
}

const EMPHASIS = 1.1;
/** Minimum bigram similarity for a removed and an added tag to count as one edited tag. */
const EDIT_SIMILARITY_THRESHOLD = 0.4;
/** Above this many removed × added candidates in one spot, tags are not paired as edits. */
const MAX_EDIT_CANDIDATES = 40000;
const EXPLICIT_WEIGHT = /:\s*(-?\d+(?:\.\d+)?)\s*$/;
const WHITESPACE = /\s/;

type RawTag = Omit<PromptTag, 'index'>;

const roundWeight = (weight: number) => Math.round(weight * 100) / 100;

const normalizeText = (text: string) => text.replace(/\s+/g, ' ').trim();

const tagKey = (tag: PromptTag) => tag.text.toLowerCase();

export const parsePromptTags = (prompt: string): PromptTag[] => {
    let pos = 0;

    const parseSequence = (closer: ')' | ']' | null): { tags: RawTag[]; explicitWeight: number | null } => {
        const tags: RawTag[] = [];
        let buffer = '';
        let textStart = -1;
        let textEnd = -1;
        const append = (text: string, sourceLength: number) => {
            if (!WHITESPACE.test(text)) {
                if (textStart === -1) textStart = pos;
                textEnd = pos + sourceLength;
            }
            buffer += text;
            pos += sourceLength;
        };
        const flush = () => {
            const text = normalizeText(buffer);
            if (text) tags.push({ text, weight: 1, start: textStart, end: textEnd, groupStart: textStart, groupEnd: textEnd });
            buffer = '';
            textStart = -1;
            textEnd = -1;
        };

        while (pos < prompt.length) {
            const ch = prompt[pos];
            if (ch === '\\' && pos + 1 < prompt.length) {
                append(prompt[pos + 1], 2);
            } else if (ch === ',' || ch === '\n') {
                flush();
                pos++;
            } else if (ch === '<' && prompt.indexOf('>', pos) !== -1) {
                flush();
                const end = prompt.indexOf('>', pos) + 1;
                const parts = prompt.slice(pos + 1, end - 1).split(':');
                const weight = parts.length >= 3 ? Number(parts[2]) : NaN;
                tags.push({
                    text: '<' + normalizeText(parts.slice(0, 2).join(':')) + '>',
                    weight: Number.isFinite(weight) ? weight : 1,
                    start: pos,
                    end,
                    groupStart: pos,
                    groupEnd: end,
                });
                pos = end;
            } else if (ch === '(' || ch === '[') {
                flush();
                const groupStart = pos;
                pos++;
                const inner = parseSequence(ch === '(' ? ')' : ']');
                const multiplier = inner.explicitWeight ?? (ch === '(' ? EMPHASIS : 1 / EMPHASIS);
                for (const tag of inner.tags) {
                    tags.push({
                        ...tag,
                        weight: tag.weight * multiplier,
                        // Only top-level groups define the highlightable unit.
                        groupStart: closer === null ? groupStart : tag.groupStart,
                        groupEnd: closer === null ? pos : tag.groupEnd,
                    });
                }
            } else if (ch === closer) {
                let explicitWeight: number | null = null;
                const match = closer === ')' ? EXPLICIT_WEIGHT.exec(buffer) : null;
                if (match) {
                    explicitWeight = Number(match[1]);
                    buffer = buffer.slice(0, match.index);
                    // The weight suffix has no escapes, so it spans as many source characters.
                    textEnd = pos - match[0].length;
                    while (textEnd > textStart && WHITESPACE.test(prompt[textEnd - 1])) textEnd--;
                }
                flush();
                pos++;
                return { tags, explicitWeight };
            } else {
                append(ch, 1);
            }
        }
        flush();
        return { tags, explicitWeight: null };
    };

    return parseSequence(null).tags.map((tag, index) => ({ ...tag, weight: roundWeight(tag.weight), index }));
};

/** Indices (into `values`) of one longest strictly increasing subsequence. */
const longestIncreasingSubsequence = (values: number[]): Set<number> => {
    const tails: number[] = [];
    const previous = new Array<number>(values.length).fill(-1);
    for (let i = 0; i < values.length; i++) {
        let low = 0;
        let high = tails.length;
        while (low < high) {
            const mid = (low + high) >>> 1;
            if (values[tails[mid]] < values[i]) low = mid + 1;
            else high = mid;
        }
        if (low > 0) previous[i] = tails[low - 1];
        tails[low] = i;
    }
    const kept = new Set<number>();
    for (let i = tails.length > 0 ? tails[tails.length - 1] : -1; i !== -1; i = previous[i]) kept.add(i);
    return kept;
};

const bigramCounts = (text: string): Map<string, number> => {
    const normalized = text.toLowerCase();
    const counts = new Map<string, number>();
    for (let i = 0; i + 1 < normalized.length; i++) {
        const bigram = normalized.slice(i, i + 2);
        counts.set(bigram, (counts.get(bigram) ?? 0) + 1);
    }
    return counts;
};

/** Dice coefficient over character bigrams: 1 for identical text, 0 for nothing in common. */
const bigramSimilarity = (a: Map<string, number>, b: Map<string, number>): number => {
    let sizeA = 0;
    let sizeB = 0;
    let shared = 0;
    for (const [bigram, count] of a) {
        sizeA += count;
        shared += Math.min(count, b.get(bigram) ?? 0);
    }
    for (const count of b.values()) sizeB += count;
    return sizeA + sizeB === 0 ? 0 : (2 * shared) / (sizeA + sizeB);
};

/**
 * Order-preserving pairing of removed and added tags that maximizes total
 * similarity, keeping only pairs at or above the edit threshold.
 */
const pairSimilarTags = (removed: PromptTag[], added: PromptTag[]): [PromptTag, PromptTag][] => {
    if (removed.length === 0 || added.length === 0 || removed.length * added.length > MAX_EDIT_CANDIDATES) return [];
    const removedBigrams = removed.map((tag) => bigramCounts(tag.text));
    const addedBigrams = added.map((tag) => bigramCounts(tag.text));
    const similarity = removedBigrams.map((a) => addedBigrams.map((b) => bigramSimilarity(a, b)));
    const cols = added.length + 1;
    const best = new Float64Array((removed.length + 1) * cols);
    for (let i = 1; i <= removed.length; i++) {
        for (let j = 1; j <= added.length; j++) {
            const score = similarity[i - 1][j - 1];
            const paired = score >= EDIT_SIMILARITY_THRESHOLD ? best[(i - 1) * cols + j - 1] + score : -1;
            best[i * cols + j] = Math.max(best[(i - 1) * cols + j], best[i * cols + j - 1], paired);
        }
    }
    const result: [PromptTag, PromptTag][] = [];
    let i = removed.length;
    let j = added.length;
    while (i > 0 && j > 0) {
        const score = similarity[i - 1][j - 1];
        if (score >= EDIT_SIMILARITY_THRESHOLD && best[i * cols + j] === best[(i - 1) * cols + j - 1] + score) {
            result.push([removed[i - 1], added[j - 1]]);
            i--;
            j--;
        } else if (best[i * cols + j] === best[(i - 1) * cols + j]) {
            i--;
        } else {
            j--;
        }
    }
    return result.reverse();
};

/** Start offsets of top-level items that hold more than one tag, e.g. `(a, b:1.2)`. */
const sharedGroupStarts = (tags: PromptTag[]): Set<number> => {
    const seen = new Set<number>();
    const shared = new Set<number>();
    for (const tag of tags) {
        if (seen.has(tag.groupStart)) shared.add(tag.groupStart);
        seen.add(tag.groupStart);
    }
    return shared;
};

/** The range an edit covers: the whole top-level item when the tag is alone in it, so weight changes show too. */
const editRange = (tag: PromptTag, sharedGroups: Set<number>): { start: number; end: number } =>
    sharedGroups.has(tag.groupStart) ? { start: tag.start, end: tag.end } : { start: tag.groupStart, end: tag.groupEnd };

export const diffPromptTags = (originalPrompt: string, modifiedPrompt: string): PromptTagDiff => {
    const originalTags = parsePromptTags(originalPrompt);
    const modifiedTags = parsePromptTags(modifiedPrompt);
    const original: PromptTagEntry[] = originalTags.map((tag) => ({ tag, change: 'removed', move: null, reweighted: false, edit: null }));
    const modified: PromptTagEntry[] = modifiedTags.map((tag) => ({ tag, change: 'added', move: null, reweighted: false, edit: null }));

    // Pair the n-th occurrence of a tag in one prompt with its n-th occurrence in the other.
    const unmatched = new Map<string, PromptTag[]>();
    for (const tag of modifiedTags) {
        const queue = unmatched.get(tagKey(tag));
        if (queue) queue.push(tag);
        else unmatched.set(tagKey(tag), [tag]);
    }
    const pairs: { original: PromptTag; modified: PromptTag }[] = [];
    for (const tag of originalTags) {
        const counterpart = unmatched.get(tagKey(tag))?.shift();
        if (counterpart) pairs.push({ original: tag, modified: counterpart });
    }

    // Shared tags outside the longest run that kept its relative order count as
    // moved. Each side's arrow points toward the counterpart: a tag that moved
    // earlier shows ↑ in the original prompt and ↓ (it came from later) in the new one.
    const modifiedRank = new Map(
        [...pairs].sort((a, b) => a.modified.index - b.modified.index).map((pair, rank) => [pair, rank]),
    );
    const inOrder = longestIncreasingSubsequence(pairs.map((pair) => pair.modified.index));
    pairs.forEach((pair, originalRank) => {
        const movedEarlier = (modifiedRank.get(pair) ?? originalRank) < originalRank;
        const moved = !inOrder.has(originalRank);
        const reweighted = pair.original.weight !== pair.modified.weight;
        original[pair.original.index] = { tag: pair.original, change: null, move: moved ? (movedEarlier ? 'up' : 'down') : null, reweighted, edit: null };
        modified[pair.modified.index] = { tag: pair.modified, change: null, move: moved ? (movedEarlier ? 'down' : 'up') : null, reweighted, edit: null };
    });

    // Similar removed and added tags, taken in prompt order, are paired as one
    // edited tag (e.g. `blue eyes` → `yellow eyes`) and diffed character by character.
    const removed = original.filter((entry) => entry.change === 'removed').map((entry) => entry.tag);
    const added = modified.filter((entry) => entry.change === 'added').map((entry) => entry.tag);
    const originalSharedGroups = sharedGroupStarts(originalTags);
    const modifiedSharedGroups = sharedGroupStarts(modifiedTags);
    for (const [originalTag, modifiedTag] of pairSimilarTags(removed, added)) {
        const originalRange = editRange(originalTag, originalSharedGroups);
        const modifiedRange = editRange(modifiedTag, modifiedSharedGroups);
        const { original: originalSegments, modified: modifiedSegments } = diffPrompts(
            originalPrompt.slice(originalRange.start, originalRange.end),
            modifiedPrompt.slice(modifiedRange.start, modifiedRange.end),
        );
        original[originalTag.index] = { tag: originalTag, change: 'edited', move: null, reweighted: false, edit: { ...originalRange, segments: originalSegments } };
        modified[modifiedTag.index] = { tag: modifiedTag, change: 'edited', move: null, reweighted: false, edit: { ...modifiedRange, segments: modifiedSegments } };
    }

    return { original, modified };
};

/** Whether the two prompts differ in tags, order, or weights. */
export const hasTagChanges = ({ original, modified }: PromptTagDiff): boolean =>
    [...original, ...modified].some((entry) => entry.change !== null || entry.move !== null || entry.reweighted);

const entryStatus = ({ change, move, reweighted }: PromptTagEntry): PromptTagStatus | null =>
    change ?? (reweighted ? 'reweighted' : move !== null ? 'moved' : null);

/**
 * Splits the prompt text, as written, into plain and highlighted segments. A
 * top-level item (a tag or a whole weight group) is highlighted as one unit when
 * all of its tags share the same status; otherwise its tags are highlighted one by one.
 */
export const buildTagSegments = (prompt: string, entries: PromptTagEntry[]): PromptTagSegment[] => {
    const highlights: { start: number; end: number; status: PromptTagStatus; move: PromptTagMove | null; parts: PromptDiffSegment[] | null }[] = [];
    let i = 0;
    while (i < entries.length) {
        const { groupStart, groupEnd } = entries[i].tag;
        let j = i;
        while (j < entries.length && entries[j].tag.groupStart === groupStart) j++;
        const group = entries.slice(i, j);
        const first = group[0];
        const uniform = group.every((entry) => entryStatus(entry) === entryStatus(first) && entry.move === first.move);
        const status = entryStatus(first);
        if (uniform && status !== 'edited') {
            if (status !== null) highlights.push({ start: groupStart, end: groupEnd, status, move: first.move, parts: null });
        } else {
            for (const entry of group) {
                const entryState = entryStatus(entry);
                if (entry.edit !== null) {
                    highlights.push({ start: entry.edit.start, end: entry.edit.end, status: 'edited', move: null, parts: entry.edit.segments });
                } else if (entryState !== null) {
                    highlights.push({ start: entry.tag.start, end: entry.tag.end, status: entryState, move: entry.move, parts: null });
                }
            }
        }
        i = j;
    }

    const segments: PromptTagSegment[] = [];
    let cursor = 0;
    for (const { start, end, status, move, parts } of highlights) {
        if (start > cursor) segments.push({ text: prompt.slice(cursor, start), status: null, move: null, parts: null });
        segments.push({ text: prompt.slice(start, end), status, move, parts });
        cursor = end;
    }
    if (cursor < prompt.length) segments.push({ text: prompt.slice(cursor), status: null, move: null, parts: null });
    return segments;
};
