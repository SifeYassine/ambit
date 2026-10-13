import type { WorkflowDisplayEdge, WorkflowDisplayNode } from '../workflowGraphUtils';
import { KNOWN_WIDGET_NAMES } from './knownWidgetNames';
import { CONTROL_WIDGET_NAME, matchRegistryWidgetNames } from './registryWidgets';

/** LiteGraph geometry constants (match ComfyUI's canvas so saved positions line up). */
export const TITLE_HEIGHT = 30;
export const SLOT_HEIGHT = 20;
export const WIDGET_HEIGHT = 20;
export const WIDGET_GAP = 4;
export const COLLAPSED_WIDTH = 160;

export const SUBGRAPH_INPUT_NODE_ID = '-10';
export const SUBGRAPH_OUTPUT_NODE_ID = '-20';

export type WorkflowCanvasNodeKind = 'node' | 'subgraph-io';

export interface WorkflowCanvasSlot {
    name: string;
    type: string;
    linked: boolean;
    /** Set when the slot is a converted/linkable widget input; it anchors to that widget's row. */
    widgetName?: string;
}

export interface WorkflowCanvasWidget {
    name: string;
    value: string;
    multiline: boolean;
}

export interface WorkflowCanvasNode {
    id: string;
    kind: WorkflowCanvasNodeKind;
    title: string;
    type: string;
    x: number;
    y: number;
    width: number;
    height: number;
    collapsed: boolean;
    /** LiteGraph mode: 0 always, 2 never (muted), 4 bypass. */
    mode: number;
    color?: string;
    bgcolor?: string;
    inputs: WorkflowCanvasSlot[];
    outputs: WorkflowCanvasSlot[];
    widgets: WorkflowCanvasWidget[];
    /** Definition id when this node is an instance of a subgraph. */
    subgraphId?: string;
}

export interface WorkflowCanvasLink {
    id: string;
    originId: string;
    originSlot: number;
    targetId: string;
    targetSlot: number;
    type: string;
}

export interface WorkflowCanvasGroup {
    /** Index within its graph; stable for the lifetime of a parsed document. */
    id: string;
    title: string;
    x: number;
    y: number;
    width: number;
    height: number;
    color: string;
    fontSize: number;
}

export interface WorkflowCanvasGraph {
    id: string;
    name: string;
    nodes: WorkflowCanvasNode[];
    links: WorkflowCanvasLink[];
    groups: WorkflowCanvasGroup[];
    nodeById: Map<string, WorkflowCanvasNode>;
    /** Use Everywhere connections the extension saved with the workflow (`extra.ue_links`), when present. */
    recordedBroadcasts?: BroadcastLink[];
}

export interface WorkflowCanvasDocument {
    root: WorkflowCanvasGraph;
    subgraphs: Map<string, WorkflowCanvasGraph>;
    /** False when positions were synthesized because the source had no saved layout (API prompt). */
    hasSavedLayout: boolean;
}

type JsonRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is JsonRecord =>
    !!value && typeof value === 'object' && !Array.isArray(value);

const asNumber = (value: unknown, fallback: number): number =>
    typeof value === 'number' && Number.isFinite(value) ? value : fallback;

const asString = (value: unknown): string | undefined =>
    typeof value === 'string' && value.length > 0 ? value : undefined;

const asId = (value: unknown): string | undefined =>
    typeof value === 'number' || (typeof value === 'string' && value.length > 0) ? String(value) : undefined;

/** Reads `[x, y]` arrays and the legacy `{ "0": x, "1": y }` object form. */
const readPair = (value: unknown): [number, number] | null => {
    if (Array.isArray(value) && value.length >= 2) {
        const [a, b] = value as unknown[];
        return typeof a === 'number' && typeof b === 'number' ? [a, b] : null;
    }
    if (isRecord(value) && typeof value['0'] === 'number' && typeof value['1'] === 'number') {
        return [value['0'], value['1']];
    }
    return null;
};

const SEED_CONTROL_VALUES = new Set(['fixed', 'increment', 'decrement', 'randomize']);

const isApiLinkValue = (value: unknown): boolean =>
    Array.isArray(value) && value.length === 2 && (typeof value[0] === 'string' || typeof value[0] === 'number') && typeof value[1] === 'number';

