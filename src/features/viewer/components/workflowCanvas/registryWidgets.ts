// Widget names derived from the official Comfy Registry (api.comfy.org) by
// scripts/generate-comfy-registry-widgets.mjs. Loaded as raw text so TypeScript does not infer a
// type for the multi-megabyte table; parsed once, on first use.
import registryJson from './registryWidgetNames.json?raw';

/** `[kinds, ...nameIndexes]`; kinds: i INT, I seed INT (followed by a control value), f FLOAT, s STRING, b BOOLEAN, c COMBO, u upload. */
export type RegistryVariant = [string, ...number[]];

export interface RegistryTable {
    names: string[];
    nodes: Record<string, RegistryVariant[]>;
}

const SEED_CONTROL_VALUES = new Set(['fixed', 'increment', 'decrement', 'randomize']);
export const CONTROL_WIDGET_NAME = 'control_after_generate';

let table: RegistryTable | null | undefined;

const loadTable = (): RegistryTable | null => {
    if (table !== undefined) return table;
    try {
        const parsed = JSON.parse(registryJson) as Partial<RegistryTable>;
        table = Array.isArray(parsed.names) && parsed.nodes && typeof parsed.nodes === 'object'
            ? { names: parsed.names, nodes: parsed.nodes }
            : null;
    } catch {
        table = null;
    }
    return table;
};

/** Whether a saved value can belong to a widget of this kind. */
const fitsKind = (kind: string, value: unknown) => {
    if (value === null || value === undefined) return true;
    switch (typeof value) {
        case 'number':
            return kind === 'i' || kind === 'I' || kind === 'f' || kind === 'c';
        case 'boolean':
            return kind === 'b';
        case 'string':
            return kind === 's' || kind === 'c' || kind === 'u';
        default:
            // Registry widgets hold plain values; lists and objects are extension state saved
            // alongside them (e.g. `[false, true]`), so they never fill a widget slot.
            return false;
    }
};

/**
 * Lines up one Registry variant with saved values. Returns a name per value, or null when the
 * values do not fit: a value of the wrong kind, or primitive values left over after the variant's
 * widgets (a different node version). Lists/objects left over are extension state and stay unnamed.
 * `missing` counts trailing widgets with no saved value (an older version that had fewer widgets).
 */
const alignVariant = (variant: RegistryVariant, names: readonly string[], values: readonly unknown[]) => {
    const [kinds, ...nameIndexes] = variant;
    const labels: string[] = [];
    let valueIndex = 0;
    for (let widget = 0; widget < kinds.length; widget += 1) {
        if (valueIndex >= values.length) return { labels, missing: kinds.length - widget };
        const kind = kinds[widget];
        const value = values[valueIndex];
        if (!fitsKind(kind, value)) return null;
        labels.push(names[nameIndexes[widget]] ?? '');
        valueIndex += 1;
        if (kind === 'I' && typeof values[valueIndex] === 'string' && SEED_CONTROL_VALUES.has(values[valueIndex] as string)) {
            labels.push(CONTROL_WIDGET_NAME);
            valueIndex += 1;
        }
    }
    for (; valueIndex < values.length; valueIndex += 1) {
        const value = values[valueIndex];
        if (value !== null && typeof value !== 'object') return null;
        labels.push('');
    }
    return { labels, missing: 0 };
};

/**
 * Names for a node's `widgets_values`, one per value, from the Registry variant (pack version)
 * that fits the saved values best: an exact fit first, otherwise the one missing the fewest
 * trailing widgets. Null when the node is unknown or no variant fits.
 */
export const matchWidgetNamesInTable = (
    registry: RegistryTable | null,
    type: string,
    values: readonly unknown[]
): string[] | null => {
    const variants = registry?.nodes[type];
    if (!registry || !variants || values.length === 0) return null;
    let best: { labels: string[]; missing: number } | null = null;
    for (const variant of variants) {
        const aligned = alignVariant(variant, registry.names, values);
        if (!aligned) continue;
        if (aligned.missing === 0) return aligned.labels;
        if (!best || aligned.missing < best.missing) best = aligned;
    }
    return best ? best.labels : null;
};

/** Matches against the generated Registry table that ships with the app. */
export const matchRegistryWidgetNames = (type: string, values: readonly unknown[]): string[] | null =>
    matchWidgetNamesInTable(loadTable(), type, values);
