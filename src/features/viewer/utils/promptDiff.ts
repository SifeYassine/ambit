/**
 * Text diff that reproduces diffchecker.com's default "smart" mode.
 *
 * Pipeline:
 * 1. Line pass: dynamic-programming LCS over (trimmed) lines, weighting longer
 *    lines higher, then sliding ambiguous line blocks by indentation.
 * 2. Character pass on each replaced block: dynamic-programming LCS that
 *    rewards long unbroken runs of matches (falls back to a Myers bisect
 *    diff for large inputs or on timeout).
 * 3. Readability cleanups: shift ambiguous edits, snap edits to word and
 *    punctuation boundaries, absorb partially-matched words, absorb tiny
 *    equalities between edits, merge edits across short gaps, and absorb
 *    near-empty slivers next to large edits.
 */

const DELETE = -1;
const EQUAL = 0;
const INSERT = 1;
type Op = typeof DELETE | typeof EQUAL | typeof INSERT;
type Diff = [Op, string];

export type PromptDiffSegmentType = 'equal' | 'remove' | 'insert';

export interface PromptDiffSegment {
    type: PromptDiffSegmentType;
    text: string;
}

export interface PromptDiffResult {
    original: PromptDiffSegment[];
    modified: PromptDiffSegment[];
}

const DP_MAX_LINES = 5000;
const DP_MAX_CHARS = 6000;
const TOTAL_BUDGET_MS = 5000;
const BISECT_BUDGET_MS = 20000;

class DPTimeoutError extends Error {
    constructor() {
        super('Dynamic programming timed out');
        this.name = 'DPTimeoutError';
    }
}

interface Budget {
    start: number;
    exhausted: boolean;
}

const isBudgetExhausted = (budget: Budget): boolean => {
    if (Date.now() - budget.start > TOTAL_BUDGET_MS) {
        budget.exhausted = true;
        return true;
    }
    return false;
};

// ---------------------------------------------------------------------------
// Encoding helpers (tokens <-> code points, skipping the surrogate range)
// ---------------------------------------------------------------------------

const toCodePoint = (index: number): number => (index >= 0xd800 ? index + 2048 : index);
const fromCodePoint = (codePoint: number): number => (codePoint >= 0xdfff ? codePoint - 2048 : codePoint);
const isHighSurrogate = (ch: string | undefined): boolean => {
    if (ch === undefined) return false;
    const code = ch.codePointAt(0) ?? 0;
    return code >= 0xd800 && code <= 0xdbff;
};
const isLowSurrogate = (ch: string | undefined): boolean => {
    if (ch === undefined) return false;
    const code = ch.codePointAt(0) ?? 0;
    return code >= 0xdc00 && code <= 0xdfff;
};

interface LinesToChars {
    chars1: string;
    chars2: string;
    lineArray: string[];
}

const linesToChars = (text1: string, text2: string): LinesToChars => {
    const lineArray: string[] = [''];
    const lineHash = new Map<string, number>();
    const encode = (text: string): string => {
        let chars = '';
        let lineStart = 0;
        let lineEnd = -1;
        let nextIndex = lineArray.length;
        while (lineEnd < text.length - 1) {
            lineEnd = text.indexOf('\n', lineStart);
            if (lineEnd === -1) lineEnd = text.length - 1;
            const line = text.substring(lineStart, lineEnd + 1);
            const existing = lineHash.get(line);
            if (existing !== undefined) {
                chars += String.fromCodePoint(toCodePoint(existing));
            } else {
                chars += String.fromCodePoint(toCodePoint(nextIndex));
                lineHash.set(line, nextIndex);
                lineArray[nextIndex++] = line;
            }
            lineStart = lineEnd + 1;
        }
        return chars;
    };
    return { chars1: encode(text1), chars2: encode(text2), lineArray };
};

/** Moves surrogate halves split across diff boundaries back together. */
const fixSurrogates = (diffs: Diff[]): Diff[] => {
    for (let i = diffs.length - 1; i >= 0; i--) {
        if (diffs[i][1].length === 0) diffs.splice(i, 1);
    }
    for (let i = 0; i < diffs.length; i++) {
        const diff = diffs[i];
        const text = diff[1];
        const last = text[text.length - 1];
        if (!isHighSurrogate(last)) continue;
        if (diff[0] === EQUAL) {
            if (i === diffs.length - 1) continue;
            let j = i + 1;
            let delIndex = -1;
            let insIndex = -1;
            while (j < diffs.length && diffs[j][0] !== EQUAL) {
                if (diffs[j][0] === DELETE && delIndex === -1) delIndex = j;
                if (diffs[j][0] === INSERT && insIndex === -1) insIndex = j;
                j++;
            }
            diff[1] = text.slice(0, -1);
            if (delIndex === -1 && insIndex === -1) {
                diffs[j][1] = last + diffs[j][1];
            } else {
                if (delIndex !== -1) {
                    diffs[delIndex][1] = last + diffs[delIndex][1];
                } else {
                    diffs.splice(i + 1, 0, [DELETE, last]);
                    insIndex++;
                    j++;
                }
                if (insIndex !== -1) diffs[insIndex][1] = last + diffs[insIndex][1];
                else diffs.splice(j, 0, [INSERT, last]);
            }
            if (diff[1].length === 0) diffs.splice(i--, 1);
            continue;
        }
        let j = i + 1;
        let sameIndex = -1;
        while (j < diffs.length && diffs[j][0] !== EQUAL) {
            if (diffs[j][0] === diff[0]) {
                sameIndex = j;
                break;
            }
            j++;
        }
        if (sameIndex !== -1) {
            if (isLowSurrogate(diffs[sameIndex][1][0])) {
                diff[1] = text.slice(0, -1);
                diffs[sameIndex][1] = last + diffs[sameIndex][1];
                if (diff[1].length === 0) diffs.splice(i--, 1);
            }
            continue;
        }
        if (j === diffs.length) continue;
        const equality = diffs[j];
        const low = equality[1][0];
        if (!isLowSurrogate(low)) continue;
        let delIndex = -1;
        let insIndex = -1;
        for (let k = j - 1; k >= 0 && diffs[k][0] !== EQUAL; k--) {
            if (diffs[k][0] === DELETE && delIndex === -1) delIndex = k;
            if (diffs[k][0] === INSERT && insIndex === -1) insIndex = k;
        }
        equality[1] = equality[1].slice(1);
        if (delIndex !== -1) {
            diffs[delIndex][1] += low;
        } else {
            diffs.splice(j, 0, [DELETE, low]);
            j++;
        }
        if (insIndex !== -1) {
            diffs[insIndex][1] += low;
        } else {
            diffs.splice(j, 0, [INSERT, low]);
            j++;
        }
        if (equality[1].length === 0) diffs.splice(j, 1);
    }
    return diffs;
};

const charsToLines = (diffs: Diff[], lineArray: string[]): void => {
    fixSurrogates(diffs);
    for (const diff of diffs) {
        const text = diff[1];
        const lines: string[] = [];
        for (let i = 0, n = 0; i < text.length; i++, n++) {
            const codePoint = text.codePointAt(i) ?? 0;
            lines[n] = lineArray[fromCodePoint(codePoint)];
            if (codePoint > 0xffff) i++;
        }
        diff[1] = lines.join('');
    }
};

// ---------------------------------------------------------------------------
// Dynamic-programming LCS with run-length bonus
// ---------------------------------------------------------------------------

type EqualityScore = (i: number, j: number) => number;

// Moves recorded per cell for the backtrack.
const MATCH = 0;
const SKIP_ORIGINAL = 1;
const SKIP_MODIFIED = 2;