/** Formats a widget value for display on the canvas and in the sidebar. */
export const formatWidgetValue = (value: unknown): string | null => {
    if (value === null || value === undefined) return null;
    if (typeof value === 'string') return value;
    if (typeof value === 'number') {
        return Number.isInteger(value) ? String(value) : String(Number(value.toPrecision(6)));
    }
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    if (isRecord(value) && typeof value.lora === 'string') {
        // rgthree Power Lora Loader rows
        const strength = typeof value.strength === 'number' ? ` ${formatWidgetValue(value.strength)}` : '';
        return `${value.on === false ? '○' : '●'} ${value.lora}${strength}`;
    }
    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
};

const isMultilineValue = (value: string) => value.length > 60 || value.includes('\n');

/** Number of saved widget values that need a name (the seed control value is named separately). */
const countNamedValues = (values: readonly unknown[]) =>
    values.filter((value, index) => !(index > 0 && typeof value === 'string' && SEED_CONTROL_VALUES.has(value))).length;

/**
 * `names`: widget names in order, with the seed control value inserted while pairing.
 * `labels`: a name for every saved value, control values included (from the Comfy Registry match).
 */
type ResolvedWidgetNames =
    | { kind: 'names'; names: readonly string[] }
    | { kind: 'labels'; labels: readonly string[] };

const namesOf = (names: readonly string[]): ResolvedWidgetNames => ({ kind: 'names', names });

/**
 * Widget names for `widgets_values`, from the most reliable source that names every value:
 * the workflow's own `inputs`, then the API prompt, then the built-in table (core nodes, which
 * custom Registry packs sometimes shadow by class name, and versions the Registry lacks), then the
 * Comfy Registry variant (node version) whose widgets fit the saved values. Older frontends list just the
 * converted widgets in `inputs`, and the API prompt also holds link-only inputs, so a partial list
 * is never used positionally: it would shift every name after the gap.
 */
const resolveWidgetNames = (
    type: string,
    rawInputs: JsonRecord[],
    promptNode: JsonRecord | undefined,
    values: readonly unknown[]
): ResolvedWidgetNames => {
    const valueCount = countNamedValues(values);
    const fromInputs = rawInputs
        .map((input) => (isRecord(input.widget) ? asString(input.widget.name) : undefined))
        .filter((name): name is string => !!name);

    // The prompt lists widgets first (in widget order) and then link-only inputs. A widget fed by a
    // link keeps its position, so keep link values only for inputs the workflow marks as widgets.
    const linkedWidgetNames = new Set(fromInputs);
    const promptInputs = promptNode && promptNode.class_type === type && isRecord(promptNode.inputs)
        ? promptNode.inputs
        : undefined;
    const fromPrompt = promptInputs
        ? Object.entries(promptInputs)
            .filter(([name, value]) => linkedWidgetNames.has(name) || !isApiLinkValue(value))
            .map(([name]) => name)
        : [];
    const known = KNOWN_WIDGET_NAMES[type] ?? [];

    const complete = [fromInputs, fromPrompt, known].find((names) => names.length >= valueCount);
    if (complete) return namesOf(complete);
    const fromRegistry = matchRegistryWidgetNames(type, values);
    if (fromRegistry) return { kind: 'labels', labels: fromRegistry };
    // Nothing names every value (e.g. an unserialized upload button at the end): prefer the table or
    // prompt, and trust `inputs` only when it misses at most one trailing value.
    const best = known.length >= fromPrompt.length ? known : fromPrompt;
    if (best.length > 0) return namesOf(best);
    return namesOf(fromInputs.length >= valueCount - 1 ? fromInputs : []);
};

