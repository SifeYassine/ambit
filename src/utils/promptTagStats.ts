/**
 * Prompt tag statistics for the Statistics word clouds. Prompts are comma-separated tags, so a tag
 * ("long hair", "looking at viewer") is the unit, not a single word, and each tag counts once per
 * image no matter how often it repeats in that prompt.
 */

export interface PromptTagStat {
    text: string;
    value: number;
}

export const PROMPT_TAG_LIMIT = 50;

// `<lora:name:0.8>`, `<hypernet:...>` and other angle-bracket directives apply models, not words.
const ANGLE_DIRECTIVE = /<[^>]*>/g;
// A1111 `(tag:1.2)` / ComfyUI weights left on a tag after its brackets are stripped.
const TRAILING_WEIGHT = /:\s*-?\d+(?:\.\d+)?$/;
const TAG_SEPARATOR = /[,\n]|\bBREAK\b|\bAND\b/;
const OUTER_BRACKETS = /^[\s([{]+|[\s)\]}]+$/g;
const ESCAPED_OPEN = '\u0001';
const ESCAPED_CLOSE = '\u0002';

/** The distinct, normalized tags of one prompt. */
export const extractPromptTags = (prompt: string): string[] => {
    const tags = new Set<string>();
    for (const raw of prompt.replace(ANGLE_DIRECTIVE, ' ').split(TAG_SEPARATOR)) {
        // Escaped brackets (`name \(series\)`) are literal text: shield them from weight stripping.
        const tag = raw
            .replace(/\\\(/g, ESCAPED_OPEN)
            .replace(/\\\)/g, ESCAPED_CLOSE)
            .replace(OUTER_BRACKETS, '')
            .replace(TRAILING_WEIGHT, '')
            .replace(OUTER_BRACKETS, '')
            .replaceAll(ESCAPED_OPEN, '(')
            .replaceAll(ESCAPED_CLOSE, ')')
            .replace(/^embedding:/i, '')
            .replace(/_/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase();
        if (tag.length >= 2 && !/^\d+(\.\d+)?$/.test(tag)) tags.add(tag);
    }
    return Array.from(tags);
};

/** Counts every tag across prompts (once per prompt); call `finish` for the top tags. */
export const createPromptTagCounter = () => {
    const counts = new Map<string, number>();
    return {
        add(prompt: string | null | undefined) {
            if (!prompt) return;
            for (const tag of extractPromptTags(prompt)) {
                counts.set(tag, (counts.get(tag) ?? 0) + 1);
            }
        },
        finish(limit = PROMPT_TAG_LIMIT): PromptTagStat[] {
            return Array.from(counts, ([text, value]) => ({ text, value }))
                .sort((a, b) => b.value - a.value || a.text.localeCompare(b.text))
                .slice(0, limit);
        },
    };
};