const dynamicProgrammingDiff = (
    text1: string,
    text2: string,
    equalityScore: EqualityScore | undefined,
    shouldAbort: () => boolean,
): Diff[] => {
    const cols = text2.length;
    // Only the move of every cell is kept (1 byte each); scores and run lengths
    // need just the previous and current row.
    const directions = new Uint8Array(text1.length * cols);
    let previousScores = new Float64Array(cols);
    let currentScores = new Float64Array(cols);
    let previousRuns = new Float64Array(cols);
    let currentRuns = new Float64Array(cols);
    let cells = 0;
    for (let i = 0; i < text1.length; i++) {
        const rowStart = i * cols;
        const previousRowStart = rowStart - cols;
        for (let j = 0; j < cols; j++) {
            cells++;
            if (cells % 1000 === 0 && shouldAbort()) throw new DPTimeoutError();
            const up = i === 0 ? 0 : previousScores[j];
            const left = j === 0 ? 0 : currentScores[j - 1];
            let diagonal = -1;
            if (text1[i] === text2[j]) {
                diagonal = i === 0 || j === 0 ? 0 : previousScores[j - 1];
                if (i > 0 && j > 0 && directions[previousRowStart + j - 1] === MATCH) diagonal += previousRuns[j - 1];
                diagonal += equalityScore?.(i, j) ?? 1;
            }
            const best = Math.max(up, left, diagonal);
            if (best === diagonal) {
                currentRuns[j] = (i > 0 && j > 0 ? previousRuns[j - 1] : 0) + 1;
                directions[rowStart + j] = MATCH;
            } else if (best === left) {
                currentRuns[j] = 0;
                directions[rowStart + j] = SKIP_MODIFIED;
            } else {
                currentRuns[j] = 0;
                directions[rowStart + j] = SKIP_ORIGINAL;
            }
            currentScores[j] = best;
        }
        [previousScores, currentScores] = [currentScores, previousScores];
        [previousRuns, currentRuns] = [currentRuns, previousRuns];
    }

    let x = text1.length - 1;
    let y = text2.length - 1;
    if (x < 0 && y < 0) return [];
    if (x < 0) return [[INSERT, text2]];
    if (y < 0) return [[DELETE, text1]];
    const directionAt = (row: number, col: number) => directions[row * cols + col];
    const diffs: Diff[] = [];
    const head = { x, y };
    const emit = (toX: number, toY: number) => {
        const direction = head.x < 0 ? SKIP_MODIFIED : head.y < 0 ? SKIP_ORIGINAL : directionAt(head.x, head.y);
        if (direction === MATCH) diffs.push([EQUAL, text1.slice(toX + 1, head.x + 1)]);
        else if (direction === SKIP_MODIFIED) diffs.push([INSERT, text2.slice(toY + 1, head.y + 1)]);
        else diffs.push([DELETE, text1.slice(toX + 1, head.x + 1)]);
        head.x = toX;
        head.y = toY;
    };
    while (x >= 0 && y >= 0) {
        if (directionAt(x, y) !== directionAt(head.x, head.y)) emit(x, y);
        const direction = directionAt(x, y);
        if (direction === MATCH) {
            x--;
            y--;
        } else if (direction === SKIP_MODIFIED) {
            y--;
        } else {
            x--;
        }
    }
    emit(x, y);
    if (x >= 0 || y >= 0) emit(-1, -1);
    return diffs.reverse();
};

// ---------------------------------------------------------------------------
// Myers bisect diff (diff-match-patch style) used as the fallback
// ---------------------------------------------------------------------------

const commonPrefix = (text1: string, text2: string): number => {
    if (!text1 || !text2 || text1.charAt(0) !== text2.charAt(0)) return 0;
    let min = 0;
    let max = Math.min(text1.length, text2.length);
    let mid = max;
    let start = 0;
    while (min < mid) {
        if (text1.substring(start, mid) === text2.substring(start, mid)) {
            min = mid;
            start = min;
        } else {
            max = mid;
        }
        mid = Math.floor((max - min) / 2 + min);
    }
    return mid;
};

const commonSuffix = (text1: string, text2: string): number => {
    if (!text1 || !text2 || text1.charAt(text1.length - 1) !== text2.charAt(text2.length - 1)) return 0;
    let min = 0;
    let max = Math.min(text1.length, text2.length);
    let mid = max;
    let end = 0;
    while (min < mid) {
        if (text1.substring(text1.length - mid, text1.length - end) === text2.substring(text2.length - mid, text2.length - end)) {
            min = mid;
            end = min;
        } else {
            max = mid;
        }
        mid = Math.floor((max - min) / 2 + min);
    }
    return mid;
};

const commonOverlap = (text1: string, text2: string): number => {
    const length1 = text1.length;
    const length2 = text2.length;
    if (length1 === 0 || length2 === 0) return 0;
    if (length1 > length2) text1 = text1.substring(length1 - length2);
    else if (length1 < length2) text2 = text2.substring(0, length1);
    const textLength = Math.min(length1, length2);
    if (text1 === text2) return textLength;
    let best = 0;
    let length = 1;
    for (;;) {
        const pattern = text1.substring(textLength - length);
        const found = text2.indexOf(pattern);
        if (found === -1) return best;
        length += found;
        if (found === 0 || text1.substring(textLength - length) === text2.substring(0, length)) {
            best = length;
            length++;
        }
    }
};

type HalfMatch = [string, string, string, string, string];

const halfMatch = (text1: string, text2: string): HalfMatch | null => {
    const longText = text1.length > text2.length ? text1 : text2;
    const shortText = text1.length > text2.length ? text2 : text1;
    if (longText.length < 4 || shortText.length * 2 < longText.length) return null;

    const halfMatchAt = (long: string, short: string, index: number): HalfMatch | null => {
        const seed = long.substring(index, index + Math.floor(long.length / 4));
        let j = -1;
        let bestCommon = '';
        let bestLongA = '';
        let bestLongB = '';
        let bestShortA = '';
        let bestShortB = '';
        while ((j = short.indexOf(seed, j + 1)) !== -1) {
            const prefixLength = commonPrefix(long.substring(index), short.substring(j));
            const suffixLength = commonSuffix(long.substring(0, index), short.substring(0, j));
            if (bestCommon.length < suffixLength + prefixLength) {
                bestCommon = short.substring(j - suffixLength, j) + short.substring(j, j + prefixLength);
                bestLongA = long.substring(0, index - suffixLength);
                bestLongB = long.substring(index + prefixLength);
                bestShortA = short.substring(0, j - suffixLength);
                bestShortB = short.substring(j + prefixLength);
            }
        }
        return bestCommon.length * 2 >= long.length
            ? [bestLongA, bestLongB, bestShortA, bestShortB, bestCommon]
            : null;
    };

    const hm1 = halfMatchAt(longText, shortText, Math.ceil(longText.length / 4));
    const hm2 = halfMatchAt(longText, shortText, Math.ceil(longText.length / 2));
    if (!hm1 && !hm2) return null;
    const hm = !hm2 ? hm1 as HalfMatch : !hm1 ? hm2 : hm1[4].length > hm2[4].length ? hm1 : hm2;
    return text1.length > text2.length
        ? [hm[0], hm[1], hm[2], hm[3], hm[4]]
        : [hm[2], hm[3], hm[0], hm[1], hm[4]];
};

const bisectSplit = (text1: string, text2: string, x: number, y: number, deadline: number): Diff[] => {
    const diffsA = myersDiff(text1.substring(0, x), text2.substring(0, y), false, deadline);
    const diffsB = myersDiff(text1.substring(x), text2.substring(y), false, deadline);
    return diffsA.concat(diffsB);
};