/** Pairs saved widget values with widget names, inserting ComfyUI's unserialized seed control widget. */
export const buildWidgets = (
    type: string,
    widgetsValues: unknown,
    rawInputs: JsonRecord[],
    promptNode?: JsonRecord
): WorkflowCanvasWidget[] => {
    const widgets: WorkflowCanvasWidget[] = [];
    const push = (name: string, raw: unknown) => {
        const value = formatWidgetValue(raw);
        if (value === null) return;
        widgets.push({ name, value, multiline: typeof raw === 'string' && isMultilineValue(value) });
    };

    if (isRecord(widgetsValues)) {
        // VideoHelperSuite and some custom nodes save named widget objects.
        for (const [name, raw] of Object.entries(widgetsValues)) {
            if (isRecord(raw) || Array.isArray(raw)) continue;
            push(name, raw);
        }
        return widgets;
    }
    if (!Array.isArray(widgetsValues)) return widgets;

    // Extensions append their own state (e.g. `[false, true]`) after the real widgets; a list or
    // object with no widget name is never a widget value, so it is left out.
    const isExtensionState = (name: string, raw: unknown) => name === '' && (Array.isArray(raw) || isRecord(raw));
    const resolved = resolveWidgetNames(type, rawInputs, promptNode, widgetsValues);
    if (resolved.kind === 'labels') {
        widgetsValues.forEach((raw, index) => {
            const name = resolved.labels[index] ?? '';
            if (!isExtensionState(name, raw)) push(name, raw);
        });
        return widgets;
    }

    const { names } = resolved;
    let nameIndex = 0;
    let previousName = '';
    for (const raw of widgetsValues) {
        if (typeof raw === 'string' && SEED_CONTROL_VALUES.has(raw) && /seed/i.test(previousName)) {
            push(CONTROL_WIDGET_NAME, raw);
            previousName = CONTROL_WIDGET_NAME;
            continue;
        }
        const name = names[nameIndex] ?? '';
        nameIndex += 1;
        previousName = name;
        if (!isExtensionState(name, raw)) push(name, raw);
    }
    return widgets;
};

/**
 * Ids of the links a graph saves, or null when it has no link list to check against. Use Everywhere
 * removes the links it adds at save time but leaves their ids on the target inputs
 * (`extra.links_added_by_ue`), so an id must exist here to count as a connection.
 */
const readLinkIds = (value: unknown): ReadonlySet<string> | null =>
    Array.isArray(value) ? new Set(readLinks(value).map((link) => link.id)) : null;

const readSlots = (value: unknown, linkedKey: 'link' | 'links', linkIds: ReadonlySet<string> | null): WorkflowCanvasSlot[] => {
    if (!Array.isArray(value)) return [];
    const isSaved = (id: unknown) => {
        const linkId = asId(id);
        return linkId !== undefined && (!linkIds || linkIds.has(linkId));
    };
    return value.filter(isRecord).map((slot) => {
        const linkValue = slot[linkedKey];
        const linked = linkedKey === 'link'
            ? isSaved(linkValue)
            : Array.isArray(linkValue) && linkValue.some(isSaved);
        const widgetName = isRecord(slot.widget) ? asString(slot.widget.name) : undefined;
        return {
            name: asString(slot.label) ?? asString(slot.localized_name) ?? asString(slot.name) ?? '',
            type: typeof slot.type === 'string' ? slot.type : String(slot.type ?? '*'),
            linked,
            ...(widgetName ? { widgetName } : {})
        };
    });
};

const readLinks = (value: unknown): WorkflowCanvasLink[] => {
    if (!Array.isArray(value)) return [];
    const links: WorkflowCanvasLink[] = [];
    for (const entry of value) {
        if (Array.isArray(entry) && entry.length >= 5) {
            const [id, originId, originSlot, targetId, targetSlot, type] = entry as unknown[];
            const origin = asId(originId);
            const target = asId(targetId);
            if (!origin || !target) continue;
            links.push({
                id: asId(id) ?? `${origin}:${target}:${links.length}`,
                originId: origin,
                originSlot: asNumber(originSlot, 0),
                targetId: target,
                targetSlot: asNumber(targetSlot, 0),
                type: typeof type === 'string' ? type : '*'
            });
        } else if (isRecord(entry)) {
            const origin = asId(entry.origin_id);
            const target = asId(entry.target_id);
            if (!origin || !target) continue;
            links.push({
                id: asId(entry.id) ?? `${origin}:${target}:${links.length}`,
                originId: origin,
                originSlot: asNumber(entry.origin_slot, 0),
                targetId: target,
                targetSlot: asNumber(entry.target_slot, 0),
                type: typeof entry.type === 'string' ? entry.type : '*'
            });
        }
    }
    return links;
};

const readGroups = (value: unknown): WorkflowCanvasGroup[] => {
    if (!Array.isArray(value)) return [];
    return value.filter(isRecord).flatMap((group, index) => {
        const bounding = Array.isArray(group.bounding) ? group.bounding : null;
        if (!bounding || bounding.length < 4 || !bounding.every((n) => typeof n === 'number')) return [];
        const [x, y, width, height] = bounding as number[];
        return [{
            id: String(index),
            title: asString(group.title) ?? '',
            x,
            y,
            width,
            height,
            color: asString(group.color) ?? '#3f789e',
            fontSize: asNumber(group.font_size, 24)
        }];
    });
};

const readNode = (
    raw: JsonRecord,
    subgraphNames: Map<string, string>,
    promptNodes: JsonRecord | undefined,
    linkIds: ReadonlySet<string> | null
): WorkflowCanvasNode | null => {
    const id = asId(raw.id);
    const pos = readPair(raw.pos);
    if (!id || !pos) return null;
    const size = readPair(raw.size) ?? [200, 80];
    const type = asString(raw.type) ?? asString(raw.class_type) ?? 'Unknown';
    const subgraphName = subgraphNames.get(type);
    const rawInputs = Array.isArray(raw.inputs) ? raw.inputs.filter(isRecord) : [];
    const promptNode = promptNodes && isRecord(promptNodes[id]) ? promptNodes[id] as JsonRecord : undefined;
    const flags = isRecord(raw.flags) ? raw.flags : {};

    return {
        id,
        kind: 'node',
        title: asString(raw.title) ?? subgraphName ?? type,
        type: subgraphName ? `Subgraph: ${subgraphName}` : type,
        x: pos[0],
        y: pos[1],
        width: Math.max(size[0], 40),
        height: Math.max(size[1], 0),
        collapsed: flags.collapsed === true,
        mode: asNumber(raw.mode, 0),
        color: asString(raw.color),
        bgcolor: asString(raw.bgcolor),
        inputs: readSlots(raw.inputs, 'link', linkIds),
        outputs: readSlots(raw.outputs, 'links', linkIds),
        widgets: buildWidgets(type, raw.widgets_values, rawInputs, promptNode),
        ...(subgraphName ? { subgraphId: type } : {})
    };
};

const indexNodes = (nodes: WorkflowCanvasNode[]) => new Map(nodes.map((node) => [node.id, node]));

const readSubgraphIoNode = (
    id: string,
    title: string,
    bounding: unknown,
    slots: unknown,
    direction: 'inputs' | 'outputs'
): WorkflowCanvasNode | null => {
    const box = isRecord(bounding) && Array.isArray(bounding.bounding) ? bounding.bounding : null;
    if (!box || box.length < 4 || !box.every((n) => typeof n === 'number')) return null;
    const [x, y, width, height] = box as number[];
    const ioSlots = Array.isArray(slots)
        ? slots.filter(isRecord).map((slot) => ({
            name: asString(slot.label) ?? asString(slot.name) ?? '',
            type: typeof slot.type === 'string' ? slot.type : '*',
            linked: Array.isArray(slot.linkIds) && slot.linkIds.length > 0
        }))
        : [];
    return {
        id,
        kind: 'subgraph-io',
        title,
        type: title,
        x,
        y: y + TITLE_HEIGHT,
        width,
        height: Math.max(height - TITLE_HEIGHT, ioSlots.length * SLOT_HEIGHT + 8),
        collapsed: false,
        mode: 0,
        // A subgraph's input node exposes outputs into the graph, and vice versa.
        inputs: direction === 'outputs' ? ioSlots : [],
        outputs: direction === 'inputs' ? ioSlots : [],
        widgets: []
    };
};

const parseJsonRecord = (json: string | undefined): JsonRecord | undefined => {
    if (!json) return undefined;
    try {
        const parsed = JSON.parse(json) as unknown;
        return isRecord(parsed) ? parsed : undefined;
    } catch {
        return undefined;
    }
};

/**
 * Parses a ComfyUI UI-format workflow (the `workflow` chunk) into a drawable document.
 * Returns null for API prompts and other formats that carry no saved node layout.
 */
/**
 * Reads `extra.ue_links`, where cg-use-everywhere saves the connections it resolved:
 * `{ downstream, downstream_slot, upstream, upstream_slot, controller, type }`.
 */