const bisect = (text1: string, text2: string, deadline: number): Diff[] => {
    const length1 = text1.length;
    const length2 = text2.length;
    const maxD = Math.ceil((length1 + length2) / 2);
    const vOffset = maxD;
    const vLength = 2 * maxD;
    const v1 = new Array<number>(vLength).fill(-1);
    const snake1 = new Array<number>(vLength).fill(-1);
    const v2 = new Array<number>(vLength).fill(-1);
    const snake2 = new Array<number>(vLength).fill(-1);
    v1[vOffset + 1] = 0;
    v2[vOffset + 1] = 0;
    const delta = length1 - length2;
    const front = delta % 2 !== 0;
    let k1start = 0;
    let k1end = 0;
    let k2start = 0;
    let k2end = 0;
    for (let d = 0; d < maxD; d++) {
        if (Date.now() > deadline) break;
        let bestX = -1;
        let bestY = -1;
        let bestSnake = -1;
        for (let k1 = -d + k1start; k1 <= d - k1end; k1 += 2) {
            const k1Offset = vOffset + k1;
            let x1: number;
            let snake: number;
            if (k1 === -d || (k1 !== d && v1[k1Offset - 1] < v1[k1Offset + 1])) {
                x1 = v1[k1Offset + 1];
                snake = snake1[k1Offset + 1];
            } else {
                x1 = v1[k1Offset - 1] + 1;
                snake = snake1[k1Offset - 1];
            }
            let y1 = x1 - k1;
            let run = 0;
            while (x1 < length1 && y1 < length2 && text1.charAt(x1) === text2.charAt(y1)) {
                x1++;
                y1++;
                run++;
            }
            v1[k1Offset] = x1;
            const longest = Math.max(snake, run);
            snake1[k1Offset] = longest;
            if (x1 > length1) {
                k1end += 2;
            } else if (y1 > length2) {
                k1start += 2;
            } else if (front) {
                const k2Offset = vOffset + delta - k1;
                if (k2Offset >= 0 && k2Offset < vLength && v2[k2Offset] !== -1 && x1 >= length1 - v2[k2Offset] && longest > bestSnake) {
                    bestX = x1;
                    bestY = y1;
                    bestSnake = longest;
                }
            }
        }
        if (bestX !== -1) return bisectSplit(text1, text2, bestX, bestY, deadline);
        bestSnake = -1;
        for (let k2 = -d + k2start; k2 <= d - k2end; k2 += 2) {
            const k2Offset = vOffset + k2;
            let x2: number;
            let snake: number;
            if (k2 === -d || (k2 !== d && v2[k2Offset - 1] < v2[k2Offset + 1])) {
                x2 = v2[k2Offset + 1];
                snake = snake2[k2Offset + 1];
            } else {
                x2 = v2[k2Offset - 1] + 1;
                snake = snake2[k2Offset - 1];
            }
            let y2 = x2 - k2;
            let run = 0;
            while (x2 < length1 && y2 < length2 && text1.charAt(length1 - x2 - 1) === text2.charAt(length2 - y2 - 1)) {
                x2++;
                y2++;
                run++;
            }
            v2[k2Offset] = x2;
            const longest = Math.max(snake, run);
            snake2[k2Offset] = longest;
            if (x2 > length1) {
                k2end += 2;
            } else if (y2 > length2) {
                k2start += 2;
            } else if (!front) {
                const k1Offset = vOffset + delta - k2;
                if (k1Offset >= 0 && k1Offset < vLength && v1[k1Offset] !== -1) {
                    const x1 = v1[k1Offset];
                    const y1 = vOffset + x1 - k1Offset;
                    x2 = length1 - x2;
                    if (x1 >= x2 && longest > bestSnake) {
                        bestX = x1;
                        bestY = y1;
                        bestSnake = longest;
                    }
                }
            }
            if (bestX !== -1) return bisectSplit(text1, text2, bestX, bestY, deadline);
        }
    }
    return [[DELETE, text1], [INSERT, text2]];
};

const lineModeDiff = (text1: string, text2: string, deadline: number): Diff[] => {
    const encoded = linesToChars(text1, text2);
    const diffs = myersDiff(encoded.chars1, encoded.chars2, false, deadline);
    charsToLines(diffs, encoded.lineArray);
    cleanupSemantic(diffs);
    diffs.push([EQUAL, '']);
    let pointer = 0;
    let countDelete = 0;
    let countInsert = 0;
    let textDelete = '';
    let textInsert = '';
    while (pointer < diffs.length) {
        switch (diffs[pointer][0]) {
            case INSERT:
                countInsert++;
                textInsert += diffs[pointer][1];
                break;
            case DELETE:
                countDelete++;
                textDelete += diffs[pointer][1];
                break;
            case EQUAL:
                if (countDelete >= 1 && countInsert >= 1) {
                    diffs.splice(pointer - countDelete - countInsert, countDelete + countInsert);
                    pointer = pointer - countDelete - countInsert;
                    const sub = myersDiff(textDelete, textInsert, false, deadline);
                    for (let j = sub.length - 1; j >= 0; j--) diffs.splice(pointer, 0, sub[j]);
                    pointer += sub.length;
                }
                countInsert = 0;
                countDelete = 0;
                textDelete = '';
                textInsert = '';
                break;
        }
        pointer++;
    }
    diffs.pop();
    return diffs;
};

const computeDiff = (text1: string, text2: string, checkLines: boolean, deadline: number): Diff[] => {
    if (!text1) return [[INSERT, text2]];
    if (!text2) return [[DELETE, text1]];
    const longText = text1.length > text2.length ? text1 : text2;
    const shortText = text1.length > text2.length ? text2 : text1;
    const index = longText.indexOf(shortText);
    if (index !== -1) {
        const op: Op = text1.length > text2.length ? DELETE : INSERT;
        return [[op, longText.substring(0, index)], [EQUAL, shortText], [op, longText.substring(index + shortText.length)]];
    }
    if (shortText.length === 1) return [[DELETE, text1], [INSERT, text2]];
    const hm = halfMatch(text1, text2);
    if (hm) {
        const diffsA = myersDiff(hm[0], hm[2], checkLines, deadline);
        const diffsB = myersDiff(hm[1], hm[3], checkLines, deadline);
        return diffsA.concat([[EQUAL, hm[4]]], diffsB);
    }
    if (checkLines && text1.length > 100 && text2.length > 100) return lineModeDiff(text1, text2, deadline);
    return bisect(text1, text2, deadline);
};

const myersDiff = (text1: string, text2: string, checkLines = true, deadline?: number): Diff[] => {
    const end = deadline ?? Date.now() + BISECT_BUDGET_MS;
    if (text1 === text2) return text1 ? [[EQUAL, text1]] : [];
    let length = commonPrefix(text1, text2);
    const prefix = text1.substring(0, length);
    text1 = text1.substring(length);
    text2 = text2.substring(length);
    length = commonSuffix(text1, text2);
    const suffix = text1.substring(text1.length - length);
    const diffs = computeDiff(text1.substring(0, text1.length - length), text2.substring(0, text2.length - length), checkLines, end);
    if (prefix) diffs.unshift([EQUAL, prefix]);
    if (suffix) diffs.push([EQUAL, suffix]);
    cleanupMerge(diffs);
    return diffs;
};

const cleanupMerge = (diffs: Diff[]): void => {
    diffs.push([EQUAL, '']);
    let pointer = 0;
    let countDelete = 0;
    let countInsert = 0;
    let textDelete = '';
    let textInsert = '';
    let length: number;
    while (pointer < diffs.length) {
        switch (diffs[pointer][0]) {
            case INSERT:
                countInsert++;
                textInsert += diffs[pointer][1];
                pointer++;
                break;
            case DELETE:
                countDelete++;
                textDelete += diffs[pointer][1];
                pointer++;
                break;
            case EQUAL:
                if (countDelete + countInsert > 1) {
                    if (countDelete !== 0 && countInsert !== 0) {
                        length = commonPrefix(textInsert, textDelete);
                        if (length !== 0) {
                            const before = pointer - countDelete - countInsert;
                            if (before > 0 && diffs[before - 1][0] === EQUAL) {
                                diffs[before - 1][1] += textInsert.substring(0, length);
                            } else {
                                diffs.splice(0, 0, [EQUAL, textInsert.substring(0, length)]);
                                pointer++;
                            }
                            textInsert = textInsert.substring(length);
                            textDelete = textDelete.substring(length);
                        }
                        length = commonSuffix(textInsert, textDelete);
                        if (length !== 0) {
                            diffs[pointer][1] = textInsert.substring(textInsert.length - length) + diffs[pointer][1];
                            textInsert = textInsert.substring(0, textInsert.length - length);
                            textDelete = textDelete.substring(0, textDelete.length - length);
                        }
                    }
                    pointer -= countDelete + countInsert;
                    diffs.splice(pointer, countDelete + countInsert);
                    if (textDelete.length) {
                        diffs.splice(pointer, 0, [DELETE, textDelete]);
                        pointer++;
                    }
                    if (textInsert.length) {
                        diffs.splice(pointer, 0, [INSERT, textInsert]);
                        pointer++;
                    }
                    pointer++;
                } else if (pointer !== 0 && diffs[pointer - 1][0] === EQUAL) {
                    diffs[pointer - 1][1] += diffs[pointer][1];
                    diffs.splice(pointer, 1);
                } else {
                    pointer++;
                }
                countInsert = 0;
                countDelete = 0;
                textDelete = '';
                textInsert = '';
                break;
        }
    }
    if (diffs[diffs.length - 1][1] === '') diffs.pop();

    let changes = false;
    pointer = 1;
    while (pointer < diffs.length - 1) {
        if (diffs[pointer - 1][0] === EQUAL && diffs[pointer + 1][0] === EQUAL) {
            const previous = diffs[pointer - 1][1];
            const current = diffs[pointer][1];
            if (current.substring(current.length - previous.length) === previous) {
                diffs[pointer][1] = previous + current.substring(0, current.length - previous.length);
                diffs[pointer + 1][1] = previous + diffs[pointer + 1][1];
                diffs.splice(pointer - 1, 1);
                changes = true;
            } else if (current.substring(0, diffs[pointer + 1][1].length) === diffs[pointer + 1][1]) {
                diffs[pointer - 1][1] += diffs[pointer + 1][1];
                diffs[pointer][1] = current.substring(diffs[pointer + 1][1].length) + diffs[pointer + 1][1];
                diffs.splice(pointer + 1, 1);
                changes = true;
            }
        }
        pointer++;
    }
    if (changes) cleanupMerge(diffs);
};