const readRecordedBroadcasts = (extra: unknown, links: readonly WorkflowCanvasLink[]): BroadcastLink[] | undefined => {
    if (!isRecord(extra) || !Array.isArray(extra.ue_links)) return undefined;
    const recorded: BroadcastLink[] = [];
    for (const entry of extra.ue_links.filter(isRecord)) {
        const emitterId = asId(entry.controller);
        const targetId = asId(entry.downstream);
        const upstreamId = asId(entry.upstream);
        if (!emitterId || !targetId) continue;
        const upstreamSlot = asNumber(entry.upstream_slot, 0);
        // Start the drawn link at the emitter input that carries this value.
        const carrier = links.find((link) => link.targetId === emitterId && link.originId === upstreamId && link.originSlot === upstreamSlot);
        recorded.push({
            emitterId,
            emitterSlot: carrier ? carrier.targetSlot : -1,
            targetId,
            targetSlot: asNumber(entry.downstream_slot, 0),
            type: asString(entry.type) ?? '*'
        });
    }
    return recorded;
};

export const parseWorkflowCanvasDocument = (
    workflowJson: string | undefined,
    promptJson?: string
): WorkflowCanvasDocument | null => {
    const workflow = parseJsonRecord(workflowJson);
    if (!workflow || !Array.isArray(workflow.nodes)) return null;

    const promptNodes = parseJsonRecord(promptJson);
    const definitions = isRecord(workflow.definitions) && Array.isArray(workflow.definitions.subgraphs)
        ? workflow.definitions.subgraphs.filter(isRecord)
        : [];
    const subgraphNames = new Map<string, string>();
    for (const definition of definitions) {
        const id = asString(definition.id);
        if (id) subgraphNames.set(id, asString(definition.name) ?? 'Subgraph');
    }

    const rootLinkIds = readLinkIds(workflow.links);
    const rootNodes = workflow.nodes
        .filter(isRecord)
        .map((raw) => readNode(raw, subgraphNames, promptNodes, rootLinkIds))
        .filter((node): node is WorkflowCanvasNode => !!node);
    if (rootNodes.length === 0) return null;

    const subgraphs = new Map<string, WorkflowCanvasGraph>();
    for (const definition of definitions) {
        const id = asString(definition.id);
        if (!id) continue;
        const nodes = (Array.isArray(definition.nodes) ? definition.nodes.filter(isRecord) : [])
            // Inner node ids do not match API prompt ids (those are "outer:inner"), so skip prompt names.
            .map((raw) => readNode(raw, subgraphNames, undefined, readLinkIds(definition.links)))
            .filter((node): node is WorkflowCanvasNode => !!node);
        const inputNode = readSubgraphIoNode(SUBGRAPH_INPUT_NODE_ID, 'Inputs', definition.inputNode, definition.inputs, 'inputs');
        const outputNode = readSubgraphIoNode(SUBGRAPH_OUTPUT_NODE_ID, 'Outputs', definition.outputNode, definition.outputs, 'outputs');
        if (inputNode) nodes.push(inputNode);
        if (outputNode) nodes.push(outputNode);
        subgraphs.set(id, {
            id,
            name: subgraphNames.get(id) ?? 'Subgraph',
            nodes,
            links: readLinks(definition.links),
            groups: readGroups(definition.groups),
            nodeById: indexNodes(nodes)
        });
    }

    const rootLinks = readLinks(workflow.links);
    const recordedBroadcasts = readRecordedBroadcasts(workflow.extra, rootLinks);
    return {
        root: {
            id: 'root',
            name: 'Workflow',
            nodes: rootNodes,
            links: rootLinks,
            groups: readGroups(workflow.groups),
            nodeById: indexNodes(rootNodes),
            ...(recordedBroadcasts ? { recordedBroadcasts } : {})
        },
        subgraphs,
        hasSavedLayout: true
    };
};

const AUTO_COLUMN_GAP = 120;
const AUTO_ROW_GAP = 50;
const AUTO_NODE_WIDTH = 300;

/**
 * Builds a left-to-right layered layout for graphs without saved positions
 * (API prompts, or anything the backend normalized without a UI workflow).
 */
export const buildAutoLayoutDocument = (
    nodes: readonly WorkflowDisplayNode[],
    edges: readonly WorkflowDisplayEdge[]
): WorkflowCanvasDocument | null => {
    if (nodes.length === 0) return null;

    const ids = nodes.map((node) => String(node.id));
    const known = new Set(ids);
    const incoming = new Map<string, WorkflowDisplayEdge[]>(ids.map((id) => [id, []]));
    const outgoing = new Map<string, WorkflowDisplayEdge[]>(ids.map((id) => [id, []]));
    for (const edge of edges) {
        if (!known.has(edge.sourceNodeId) || !known.has(edge.targetNodeId)) continue;
        incoming.get(edge.targetNodeId)!.push(edge);
        outgoing.get(edge.sourceNodeId)!.push(edge);
    }

    // Longest-path layering via Kahn's algorithm; nodes left in cycles land in the last layer.
    const layer = new Map<string, number>();
    const remaining = new Map(ids.map((id) => [id, incoming.get(id)!.length]));
    const queue = ids.filter((id) => remaining.get(id) === 0);
    for (const id of queue) layer.set(id, 0);
    while (queue.length > 0) {
        const id = queue.shift()!;
        for (const edge of outgoing.get(id)!) {
            const next = edge.targetNodeId;
            layer.set(next, Math.max(layer.get(next) ?? 0, layer.get(id)! + 1));
            const left = remaining.get(next)! - 1;
            remaining.set(next, left);
            if (left === 0) queue.push(next);
        }
    }
    const maxLayer = Math.max(0, ...layer.values());
    for (const id of ids) if (!layer.has(id)) layer.set(id, maxLayer + 1);
    if (maxLayer === 0) {
        // No usable edges: a grid reads better than one very tall column.
        const perColumn = Math.ceil(Math.sqrt(ids.length));
        ids.forEach((id, index) => layer.set(id, Math.floor(index / perColumn)));
    }

    const slotIndex = new Map<string, Map<string, number>>();
    const outputSlots = new Map<string, number>();
    for (const edge of edges) {
        if (!known.has(edge.sourceNodeId) || !known.has(edge.targetNodeId)) continue;
        const inputs = slotIndex.get(edge.targetNodeId) ?? new Map<string, number>();
        if (!inputs.has(edge.targetInputName)) inputs.set(edge.targetInputName, inputs.size);
        slotIndex.set(edge.targetNodeId, inputs);
        outputSlots.set(edge.sourceNodeId, Math.max(outputSlots.get(edge.sourceNodeId) ?? 0, (edge.sourceOutputSlot ?? 0) + 1));
    }

    const columnY = new Map<number, number>();
    const canvasNodes: WorkflowCanvasNode[] = [];
    const ordered = [...nodes].sort((a, b) => (layer.get(String(a.id))! - layer.get(String(b.id))!));
    for (const node of ordered) {
        const id = String(node.id);
        const inputNames = slotIndex.get(id) ?? new Map<string, number>();
        const inputs: WorkflowCanvasSlot[] = [...inputNames.keys()].map((name) => ({ name, type: '*', linked: true }));
        const outputs: WorkflowCanvasSlot[] = Array.from({ length: outputSlots.get(id) ?? 0 }, (_, index) => ({
            name: `output ${index}`,
            type: '*',
            linked: true
        }));
        const rawInputs = node.inputs;
        const widgets: WorkflowCanvasWidget[] = Array.isArray(rawInputs)
            ? []
            : Object.entries(rawInputs).flatMap(([name, raw]) => {
                if (inputNames.has(name) || isApiLinkValue(raw)) return [];
                const value = formatWidgetValue(raw);
                return value === null ? [] : [{ name, value, multiline: typeof raw === 'string' && isMultilineValue(value) }];
            });
        const multilineCount = widgets.filter((widget) => widget.multiline).length;
        const height = Math.max(inputs.length, outputs.length) * SLOT_HEIGHT
            + widgets.length * (WIDGET_HEIGHT + WIDGET_GAP)
            + multilineCount * 90
            + 12;
        const column = layer.get(id)!;
        const y = columnY.get(column) ?? 0;
        columnY.set(column, y + height + TITLE_HEIGHT + AUTO_ROW_GAP);

        canvasNodes.push({
            id,
            kind: 'node',
            title: node.title,
            type: node.type,
            x: column * (AUTO_NODE_WIDTH + AUTO_COLUMN_GAP),
            y: y + TITLE_HEIGHT,
            width: AUTO_NODE_WIDTH,
            height,
            collapsed: false,
            mode: 0,
            inputs,
            outputs,
            widgets
        });
    }

    const links: WorkflowCanvasLink[] = edges.flatMap((edge, index) => {
        if (!known.has(edge.sourceNodeId) || !known.has(edge.targetNodeId)) return [];
        return [{
            id: `auto-${index}`,
            originId: edge.sourceNodeId,
            originSlot: edge.sourceOutputSlot ?? 0,
            targetId: edge.targetNodeId,
            targetSlot: slotIndex.get(edge.targetNodeId)?.get(edge.targetInputName) ?? 0,
            type: '*'
        }];
    });

    return {
        root: { id: 'root', name: 'Workflow', nodes: canvasNodes, links, groups: [], nodeById: indexNodes(canvasNodes) },
        subgraphs: new Map(),
        hasSavedLayout: false
    };
};