const NON_ALPHANUMERIC = /[^a-zA-Z0-9]/;
const WHITESPACE = /\s/;
const LINE_BREAK = /[\r\n]/;
const BLANK_LINE_END = /\n\r?\n$/;
const BLANK_LINE_START = /^\r?\n\r?\n/;

const semanticBoundaryScore = (one: string, two: string): number => {
    if (!one || !two) return 6;
    const char1 = one.charAt(one.length - 1);
    const char2 = two.charAt(0);
    const nonAlphaNumeric1 = NON_ALPHANUMERIC.test(char1);
    const nonAlphaNumeric2 = NON_ALPHANUMERIC.test(char2);
    const whitespace1 = nonAlphaNumeric1 && WHITESPACE.test(char1);
    const whitespace2 = nonAlphaNumeric2 && WHITESPACE.test(char2);
    const lineBreak1 = whitespace1 && LINE_BREAK.test(char1);
    const lineBreak2 = whitespace2 && LINE_BREAK.test(char2);
    const blankLine1 = lineBreak1 && BLANK_LINE_END.test(one);
    const blankLine2 = lineBreak2 && BLANK_LINE_START.test(two);
    if (blankLine1 || blankLine2) return 5;
    if (lineBreak1 || lineBreak2) return 4;
    if (nonAlphaNumeric1 && !whitespace1 && whitespace2) return 3;
    if (whitespace1 || whitespace2) return 2;
    if (nonAlphaNumeric1 || nonAlphaNumeric2) return 1;
    return 0;
};

const cleanupSemanticLossless = (diffs: Diff[]): void => {
    let pointer = 1;
    while (pointer < diffs.length - 1) {
        if (diffs[pointer - 1][0] === EQUAL && diffs[pointer + 1][0] === EQUAL) {
            let equality1 = diffs[pointer - 1][1];
            let edit = diffs[pointer][1];
            let equality2 = diffs[pointer + 1][1];
            const offset = commonSuffix(equality1, edit);
            if (offset) {
                const common = edit.substring(edit.length - offset);
                equality1 = equality1.substring(0, equality1.length - offset);
                edit = common + edit.substring(0, edit.length - offset);
                equality2 = common + equality2;
            }
            let bestEquality1 = equality1;
            let bestEdit = edit;
            let bestEquality2 = equality2;
            let bestScore = semanticBoundaryScore(equality1, edit) + semanticBoundaryScore(edit, equality2);
            while (edit.charAt(0) === equality2.charAt(0)) {
                equality1 += edit.charAt(0);
                edit = edit.substring(1) + equality2.charAt(0);
                equality2 = equality2.substring(1);
                const score = semanticBoundaryScore(equality1, edit) + semanticBoundaryScore(edit, equality2);
                if (score >= bestScore) {
                    bestScore = score;
                    bestEquality1 = equality1;
                    bestEdit = edit;
                    bestEquality2 = equality2;
                }
            }
            if (diffs[pointer - 1][1] !== bestEquality1) {
                if (bestEquality1) {
                    diffs[pointer - 1][1] = bestEquality1;
                } else {
                    diffs.splice(pointer - 1, 1);
                    pointer--;
                }
                diffs[pointer][1] = bestEdit;
                if (bestEquality2) {
                    diffs[pointer + 1][1] = bestEquality2;
                } else {
                    diffs.splice(pointer + 1, 1);
                    pointer--;
                }
            }
        }
        pointer++;
    }
};

const cleanupSemantic = (diffs: Diff[], maxEqualityLength = Infinity): void => {
    let changes = false;
    const equalities: number[] = [];
    let equalitiesLength = 0;
    let lastEquality: string | null = null;
    let pointer = 0;
    let insertedBefore = 0;
    let deletedBefore = 0;
    let insertedAfter = 0;
    let deletedAfter = 0;
    while (pointer < diffs.length) {
        if (diffs[pointer][0] === EQUAL) {
            equalities[equalitiesLength++] = pointer;
            insertedBefore = insertedAfter;
            deletedBefore = deletedAfter;
            insertedAfter = 0;
            deletedAfter = 0;
            lastEquality = diffs[pointer][1];
        } else {
            if (diffs[pointer][0] === INSERT) insertedAfter += diffs[pointer][1].length;
            else deletedAfter += diffs[pointer][1].length;
            if (
                lastEquality &&
                lastEquality.length <= maxEqualityLength &&
                lastEquality.length <= Math.max(insertedBefore, deletedBefore) &&
                lastEquality.length <= Math.max(insertedAfter, deletedAfter)
            ) {
                diffs.splice(equalities[equalitiesLength - 1], 0, [DELETE, lastEquality]);
                diffs[equalities[equalitiesLength - 1] + 1][0] = INSERT;
                equalitiesLength--;
                pointer = --equalitiesLength > 0 ? equalities[equalitiesLength - 1] : -1;
                insertedBefore = 0;
                deletedBefore = 0;
                insertedAfter = 0;
                deletedAfter = 0;
                lastEquality = null;
                changes = true;
            }
        }
        pointer++;
    }
    if (changes) cleanupMerge(diffs);
    cleanupSemanticLossless(diffs);

    pointer = 1;
    while (pointer < diffs.length) {
        if (diffs[pointer - 1][0] === DELETE && diffs[pointer][0] === INSERT) {
            const deletion = diffs[pointer - 1][1];
            const insertion = diffs[pointer][1];
            const overlap1 = commonOverlap(deletion, insertion);
            const overlap2 = commonOverlap(insertion, deletion);
            if (overlap1 >= overlap2) {
                if (overlap1 >= deletion.length / 2 || overlap1 >= insertion.length / 2) {
                    diffs.splice(pointer, 0, [EQUAL, insertion.substring(0, overlap1)]);
                    diffs[pointer - 1][1] = deletion.substring(0, deletion.length - overlap1);
                    diffs[pointer + 1][1] = insertion.substring(overlap1);
                    pointer++;
                }
            } else if (overlap2 >= deletion.length / 2 || overlap2 >= insertion.length / 2) {
                diffs.splice(pointer, 0, [EQUAL, deletion.substring(0, overlap2)]);
                diffs[pointer - 1][0] = INSERT;
                diffs[pointer - 1][1] = insertion.substring(0, insertion.length - overlap2);
                diffs[pointer + 1][0] = DELETE;
                diffs[pointer + 1][1] = deletion.substring(overlap2);
                pointer++;
            }
            pointer++;
        }
        pointer++;
    }
};

// ---------------------------------------------------------------------------
// Smart-mode cleanup passes
// ---------------------------------------------------------------------------

/** Accumulates diff chunks, merging adjacent equalities and grouping edits. */
class DiffEmitter {
    private readonly emitted: Diff[] = [];
    private readonly pendingDelete: string[] = [];
    private readonly pendingInsert: string[] = [];

    emitEqual(text: string): void {
        if (text === '') return;
        this.flushChanges();
        const last = this.emitted[this.emitted.length - 1];
        if (last !== undefined && last[0] === EQUAL) last[1] += text;
        else this.emitted.push([EQUAL, text]);
    }

    emitDelete(text: string): void {
        if (text !== '') this.pendingDelete.push(text);
    }

    emitInsert(text: string): void {
        if (text !== '') this.pendingInsert.push(text);
    }

    emitChunk([op, text]: Diff): void {
        if (op === EQUAL) this.emitEqual(text);
        else if (op === DELETE) this.emitDelete(text);
        else this.emitInsert(text);
    }

    finish(): Diff[] {
        this.flushChanges();
        return this.emitted;
    }

    private flushChanges(): void {
        if (this.pendingDelete.length > 0) {
            this.emitted.push([DELETE, this.pendingDelete.join('')]);
            this.pendingDelete.length = 0;
        }
        if (this.pendingInsert.length > 0) {
            this.emitted.push([INSERT, this.pendingInsert.join('')]);
            this.pendingInsert.length = 0;
        }
    }
}

const isEdit = (op: Op): boolean => op === DELETE || op === INSERT;

/** Length of the shared tail of `a` and `b`, at most `a.length`. */
const sharedTail = (a: string, b: string): number => {
    const joined = a + b;
    let length = 0;
    while (length < a.length && joined[a.length - length - 1] === joined[joined.length - length - 1]) length++;
    return length;
};

/** Length of the shared head of `a` and `b`, at most `b.length`. */
const sharedHead = (a: string, b: string): number => {
    const joined = a + b;
    let length = 0;
    while (length < b.length && joined[length] === joined[a.length + length]) length++;
    return length;
};

/** Merges `edit, equality, edit` (same op) when the equality can slide into one side. */
const mergeSlidableEdits = (diffs: Diff[]): Diff[] => slideEqualities(slideEqualities(diffs, 'left'), 'right');

const slideEqualities = (diffs: Diff[], side: 'left' | 'right'): Diff[] => {
    let emitter: DiffEmitter | null = null;
    let index = 0;
    while (index < diffs.length) {
        const canMerge = index + 2 < diffs.length && (() => {
            const first = diffs[index];
            const middle = diffs[index + 1];
            const last = diffs[index + 2];
            if (!isEdit(first[0]) || middle[0] !== EQUAL || !isEdit(last[0]) || first[0] !== last[0]) return false;
            const equality = middle[1];
            return equality === ''
                || (side === 'right'
                    ? sharedHead(first[1], equality) === equality.length
                    : sharedTail(equality, last[1]) === equality.length);
        })();
        if (canMerge) {
            if (emitter === null) {
                emitter = new DiffEmitter();
                for (let i = 0; i < index; i++) emitter.emitChunk(diffs[i]);
            }
            const first = diffs[index];
            const middle = diffs[index + 1];
            const last = diffs[index + 2];
            const combined = first[1] + middle[1] + last[1];
            const split = side === 'left' ? first[1].length + last[1].length : middle[1].length;
            const head = combined.substring(0, split);
            const tail = combined.substring(split);
            const emitEdit = (text: string) => (first[0] === DELETE ? emitter?.emitDelete(text) : emitter?.emitInsert(text));
            if (side === 'left') {
                emitEdit(head);
                emitter.emitEqual(tail);
            } else {
                emitter.emitEqual(head);
                emitEdit(tail);
            }
            index += 3;
        } else {
            emitter?.emitChunk(diffs[index]);
            index++;
        }
    }
    return emitter === null ? diffs : emitter.finish();
};

const LOWERCASE = /\p{Ll}/u;
const UPPERCASE = /\p{Lu}/u;
const NUMBER = /\p{N}/u;
const LETTER = /\p{L}/u;
const PUNCTUATION = [',', ';', '.', '!', '?', ':', '(', ')', '[', ']', '{', '}', '"', "'"];
// Classes: 0 none, 1 line break, 2 space, 3 punctuation, 4 lower, 5 upper, 6 digit, 7 other letter, 8 other
const CLASS_WEIGHT: Record<number, number> = { 0: 10, 1: 10, 2: 3, 3: 30, 4: 0, 5: 0, 6: 0, 7: 0, 8: 2 };
const ASCII_CLASS: number[] = (() => {
    const table = new Array<number>(128).fill(8);
    table[9] = 2;
    table[10] = 1;
    table[13] = 1;
    table[32] = 2;
    for (let c = 97; c <= 122; c++) table[c] = 4;
    for (let c = 65; c <= 90; c++) table[c] = 5;
    for (let c = 48; c <= 57; c++) table[c] = 6;
    for (const p of PUNCTUATION) table[p.charCodeAt(0)] = 3;
    return table;
})();

const charClass = (ch: string | undefined): number => {
    if (ch === undefined) return 0;
    const code = ch.charCodeAt(0);
    if (code < 128) return ASCII_CLASS[code];
    if (LOWERCASE.test(ch)) return 4;
    if (UPPERCASE.test(ch)) return 5;
    if (NUMBER.test(ch)) return 6;
    if (LETTER.test(ch)) return 7;
    return 8;
};

const boundaryScore = (before: string | undefined, after: string | undefined): number => {
    if (before === '\r' && after === '\n') return -1;
    if (before !== undefined && after !== undefined) {
        const a = before.charCodeAt(0);
        const b = after.charCodeAt(0);
        if (a >= 0xd800 && a <= 0xdbff && b >= 0xdc00 && b <= 0xdfff) return -1000;
    }
    if (before === '\n') return 150;
    const classBefore = charClass(before);
    const classAfter = charClass(after);
    let score = CLASS_WEIGHT[classBefore] + CLASS_WEIGHT[classAfter];
    if (classBefore !== classAfter) {
        score += 10;
        if (classBefore === 4 && classAfter === 5) score += 1;
    }
    return score;
};

const shiftScore = (prefixLength: number, editLength: number, combined: string, withoutEdit: string, shift: number): number => {
    const at = (text: string, index: number): [string | undefined, string | undefined] =>
        [index > 0 ? text[index - 1] : undefined, index < text.length ? text[index] : undefined];
    const joinPoint = prefixLength + shift;
    const editStart = prefixLength + shift;
    const editEnd = prefixLength + editLength + shift;
    return boundaryScore(...at(withoutEdit, joinPoint))
        + boundaryScore(...at(combined, editStart))
        + boundaryScore(...at(combined, editEnd));
};

/** Slides a lone edit between two equalities to the best-scoring boundary. */
const alignEditBoundaries = (diffs: Diff[]): Diff[] => {
    let emitter: DiffEmitter | null = null;
    let index = 0;
    while (index < diffs.length) {
        const shifted = ((): Diff[] | null => {
            if (index + 2 >= diffs.length) return null;
            const [op1, before] = diffs[index];
            const [op2, edit] = diffs[index + 1];
            const [op3, after] = diffs[index + 2];
            if (op1 !== EQUAL || !isEdit(op2) || op3 !== EQUAL) return null;
            const maxLeft = Math.min(sharedTail(before, edit), 100);
            const maxRight = Math.min(sharedHead(edit, after), 100);
            if (maxLeft === 0 && maxRight === 0) return null;
            const combined = before + edit + after;
            const withoutEdit = before + after;
            const baseline = shiftScore(before.length, edit.length, combined, withoutEdit, 0);
            let bestShift = -maxLeft;
            let bestScore = shiftScore(before.length, edit.length, combined, withoutEdit, -maxLeft);
            for (let shift = -maxLeft + 1; shift <= maxRight; shift++) {
                const score = shiftScore(before.length, edit.length, combined, withoutEdit, shift);
                if (score >= bestScore) {
                    bestScore = score;
                    bestShift = shift;
                }
            }
            if (bestScore < baseline || bestShift === 0) return null;
            const editStart = before.length + bestShift;
            const editEnd = before.length + edit.length + bestShift;
            return [
                [EQUAL, combined.substring(0, editStart)],
                [op2, combined.substring(editStart, editEnd)],
                [EQUAL, combined.substring(editEnd)],
            ];
        })();
        if (shifted !== null) {
            if (emitter === null) {
                emitter = new DiffEmitter();
                for (let i = 0; i < index; i++) emitter.emitChunk(diffs[i]);
            }
            for (const chunk of shifted) emitter.emitChunk(chunk);
            index += 3;
        } else {
            emitter?.emitChunk(diffs[index]);
            index++;
        }
    }
    return emitter === null ? diffs : emitter.finish();
};

const WORD = /[\p{L}\p{N}]+/gu;
const PARTIAL_WORD_RATIO = 2 / 3;

interface SideRange {
    start: number;
    end: number;
}

interface EqualRange {
    leftStart: number;
    leftEnd: number;
    rightStart: number;
    rightEnd: number;
}

const wordRanges = (text: string): Int32Array => {
    const bounds: number[] = [];
    for (const match of text.matchAll(WORD)) bounds.push(match.index, match.index + match[0].length);
    return Int32Array.from(bounds);
};

const findWord = (ranges: Int32Array, position: number): SideRange | undefined => {
    let low = 0;
    let high = ranges.length >>> 1;
    while (low < high) {
        const mid = (low + high) >>> 1;
        const start = ranges[2 * mid];
        const end = ranges[2 * mid + 1];
        if (position < start) high = mid;
        else if (position >= end) low = mid + 1;
        else return { start, end };
    }
    return undefined;
};

const overlapLength = (start1: number, end1: number, start2: number, end2: number): number => {
    const start = start1 > start2 ? start1 : start2;
    const end = end1 < end2 ? end1 : end2;
    return end > start ? end - start : 0;
};