export interface NodeLayoutEdit {
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    collapsed?: boolean;
}

export interface GroupLayoutEdit {
    x: number;
    y: number;
    width: number;
    height: number;
}

/** Session-only layout changes for one graph. Never written back to the workflow. */
export interface GraphLayoutEdits {
    nodes: ReadonlyMap<string, NodeLayoutEdit>;
    groups: ReadonlyMap<string, GroupLayoutEdit>;
    /** Node ids brought to the front, oldest first; later entries draw on top. */
    order: readonly string[];
}

export const EMPTY_LAYOUT_EDITS: GraphLayoutEdits = { nodes: new Map(), groups: new Map(), order: [] };

/** True when edits change geometry or collapse state (draw order alone does not count). */
export const hasLayoutChanges = (edits: GraphLayoutEdits | undefined) =>
    !!edits && (edits.nodes.size > 0 || edits.groups.size > 0);

/**
 * Returns the graph with session-only layout edits applied. Edited nodes become new objects (so cached
 * slot geometry is recomputed); untouched nodes keep their identity. The source graph is never mutated.
 */
export const applyLayoutEdits = (
    graph: WorkflowCanvasGraph,
    edits: GraphLayoutEdits | undefined
): WorkflowCanvasGraph => {
    if (!edits || (edits.nodes.size === 0 && edits.groups.size === 0 && edits.order.length === 0)) return graph;

    let nodes = graph.nodes.map((node) => {
        const edit = edits.nodes.get(node.id);
        return edit ? { ...node, ...edit } : node;
    });
    if (edits.order.length > 0) {
        const rank = new Map(edits.order.map((id, index) => [id, index]));
        nodes = [
            ...nodes.filter((node) => !rank.has(node.id)),
            ...nodes.filter((node) => rank.has(node.id)).sort((a, b) => rank.get(a.id)! - rank.get(b.id)!)
        ];
    }
    const groups = edits.groups.size > 0
        ? graph.groups.map((group) => {
            const edit = edits.groups.get(group.id);
            return edit ? { ...group, ...edit } : group;
        })
        : graph.groups;
    return { ...graph, nodes, groups, nodeById: indexNodes(nodes) };
};

/** Graph addressed by a path of subgraph-instance node ids from the root. */
export const resolveGraphAtPath = (
    document: WorkflowCanvasDocument,
    path: readonly string[]
): { graph: WorkflowCanvasGraph; path: string[] } => {
    let graph = document.root;
    const resolved: string[] = [];
    for (const nodeId of path) {
        const subgraphId = graph.nodeById.get(nodeId)?.subgraphId;
        const next = subgraphId ? document.subgraphs.get(subgraphId) : undefined;
        if (!next) break;
        graph = next;
        resolved.push(nodeId);
    }
    return { graph, path: resolved };
};

/**
 * Maps a backend display-node id ("outer:inner" for expanded subgraph nodes) to the
 * canvas graph path and local node id. Returns null when the node is not drawable.
 */
export const locateCanvasNode = (
    document: WorkflowCanvasDocument,
    displayNodeId: string
): { path: string[]; nodeId: string } | null => {
    const segments = displayNodeId.split(':');
    const nodeId = segments.pop()!;
    const { graph, path } = resolveGraphAtPath(document, segments);
    if (path.length !== segments.length || !graph.nodeById.has(nodeId)) return null;
    return { path, nodeId };
};

export const toDisplayNodeId = (path: readonly string[], nodeId: string) => [...path, nodeId].join(':');

/** An implicit connection made by a cg-use-everywhere emitter; it is not stored in the workflow. */
export interface BroadcastLink {
    emitterId: string;
    /** Emitter input that carries the value; -1 for emitters that send their own widget (Seed Everywhere). */
    emitterSlot: number;
    targetId: string;
    targetSlot: number;
    type: string;
}

const USE_EVERYWHERE_TYPES = new Set(['Anything Everywhere', 'Anything Everywhere3', 'Anything Everywhere?', 'Prompts Everywhere', 'Seed Everywhere']);

export const isUseEverywhereNode = (node: WorkflowCanvasNode) => node.kind === 'node' && USE_EVERYWHERE_TYPES.has(node.type);

const widgetRegex = (node: WorkflowCanvasNode, name: string): RegExp | null => {
    const pattern = node.widgets.find((widget) => widget.name === name)?.value.trim();
    if (!pattern || pattern === '.*') return null;
    try {
        return new RegExp(pattern);
    } catch {
        return null;
    }
};

const groupTitlesAt = (graph: WorkflowCanvasGraph, node: WorkflowCanvasNode) => {
    const centerX = node.x + node.width / 2;
    const centerY = node.y + node.height / 2;
    return graph.groups
        .filter((group) => centerX >= group.x && centerX <= group.x + group.width && centerY >= group.y && centerY <= group.y + group.height)
        .map((group) => group.title);
};

/**
 * Inputs a Use Everywhere emitter feeds, following cg-use-everywhere's matching: unconnected inputs
 * whose type matches a connected emitter input, narrowed by the `?` node's title/input/group
 * regexes, Prompts Everywhere's positive/negative names, and Seed Everywhere's seed inputs.
 * Used when the workflow has no `extra.ue_links` record; group and color restrictions from the node's
 * context menu are not applied.
 */
export const findBroadcastLinks = (graph: WorkflowCanvasGraph, emitterId: string): BroadcastLink[] => {
    const emitter = graph.nodeById.get(emitterId);
    if (!emitter || !isUseEverywhereNode(emitter) || emitter.mode === 2 || emitter.mode === 4) return [];
    // The extension's own record is exact; the matching below is a fallback for workflows without it.
    if (graph.recordedBroadcasts) {
        return graph.recordedBroadcasts.filter((link) => link.emitterId === emitter.id && graph.nodeById.has(link.targetId));
    }

    const sources: Array<{ slot: number; type: string; inputName?: RegExp }> = [];
    if (emitter.type === 'Seed Everywhere') {
        sources.push({ slot: -1, type: 'INT', inputName: /seed/i });
    } else {
        emitter.inputs.forEach((_, slot) => {
            const link = graph.links.find((candidate) => candidate.targetId === emitter.id && candidate.targetSlot === slot);
            if (!link) return;
            const type = link.type !== '*' ? link.type : graph.nodeById.get(link.originId)?.outputs[link.originSlot]?.type ?? '*';
            if (type === '*') return;
            const inputName = emitter.type === 'Prompts Everywhere' ? (slot === 0 ? /pos/i : /neg/i) : undefined;
            sources.push({ slot, type, inputName });
        });
    }
    if (sources.length === 0) return [];

    const titleRegex = emitter.type === 'Anything Everywhere?' ? widgetRegex(emitter, 'title_regex') : null;
    const inputRegex = emitter.type === 'Anything Everywhere?' ? widgetRegex(emitter, 'input_regex') : null;
    const groupRegex = emitter.type === 'Anything Everywhere?' ? widgetRegex(emitter, 'group_regex') : null;

    const links: BroadcastLink[] = [];
    for (const node of graph.nodes) {
        if (node.id === emitter.id || node.kind !== 'node' || isUseEverywhereNode(node)) continue;
        if (titleRegex && !titleRegex.test(node.title)) continue;
        if (groupRegex && !groupTitlesAt(graph, node).some((title) => groupRegex.test(title))) continue;
        node.inputs.forEach((input, targetSlot) => {
            if (input.linked) return;
            if (inputRegex && !inputRegex.test(input.name)) return;
            const inputTypes = input.type.split(',');
            const source = sources.find((candidate) =>
                inputTypes.includes(candidate.type)
                && (!candidate.inputName || candidate.inputName.test(input.name))
                // Widgets are only fed when they are seeds (Seed Everywhere); other widgets keep their value.
                && (!input.widgetName || candidate.slot === -1));
            if (source) links.push({ emitterId: emitter.id, emitterSlot: source.slot, targetId: node.id, targetSlot, type: source.type });
        });
    }
    return links;
};