/** Turns words that are only partly unchanged into whole-word edits. */
const absorbPartialWords = (diffs: Diff[]): Diff[] => {
    if (diffs.length === 0) return diffs;
    const leftParts: string[] = [];
    const rightParts: string[] = [];
    const equalRanges: EqualRange[] = [];
    let leftPos = 0;
    let rightPos = 0;
    for (const [op, text] of diffs) {
        const length = text.length;
        if (length === 0) continue;
        if (op === DELETE) {
            leftParts.push(text);
            leftPos += length;
        } else {
            if (op === INSERT) {
                rightParts.push(text);
            } else {
                leftParts.push(text);
                rightParts.push(text);
                equalRanges.push({ leftStart: leftPos, leftEnd: leftPos + length, rightStart: rightPos, rightEnd: rightPos + length });
                leftPos += length;
            }
            rightPos += length;
        }
    }
    if (equalRanges.length === 0) return diffs;
    const leftWords = wordRanges(leftParts.join(''));
    const rightWords = wordRanges(rightParts.join(''));

    const shared = (pair: { left: SideRange; right: SideRange }, range: EqualRange): number =>
        overlapLength(pair.left.start, pair.left.end, range.leftStart, range.leftEnd)
        + overlapLength(pair.right.start, pair.right.end, range.rightStart, range.rightEnd);
    const extend = (side: SideRange, ranges: Int32Array, position: number) => {
        const word = findWord(ranges, position);
        if (word === undefined) return;
        if (word.start < side.start) side.start = word.start;
        if (word.end > side.end) side.end = word.end;
    };

    const partial: EqualRange[] = [];
    let leftDone = 0;
    let rightDone = 0;
    const inspect = (leftPosition: number, rightPosition: number, rangeIndex: number) => {
        if (leftPosition < leftDone || rightPosition < rightDone) return;
        const leftWord = findWord(leftWords, leftPosition);
        const rightWord = findWord(rightWords, rightPosition);
        if (leftWord === undefined || rightWord === undefined) return;
        const pair = { left: { ...leftWord }, right: { ...rightWord } };
        let matched = shared(pair, equalRanges[rangeIndex]);
        for (let k = rangeIndex + 1; k < equalRanges.length; k++) {
            const range = equalRanges[k];
            const touchesLeft = pair.left.start < range.leftEnd && range.leftStart < pair.left.end;
            const touchesRight = pair.right.start < range.rightEnd && range.rightStart < pair.right.end;
            if (!touchesLeft && !touchesRight) break;
            extend(pair.left, leftWords, range.leftStart);
            extend(pair.right, rightWords, range.rightStart);
            matched += shared(pair, range);
        }
        const total = pair.left.end - pair.left.start + (pair.right.end - pair.right.start);
        if (matched < total * PARTIAL_WORD_RATIO) {
            partial.push({ leftStart: pair.left.start, leftEnd: pair.left.end, rightStart: pair.right.start, rightEnd: pair.right.end });
        }
        leftDone = pair.left.end;
        rightDone = pair.right.end;
    };
    for (let k = 0; k < equalRanges.length; k++) {
        const range = equalRanges[k];
        if (range.leftEnd <= range.leftStart) continue;
        inspect(range.leftStart, range.rightStart, k);
        inspect(range.leftEnd - 1, range.rightEnd - 1, k);
    }
    if (partial.length === 0) return diffs;

    const emitter = new DiffEmitter();
    let leftOffset = 0;
    let rightOffset = 0;
    let partialIndex = 0;
    for (const chunk of diffs) {
        const [op, text] = chunk;
        const length = text.length;
        if (op !== EQUAL) {
            emitter.emitChunk(chunk);
            if (op === DELETE) leftOffset += length;
            else rightOffset += length;
            continue;
        }
        let cursor = 0;
        while (partialIndex < partial.length && partial[partialIndex].leftEnd <= leftOffset) partialIndex++;
        while (cursor < length && partialIndex < partial.length) {
            const range = partial[partialIndex];
            if (range.leftStart >= leftOffset + length) break;
            const start = Math.max(range.leftStart - leftOffset, range.rightStart - rightOffset, cursor);
            const end = Math.min(range.leftEnd - leftOffset, range.rightEnd - rightOffset, length);
            if (end <= start) {
                partialIndex++;
                continue;
            }
            if (start > cursor) emitter.emitEqual(text.substring(cursor, start));
            const absorbed = text.substring(start, end);
            emitter.emitDelete(absorbed);
            emitter.emitInsert(absorbed);
            cursor = end;
            if (range.leftEnd <= leftOffset + length && range.rightEnd <= rightOffset + length) partialIndex++;
            else break;
        }
        if (cursor < length) emitter.emitEqual(text.substring(cursor));
        leftOffset += length;
        rightOffset += length;
    }
    return emitter.finish();
};

/** Equalities shorter than 3 characters between two edits become part of the edit. */
const absorbTinyEqualities = (diffs: Diff[]): Diff[] => {
    let emitter: DiffEmitter | null = null;
    for (let i = 0; i < diffs.length; i++) {
        const chunk = diffs[i];
        const [op, text] = chunk;
        const previous = diffs[i - 1];
        const next = diffs[i + 1];
        if (op === EQUAL && previous !== undefined && next !== undefined && isEdit(previous[0]) && isEdit(next[0]) && text.length < 3) {
            if (emitter === null) {
                emitter = new DiffEmitter();
                for (let j = 0; j < i; j++) emitter.emitChunk(diffs[j]);
            }
            emitter.emitDelete(text);
            emitter.emitInsert(text);
        } else {
            emitter?.emitChunk(chunk);
        }
    }
    return emitter === null ? diffs : emitter.finish();
};

interface EditGroup {
    gapIndex: number;
    leftSideScore: number;
    rightSideScore: number;
}

const GAP_MERGE_THRESHOLD = 74184.96480721243;

const sideScore = (lineBreaks: number, chars: number): number => Math.min(40 * lineBreaks + chars, 130);
const groupWeight = (group: EditGroup): number => (group.leftSideScore ** 1.5 + group.rightSideScore ** 1.5) ** 1.5;

const isShortGap = (text: string): boolean => {
    if (text.length > 500) return false;
    let lineBreaks = 0;
    let firstVisible = -1;
    let lastVisible = -1;
    let breakAfterVisible = false;
    for (let i = 0; i < text.length; i++) {
        const code = text.charCodeAt(i);
        const isNewline = code === 10;
        const isBreak = isNewline || code === 13;
        const isSpace = code === 32 || code === 9 || isBreak;
        if (isNewline) lineBreaks++;
        if (isSpace) {
            if (isBreak && firstVisible !== -1) breakAfterVisible = true;
        } else {
            if (firstVisible === -1) firstVisible = i;
            lastVisible = i;
        }
    }
    if (lineBreaks > 5) return false;
    return firstVisible === -1 || (!(lastVisible - firstVisible + 1 > 20) && (!breakAfterVisible || !(lastVisible > firstVisible)));
};

/** Merges large neighbouring edits across short unchanged gaps. */
const mergeEditsAcrossGaps = (diffs: Diff[]): Diff[] => {
    if (diffs.length < 3) return diffs;
    let current = diffs;
    for (let iteration = 0; iteration < 10; iteration++) {
        const groups: EditGroup[] = [];
        let index = 0;
        while (index < current.length) {
            if (current[index][0] === EQUAL) {
                index++;
                continue;
            }
            let leftChars = 0;
            let leftBreaks = 0;
            let rightChars = 0;
            let rightBreaks = 0;
            while (index < current.length && current[index][0] !== EQUAL) {
                const [op, text] = current[index];
                let breaks = 0;
                for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) breaks++;
                if (op === DELETE) {
                    leftChars += text.length;
                    leftBreaks += breaks;
                } else {
                    rightChars += text.length;
                    rightBreaks += breaks;
                }
                index++;
            }
            groups.push({ gapIndex: index, leftSideScore: sideScore(leftBreaks, leftChars), rightSideScore: sideScore(rightBreaks, rightChars) });
        }
        if (groups.length < 2) break;
        let gaps: Set<number> | null = null;
        for (let g = 1; g < groups.length; g++) {
            const previous = groups[g - 1];
            const { gapIndex } = previous;
            if (current[gapIndex][0] === EQUAL && isShortGap(current[gapIndex][1]) && !(groupWeight(previous) + groupWeight(groups[g]) <= GAP_MERGE_THRESHOLD)) {
                if (gaps === null) gaps = new Set();
                gaps.add(gapIndex);
            }
        }
        if (gaps === null) break;
        const emitter = new DiffEmitter();
        for (let i = 0; i < current.length; i++) {
            const chunk = current[i];
            if (gaps.has(i)) {
                emitter.emitDelete(chunk[1]);
                emitter.emitInsert(chunk[1]);
            } else {
                emitter.emitChunk(chunk);
            }
        }
        current = emitter.finish();
    }
    return current;
};

interface SliverMarks {
    head: Int32Array;
    tail: Int32Array;
}

const isSliver = (text: string, start: number, end: number): boolean => {
    if (start >= end) return false;
    let visible = 0;
    for (let i = start; i < end; i++) {
        const code = text.charCodeAt(i);
        if (code !== 32 && code !== 9 && code !== 10 && code !== 13 && ++visible > 3) return false;
    }
    return visible > 0;
};

const markSliver = (diffs: Diff[], index: number, side: 'head' | 'tail', marks: SliverMarks | null): SliverMarks | null => {
    if (index < 0 || index >= diffs.length || diffs[index][0] !== EQUAL) return marks;
    const text = diffs[index][1];
    const from = marks?.head[index] ?? 0;
    const to = text.length - (marks?.tail[index] ?? 0);
    let sliverStart: number;
    let sliverEnd: number;
    if (side === 'head') {
        const lineEnd = text.indexOf('\n', from);
        sliverStart = from;
        sliverEnd = lineEnd === -1 || lineEnd >= to ? to : lineEnd;
    } else {
        const lineStart = text.lastIndexOf('\n', to - 1);
        sliverStart = lineStart === -1 || lineStart < from ? from : lineStart + 1;
        sliverEnd = to;
    }
    if (!isSliver(text, sliverStart, sliverEnd)) return marks;
    const length = sliverEnd - sliverStart;
    const result = marks ?? { head: new Int32Array(diffs.length), tail: new Int32Array(diffs.length) };
    if (side === 'head') result.head[index] += length;
    else result.tail[index] += length;
    return result;
};

/** Absorbs tiny unchanged slivers that hug edits longer than 100 characters. */
const absorbSlivers = (diffs: Diff[]): Diff[] => {
    if (diffs.length < 2) return diffs;
    let marks: SliverMarks | null = null;
    let index = 0;
    while (index < diffs.length) {
        if (diffs[index][0] === EQUAL) {
            index++;
            continue;
        }
        const start = index;
        let editLength = 0;
        while (index < diffs.length && diffs[index][0] !== EQUAL) {
            editLength += diffs[index][1].length;
            index++;
        }
        if (editLength > 100) {
            marks = markSliver(diffs, start - 1, 'tail', marks);
            marks = markSliver(diffs, index, 'head', marks);
        }
    }
    if (marks === null) return diffs;
    const emitter = new DiffEmitter();
    for (let i = 0; i < diffs.length; i++) {
        const head = marks.head[i];
        const tail = marks.tail[i];
        if (head === 0 && tail === 0) {
            emitter.emitChunk(diffs[i]);
            continue;
        }
        const text = diffs[i][1];
        const tailStart = text.length - tail;
        if (head > 0) {
            const absorbed = text.slice(0, head);
            emitter.emitDelete(absorbed);
            emitter.emitInsert(absorbed);
        }
        if (tailStart > head) emitter.emitEqual(text.slice(head, tailStart));
        if (tail > 0) {
            const absorbed = text.slice(tailStart);
            emitter.emitDelete(absorbed);
            emitter.emitInsert(absorbed);
        }
    }
    return emitter.finish();
};

const smartCleanup = (diffs: Diff[]): Diff[] => {
    let result = diffs;
    result = mergeSlidableEdits(result);
    result = mergeSlidableEdits(result);
    result = alignEditBoundaries(result);
    result = absorbPartialWords(result);
    result = absorbTinyEqualities(result);
    result = mergeEditsAcrossGaps(result);
    result = absorbSlivers(result);
    return result;
};

// ---------------------------------------------------------------------------
// Line pass
// ---------------------------------------------------------------------------

interface LineBlock {
    operation: Op;
    original: string[];
    modified: string[];
}

const expandToCodeUnits = <T,>(items: T[], encoded: string): T[] => {
    if (items.length === encoded.length) return items;
    const expanded: T[] = [];
    let index = 0;
    for (const ch of encoded) {
        for (let i = 0; i < ch.length; i++) expanded.push(items[index]);
        index++;
    }
    return expanded;
};

const indentOf = (line: string | undefined): number => {
    if (line === undefined) return 0;
    let count = 0;
    while (line[count] === ' ' || line[count] === '\t') count++;
    return count;
};

const CLOSING_LINE = /^[}\])]+[;,]?$/;

const closingIndentTargets = (blocks: LineBlock[], side: 'original' | 'modified'): Map<number, number> => {
    const other = side === 'original' ? 'modified' : 'original';
    const targets = new Map<number, number>();
    const stack: { indent: number; otherIndent: number }[] = [];
    let offset = 0;
    for (const block of blocks) {
        if (block.operation === EQUAL) {
            for (const [i, line] of block[side].entries()) {
                const trimmed = line.trim();
                if (trimmed.length === 0) continue;
                const indent = indentOf(line);
                while (stack.length > 0 && stack[stack.length - 1].indent > indent) stack.pop();
                if (CLOSING_LINE.test(trimmed)) {
                    const top = stack[stack.length - 1];
                    if (top) targets.set(offset + i, indent + top.otherIndent - top.indent);
                } else {
                    if (stack[stack.length - 1]?.indent === indent) stack.pop();
                    stack.push({ indent, otherIndent: indentOf(block[other][i]) });
                }
            }
        }
        offset += block[side].length;
    }
    return targets;
};

const slideGain = (moved: string | undefined, replaced: string | undefined, targetIndent: number | undefined): number | undefined => {
    if (moved === replaced) return 0;
    if (moved === undefined || replaced === undefined || targetIndent === undefined || moved.trim() !== replaced.trim() || !CLOSING_LINE.test(moved.trim())) return undefined;
    const gain = Math.abs(indentOf(moved) - targetIndent) - Math.abs(indentOf(replaced) - targetIndent);
    return gain > 0 ? gain : undefined;
};

const indentBoundaryScorer = (lines: string[]) => {
    const cache = new Map<number, number>();
    return (index: number): number => {
        const cached = cache.get(index);
        if (cached !== undefined) return cached;
        const score = -(indentOf(lines[index - 1]) + indentOf(lines[index]));
        cache.set(index, score);
        return score;
    };
};

/** Slides inserted/deleted line blocks so they line up with indentation. */
const slideLineBlocks = (blocks: LineBlock[], originalLines: string[], modifiedLines: string[]): LineBlock[] => {
    if (blocks.length === 0) return blocks;
    const padded = [...blocks];
    if (padded[0].operation !== EQUAL) padded.unshift({ operation: EQUAL, original: [], modified: [] });
    if (padded[padded.length - 1].operation !== EQUAL) padded.push({ operation: EQUAL, original: [], modified: [] });
    const bounds = [{ original: 0, modified: 0 }];
    for (const block of padded) {
        const last = bounds[bounds.length - 1];
        bounds.push({ original: last.original + block.original.length, modified: last.modified + block.modified.length });
    }
    const originalScore = indentBoundaryScorer(originalLines);
    const modifiedScore = indentBoundaryScorer(modifiedLines);
    const originalTargets = closingIndentTargets(blocks, 'original');
    const modifiedTargets = closingIndentTargets(blocks, 'modified');
    let changed = false;
    for (let b = 1; b + 1 < padded.length; b++) {
        if (padded[b].operation === EQUAL || padded[b - 1].operation !== EQUAL || padded[b + 1].operation !== EQUAL) continue;
        const start = bounds[b];
        const end = bounds[b + 1];
        const isInsert = padded[b].operation === INSERT;
        const side = isInsert ? 'modified' : 'original';
        const lines = isInsert ? modifiedLines : originalLines;
        const ownScore = isInsert ? modifiedScore : originalScore;
        const otherScore = isInsert ? originalScore : modifiedScore;
        const otherPosition = isInsert ? start.original : start.modified;
        const targets = isInsert ? originalTargets : modifiedTargets;
        const maxUp = Math.min(100, start[side] - bounds[b - 1][side] - (b > 1 ? 1 : 0));
        const maxDown = Math.min(100, bounds[b + 2][side] - end[side] - (b + 2 < padded.length ? 1 : 0));
        const gains = new Map<number, number>([[0, 0]]);
        let up = 0;
        while (up < maxUp) {
            const gain = slideGain(lines[start[side] - up - 1], lines[end[side] - up - 1], targets.get(otherPosition - up - 1));
            if (gain === undefined) break;
            gains.set(-up - 1, (gains.get(-up) ?? 0) + gain);
            up++;
        }
        let down = 0;
        while (down < maxDown) {
            const gain = slideGain(lines[end[side] + down], lines[start[side] + down], targets.get(otherPosition + down));
            if (gain === undefined) break;
            gains.set(down + 1, (gains.get(down) ?? 0) + gain);
            down++;
        }
        if (up === 0 && down === 0) continue;
        const boundaryScore = (shift: number) => otherScore(otherPosition + shift) + ownScore(start[side] + shift) + ownScore(end[side] + shift);
        let bestShift = 0;
        let bestGain = 0;
        let bestBoundary = boundaryScore(0);
        for (let shift = -up; shift <= down; shift++) {
            const gain = gains.get(shift) ?? 0;
            const boundary = boundaryScore(shift);
            if (gain > bestGain || (gain === bestGain && (boundary > bestBoundary || (boundary === bestBoundary && Math.abs(shift) < Math.abs(bestShift))))) {
                bestShift = shift;
                bestGain = gain;
                bestBoundary = boundary;
            }
        }
        if (bestShift !== 0) {
            start.original += bestShift;
            start.modified += bestShift;
            end.original += bestShift;
            end.modified += bestShift;
            changed = true;
        }
    }
    if (!changed) return blocks;
    return padded
        .map(({ operation }, i) => ({
            operation,
            original: originalLines.slice(bounds[i].original, bounds[i + 1].original),
            modified: modifiedLines.slice(bounds[i].modified, bounds[i + 1].modified),
        }))
        .filter(({ original, modified }) => original.length > 0 || modified.length > 0);
};

const diffLines = (original: string, modified: string, budget: Budget, shouldAbort: () => boolean): LineBlock[] => {
    const originalLines = original.split('\n');
    const modifiedLines = modified.split('\n');
    const originalTrimmed = originalLines.map((line) => line.trim());
    const modifiedTrimmed = modifiedLines.map((line) => line.trim());
    const { chars1, chars2 } = linesToChars(originalTrimmed.join('\n') + '\n', modifiedTrimmed.join('\n') + '\n');
    const originalRaw = expandToCodeUnits(originalLines, chars1);
    const modifiedRaw = expandToCodeUnits(modifiedLines, chars2);
    const originalKeys = expandToCodeUnits(originalTrimmed, chars1);
    const modifiedKeys = expandToCodeUnits(modifiedTrimmed, chars2);
    const equalityScore: EqualityScore = (i, j) => {
        const line = originalKeys[i];
        if (line !== modifiedKeys[j]) return 0.99;
        const weight = line.length === 0 ? 0.1 : 1 + Math.log(1 + line.length);
        return originalRaw[i] === modifiedRaw[j] ? weight : 0.99 * weight;
    };

    let diffs: Diff[];
    if (chars1.length + chars2.length > DP_MAX_LINES || budget.exhausted) {
        diffs = myersDiff(chars1, chars2);
    } else {
        try {
            diffs = dynamicProgrammingDiff(chars1, chars2, equalityScore, shouldAbort);
        } catch (error) {
            if (!(error instanceof DPTimeoutError)) throw error;
            budget.exhausted = true;
            diffs = myersDiff(chars1, chars2);
        }
    }
    fixSurrogates(diffs);

    let originalIndex = 0;
    let modifiedIndex = 0;
    const blocks = diffs.map(([operation, text]): LineBlock => {
        let count = 0;
        for (let i = 0; i < text.length; i++, count++) if ((text.codePointAt(i) ?? 0) > 0xffff) i++;
        const originalEnd = originalIndex + (operation === INSERT ? 0 : count);
        const modifiedEnd = modifiedIndex + (operation === DELETE ? 0 : count);
        const block = { operation, original: originalLines.slice(originalIndex, originalEnd), modified: modifiedLines.slice(modifiedIndex, modifiedEnd) };
        originalIndex = originalEnd;
        modifiedIndex = modifiedEnd;
        return block;
    });
    return slideLineBlocks(blocks, originalLines, modifiedLines);
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

const characterDiff = (original: string, modified: string, budget: Budget, shouldAbort: () => boolean): Diff[] => {
    if (original.length + modified.length > DP_MAX_CHARS || budget.exhausted) return myersDiff(original, modified);
    try {
        return dynamicProgrammingDiff(original, modified, undefined, shouldAbort);
    } catch (error) {
        if (!(error instanceof DPTimeoutError)) throw error;
        budget.exhausted = true;
        return myersDiff(original, modified);
    }
};

const smartDiff = (original: string, modified: string, budget: Budget, shouldAbort: () => boolean): Diff[] =>
    smartCleanup(fixSurrogates(characterDiff(original, modified, budget, shouldAbort)));

const whitespaceDiff = (original: string, modified: string): Diff[] => {
    const trimmed = original.trim();
    if (trimmed.length === 0) return myersDiff(original, modified, false);
    const originalIndent = original.length - original.trimStart().length;
    const modifiedIndent = modified.length - modified.trimStart().length;
    return [
        ...myersDiff(original.slice(0, originalIndent), modified.slice(0, modifiedIndent), false),
        [EQUAL, trimmed],
        ...myersDiff(original.slice(originalIndent + trimmed.length), modified.slice(modifiedIndent + trimmed.length), false),
    ];
};

/**
 * Diffs two prompts the way diffchecker.com's "smart" mode does and returns
 * the highlighted segments for each side. Line breaks are kept as `equal`
 * segments so callers can render with `white-space: pre-wrap`.
 */
export const diffPrompts = (originalText: string, modifiedText: string): PromptDiffResult => {
    const original = originalText.replace(/\r\n/g, '\n');
    const modified = modifiedText.replace(/\r\n/g, '\n');
    const budget: Budget = { start: Date.now(), exhausted: false };
    const shouldAbort = () => isBudgetExhausted(budget);

    const result: PromptDiffResult = { original: [], modified: [] };
    const push = (side: PromptDiffSegment[], type: PromptDiffSegmentType, text: string) => {
        if (text === '') return;
        const last = side[side.length - 1];
        if (last !== undefined && last.type === type) last.text += text;
        else side.push({ type, text });
    };
    const pushLines = (side: 'original' | 'modified', lines: string[], type: PromptDiffSegmentType) => {
        for (const line of lines) {
            push(result[side], type, line);
            push(result[side], 'equal', '\n');
        }
    };
    const pushDiff = (diffs: Diff[]) => {
        for (const [op, text] of diffs) {
            if (op !== INSERT) push(result.original, op === DELETE ? 'remove' : 'equal', text);
            if (op !== DELETE) push(result.modified, op === INSERT ? 'insert' : 'equal', text);
        }
        push(result.original, 'equal', '\n');
        push(result.modified, 'equal', '\n');
    };

    const blocks = diffLines(original, modified, budget, shouldAbort);
    for (let b = 0; b < blocks.length; b++) {
        const block = blocks[b];
        const next = blocks[b + 1];
        if (block.operation === DELETE && next?.operation === INSERT) {
            const deleted = block.original.join('\n');
            const inserted = next.modified.join('\n');
            pushDiff(deleted === '' || inserted === ''
                ? [[DELETE, deleted], [INSERT, inserted]]
                : smartDiff(deleted, inserted, budget, shouldAbort));
            b++;
        } else if (block.operation === EQUAL) {
            for (let i = 0; i < block.original.length; i++) {
                if (block.original[i] === block.modified[i]) {
                    pushLines('original', [block.original[i]], 'equal');
                    pushLines('modified', [block.modified[i]], 'equal');
                } else {
                    pushDiff(whitespaceDiff(block.original[i], block.modified[i]));
                }
            }
        } else if (block.operation === DELETE) {
            pushLines('original', block.original, 'remove');
        } else {
            pushLines('modified', block.modified, 'insert');
        }
    }

    // Drop the trailing line break added after the last line.
    for (const side of [result.original, result.modified]) {
        const last = side[side.length - 1];
        if (last?.type === 'equal' && last.text.endsWith('\n')) {
            last.text = last.text.slice(0, -1);
            if (last.text === '') side.pop();
        }
    }
    return result;
};
