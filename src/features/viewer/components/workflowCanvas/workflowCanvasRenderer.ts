import {
    COLLAPSED_WIDTH,
    SLOT_HEIGHT,
    TITLE_HEIGHT,
    WIDGET_GAP,
    type BroadcastLink,
    WIDGET_HEIGHT,
    type WorkflowCanvasGraph,
    type WorkflowCanvasGroup,
    type WorkflowCanvasNode,
    type WorkflowCanvasWidget
} from './workflowCanvasModel';

export interface WorkflowViewport {
    scale: number;
    offsetX: number;
    offsetY: number;
}

export interface WorkflowBounds {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
}

export const MIN_SCALE = 0.05;
export const MAX_SCALE = 4;

export const FONT_FAMILY = 'Inter, "Segoe UI", Arial, sans-serif';
export const MONO_FAMILY = 'ui-monospace, "Cascadia Mono", Consolas, monospace';
export const MULTILINE_LINE_HEIGHT = 16;
const TITLE_DETAIL_SCALE = 0.35;
export const FULL_DETAIL_SCALE = 0.5;

/** ComfyUI dark-palette colors so the graph reads like the editor it came from. */
export const COLORS = {
    background: '#1e1e1e',
    grid: 'rgba(255, 255, 255, 0.035)',
    nodeTitle: '#2b2b2b',
    nodeBody: '#353535',
    titleText: '#b5b5b5',
    selectedTitleText: '#ffffff',
    slotText: '#a8a8a8',
    widgetBg: '#222222',
    widgetOutline: '#555555',
    widgetLabel: '#999999',
    widgetValue: '#dddddd',
    selection: '#ffffff',
    bypassTitle: '#7a2f7a',
    bypassBody: '#5a245a',
    defaultLink: '#99aa99'
} as const;

const LINK_TYPE_COLORS: Record<string, string> = {
    CLIP: '#FFD500',
    CLIP_VISION: '#A8DADC',
    CLIP_VISION_OUTPUT: '#AD7452',
    CONDITIONING: '#FFA931',
    CONTROL_NET: '#6EE7B7',
    IMAGE: '#64B5F6',
    LATENT: '#FF9CF9',
    MASK: '#81C784',
    MODEL: '#B39DDB',
    STYLE_MODEL: '#C2FFAE',
    VAE: '#FF6E6E',
    NOISE: '#B0B0B0',
    GUIDER: '#66FFFF',
    SAMPLER: '#ECB4B4',
    SIGMAS: '#CDFFCD',
    INT: '#7FB2D9',
    FLOAT: '#AFCB7C',
    STRING: '#9FD3A7',
    BOOLEAN: '#C9A0DC'
};

export const linkColor = (type: string) => LINK_TYPE_COLORS[type.toUpperCase()] ?? COLORS.defaultLink;

interface WidgetBox {
    widget: WorkflowCanvasWidget;
    y: number;
    height: number;
}

interface NodeLayout {
    /** Indices of inputs drawn as their own slot rows (non-widget inputs). */
    rowInputs: number[];
    inputAnchors: Array<[number, number]>;
    outputAnchors: Array<[number, number]>;
    widgets: WidgetBox[];
}

const layoutCache = new WeakMap<WorkflowCanvasNode, NodeLayout>();

export const collapsedWidth = (node: WorkflowCanvasNode) =>
    Math.max(80, Math.min(COLLAPSED_WIDTH * 1.6, node.title.length * 7.5 + 40));

/** Full node bounds in world space, including the title bar drawn above `node.y`. */
export const nodeBounds = (node: WorkflowCanvasNode): WorkflowBounds => {
    const width = node.collapsed ? collapsedWidth(node) : node.width;
    const height = node.collapsed ? 0 : node.height;
    return { minX: node.x, minY: node.y - TITLE_HEIGHT, maxX: node.x + width, maxY: node.y + height };
};

export const getNodeLayout = (node: WorkflowCanvasNode): NodeLayout => {
    const cached = layoutCache.get(node);
    if (cached) return cached;

    const widgetIndexByName = new Map(node.widgets.map((widget, index) => [widget.name, index]));
    const rowInputs = node.inputs
        .map((input, index) => ({ input, index }))
        .filter(({ input }) => !input.widgetName || !widgetIndexByName.has(input.widgetName))
        .map(({ index }) => index);
    const rows = Math.max(rowInputs.length, node.outputs.length);

    const widgetTop = rows * SLOT_HEIGHT + 6;
    const multilineCount = node.widgets.filter((widget) => widget.multiline).length;
    const fixedHeight = (node.widgets.length - multilineCount) * (WIDGET_HEIGHT + WIDGET_GAP);
    const multilineHeight = multilineCount > 0
        ? Math.max(40, (node.height - widgetTop - fixedHeight - 8) / multilineCount - WIDGET_GAP)
        : 0;
    let cursor = widgetTop;
    const widgets = node.widgets.map((widget) => {
        const height = widget.multiline ? multilineHeight : WIDGET_HEIGHT;
        const box = { widget, y: cursor, height };
        cursor += height + WIDGET_GAP;
        return box;
    });

    let inputAnchors: Array<[number, number]>;
    let outputAnchors: Array<[number, number]>;
    if (node.collapsed) {
        const midY = node.y - TITLE_HEIGHT / 2;
        inputAnchors = node.inputs.map(() => [node.x, midY]);
        outputAnchors = node.outputs.map(() => [node.x + collapsedWidth(node), midY]);
    } else {
        const rowByInput = new Map(rowInputs.map((inputIndex, row) => [inputIndex, row]));
        inputAnchors = node.inputs.map((input, index) => {
            const row = rowByInput.get(index);
            if (row !== undefined) return [node.x + 10, node.y + (row + 0.7) * SLOT_HEIGHT];
            const widgetBox = widgets[widgetIndexByName.get(input.widgetName ?? '') ?? -1];
            return [node.x + 6, node.y + (widgetBox ? widgetBox.y + WIDGET_HEIGHT / 2 : 0)];
        });
        outputAnchors = node.outputs.map((_, index) => [node.x + node.width - 10, node.y + (index + 0.7) * SLOT_HEIGHT]);
    }

    const layout = { rowInputs, inputAnchors, outputAnchors, widgets };
    layoutCache.set(node, layout);
    return layout;
};

export const graphBounds = (graph: WorkflowCanvasGraph): WorkflowBounds | null => {
    if (graph.nodes.length === 0 && graph.groups.length === 0) return null;
    const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    const include = (box: WorkflowBounds) => {
        bounds.minX = Math.min(bounds.minX, box.minX);
        bounds.minY = Math.min(bounds.minY, box.minY);
        bounds.maxX = Math.max(bounds.maxX, box.maxX);
        bounds.maxY = Math.max(bounds.maxY, box.maxY);
    };
    graph.nodes.forEach((node) => include(nodeBounds(node)));
    graph.groups.forEach((group) => include({
        minX: group.x,
        minY: group.y,
        maxX: group.x + group.width,
        maxY: group.y + group.height
    }));
    return bounds;
};

export const clampScale = (scale: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));

export const fitViewport = (
    bounds: WorkflowBounds,
    width: number,
    height: number,
    padding = 60,
    maxScale = 1
): WorkflowViewport => {
    const contentWidth = bounds.maxX - bounds.minX + padding * 2;
    const contentHeight = bounds.maxY - bounds.minY + padding * 2;
    const scale = clampScale(Math.min(width / contentWidth, height / contentHeight, maxScale));
    return {
        scale,
        offsetX: (width - (bounds.maxX - bounds.minX) * scale) / 2 - bounds.minX * scale,
        offsetY: (height - (bounds.maxY - bounds.minY) * scale) / 2 - bounds.minY * scale
    };
};

/** Viewport centered on a node at a readable zoom. */
export const focusViewport = (
    node: WorkflowCanvasNode,
    width: number,
    height: number,
    currentScale: number
): WorkflowViewport => {
    const box = nodeBounds(node);
    const fit = Math.min(width / (box.maxX - box.minX + 160), height / (box.maxY - box.minY + 160));
    const scale = clampScale(Math.min(Math.max(currentScale, 0.8), fit, 1.5));
    const centerX = (box.minX + box.maxX) / 2;
    const centerY = (box.minY + box.maxY) / 2;
    return { scale, offsetX: width / 2 - centerX * scale, offsetY: height / 2 - centerY * scale };
};

export const screenToWorld = (viewport: WorkflowViewport, x: number, y: number): [number, number] => [
    (x - viewport.offsetX) / viewport.scale,
    (y - viewport.offsetY) / viewport.scale
];

/** Top-most node under a world-space point (later nodes draw on top). */
export const hitTestNode = (graph: WorkflowCanvasGraph, x: number, y: number): WorkflowCanvasNode | null => {
    for (let index = graph.nodes.length - 1; index >= 0; index -= 1) {
        const node = graph.nodes[index];
        const box = nodeBounds(node);
        if (x >= box.minX && x <= box.maxX && y >= box.minY && y <= box.maxY) return node;
    }
    return null;
};

/** World-space box of a drawn widget, matching the inset used by `drawWidgets`; null when it is not drawn. */
export const widgetBounds = (node: WorkflowCanvasNode, widgetIndex: number): WorkflowBounds | null => {
    const left = node.x + 15;
    const right = node.x + node.width - 15;
    const box = getNodeLayout(node).widgets[widgetIndex];
    if (node.collapsed || !box || right - left <= 10 || box.y + box.height > node.height + 2) return null;
    const top = node.y + box.y;
    return { minX: left, minY: top, maxX: right, maxY: top + box.height };
};

/**
 * Nodes whose widgets can be shown as selectable text over the canvas: visible at full detail,
 * expanded, and not covered by a node drawn later (DOM text always sits above the canvas).
 */
export const textWidgetNodes = (
    graph: WorkflowCanvasGraph,
    viewport: WorkflowViewport,
    width: number,
    height: number
): WorkflowCanvasNode[] => {
    const { scale, offsetX, offsetY } = viewport;
    if (scale < FULL_DETAIL_SCALE || width === 0 || height === 0) return [];
    const visible: WorkflowBounds = {
        minX: -offsetX / scale,
        minY: -offsetY / scale,
        maxX: (width - offsetX) / scale,
        maxY: (height - offsetY) / scale
    };
    const bounds = graph.nodes.map(nodeBounds);
    return graph.nodes.filter((node, index) => {
        if (node.kind !== 'node' || node.collapsed || node.widgets.length === 0) return false;
        if (!intersects(bounds[index], visible)) return false;
        for (let later = index + 1; later < bounds.length; later += 1) {
            if (intersects(bounds[index], bounds[later])) return false;
        }
        return true;
    });
};

export const groupTitleHeight = (group: WorkflowCanvasGroup) => group.fontSize * 1.4;

export type WorkflowCanvasHit =
    | { kind: 'node-collapse'; node: WorkflowCanvasNode }
    | { kind: 'node-resize'; node: WorkflowCanvasNode }
    | { kind: 'node'; node: WorkflowCanvasNode }
    | { kind: 'group-resize'; group: WorkflowCanvasGroup }
    | { kind: 'group-title'; group: WorkflowCanvasGroup }
    | { kind: 'none' };

/** Screen-pixel size of resize corners and the collapse dot, converted to world units. */
const handleSize = (scale: number) => Math.max(10, 14 / scale);

/** Classifies a world-space point the way ComfyUI does: node chrome first, then group chrome. */
export const hitTestCanvas = (graph: WorkflowCanvasGraph, x: number, y: number, scale: number): WorkflowCanvasHit => {
    const handle = handleSize(scale);
    const node = hitTestNode(graph, x, y);
    if (node) {
        const titleTop = node.y - TITLE_HEIGHT;
        if (node.kind === 'node' && Math.hypot(x - (node.x + 15), y - (titleTop + TITLE_HEIGHT / 2)) <= Math.max(10, handle * 0.7)) {
            return { kind: 'node-collapse', node };
        }
        if (!node.collapsed && x >= node.x + node.width - handle && y >= node.y + node.height - handle) {
            return { kind: 'node-resize', node };
        }
        return { kind: 'node', node };
    }
    for (let index = graph.groups.length - 1; index >= 0; index -= 1) {
        const group = graph.groups[index];
        const right = group.x + group.width;
        const bottom = group.y + group.height;
        if (x < group.x || x > right || y < group.y || y > bottom) continue;
        if (x >= right - handle && y >= bottom - handle) return { kind: 'group-resize', group };
        if (y <= group.y + groupTitleHeight(group)) return { kind: 'group-title', group };
    }
    return { kind: 'none' };
};

/** Smallest size that still fits a node's slots and widgets (ComfyUI clamps resizes the same way). */
export const minNodeSize = (node: WorkflowCanvasNode): { width: number; height: number } => {
    const layout = getNodeLayout(node);
    const rows = Math.max(layout.rowInputs.length, node.outputs.length);
    const multiline = node.widgets.filter((widget) => widget.multiline).length;
    const height = rows * SLOT_HEIGHT + 6
        + (node.widgets.length - multiline) * (WIDGET_HEIGHT + WIDGET_GAP)
        + multiline * (40 + WIDGET_GAP)
        + 4;
    return { width: 100, height: Math.max(SLOT_HEIGHT, height) };
};

/** Nodes whose center lies in the group, and groups fully inside it: what moves along with it. */
export const groupContents = (graph: WorkflowCanvasGraph, group: WorkflowCanvasGroup) => {
    const right = group.x + group.width;
    const bottom = group.y + group.height;
    const nodes = graph.nodes.filter((node) => {
        const box = nodeBounds(node);
        const centerX = (box.minX + box.maxX) / 2;
        const centerY = (box.minY + box.maxY) / 2;
        return centerX >= group.x && centerX <= right && centerY >= group.y && centerY <= bottom;
    });
    const groups = graph.groups.filter((other) => other !== group
        && other.x >= group.x && other.y >= group.y
        && other.x + other.width <= right && other.y + other.height <= bottom);
    return { nodes, groups };
};

/** Nodes overlapping a world-space rectangle (box selection). */
export const nodesInRect = (graph: WorkflowCanvasGraph, rect: WorkflowBounds) =>
    graph.nodes.filter((node) => intersects(nodeBounds(node), rect));

const roundRect = (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number | number[]) => {
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') {
        ctx.roundRect(x, y, w, h, r);
    } else {
        ctx.rect(x, y, w, h);
    }
};

const wrapCache = new WeakMap<WorkflowCanvasWidget, { width: number; limit: number; lines: string[] }>();

const wrapText = (ctx: CanvasRenderingContext2D, widget: WorkflowCanvasWidget, maxWidth: number, maxLines: number): string[] => {
    // Bound the work for huge prompts: only lay out what could ever be visible.
    const limit = Math.max(maxLines, 1) + 1;
    const cached = wrapCache.get(widget);
    if (cached && cached.width === maxWidth && cached.limit >= limit) return cached.lines;
    const lines: string[] = [];
    for (const paragraph of widget.value.split('\n')) {
        if (lines.length >= limit) break;
        const words = paragraph.split(/(\s+)/);
        let line = '';
        for (const word of words) {
            const candidate = line + word;
            if (line && ctx.measureText(candidate).width > maxWidth) {
                lines.push(line.trimEnd());
                if (lines.length >= limit) break;
                line = word.trimStart();
            } else {
                line = candidate;
            }
        }
        if (lines.length < limit) lines.push(line);
    }
    wrapCache.set(widget, { width: maxWidth, limit, lines });
    return lines;
};

const drawGrid = (ctx: CanvasRenderingContext2D, viewport: WorkflowViewport, width: number, height: number) => {
    let step = 100 * viewport.scale;
    while (step < 24) step *= 4;
    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = ((viewport.offsetX % step) + step) % step; x < width; x += step) {
        ctx.moveTo(Math.round(x) + 0.5, 0);
        ctx.lineTo(Math.round(x) + 0.5, height);
    }
    for (let y = ((viewport.offsetY % step) + step) % step; y < height; y += step) {
        ctx.moveTo(0, Math.round(y) + 0.5);
        ctx.lineTo(width, Math.round(y) + 0.5);
    }
    ctx.stroke();
};

const intersects = (a: WorkflowBounds, b: WorkflowBounds) =>
    a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;

const drawSlot = (ctx: CanvasRenderingContext2D, x: number, y: number, type: string, linked: boolean) => {
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    if (linked) {
        ctx.fillStyle = linkColor(type);
        ctx.fill();
    } else {
        ctx.strokeStyle = linkColor(type);
        ctx.lineWidth = 1.5;
        ctx.stroke();
    }
};

const drawWidgets = (ctx: CanvasRenderingContext2D, node: WorkflowCanvasNode, layout: NodeLayout) => {
    const left = node.x + 15;
    const width = node.width - 30;
    if (width <= 10) return;

    for (const box of layout.widgets) {
        const top = node.y + box.y;
        if (box.y + box.height > node.height + 2) break;

        if (box.widget.multiline) {
            ctx.fillStyle = COLORS.widgetBg;
            roundRect(ctx, left, top, width, box.height, 4);
            ctx.fill();
            ctx.save();
            ctx.clip();
            ctx.font = `12px ${MONO_FAMILY}`;
            ctx.fillStyle = COLORS.widgetValue;
            ctx.textAlign = 'left';
            ctx.textBaseline = 'top';
            const maxLines = Math.floor((box.height - 8) / MULTILINE_LINE_HEIGHT);
            const lines = wrapText(ctx, box.widget, width - 14, maxLines);
            lines.slice(0, maxLines + 1).forEach((line, index) => {
                ctx.fillText(line, left + 7, top + 5 + index * MULTILINE_LINE_HEIGHT);
            });
            ctx.restore();
            continue;
        }

        ctx.fillStyle = COLORS.widgetBg;
        ctx.strokeStyle = COLORS.widgetOutline;
        ctx.lineWidth = 1;
        roundRect(ctx, left, top, width, WIDGET_HEIGHT, WIDGET_HEIGHT / 2);
        ctx.fill();
        ctx.stroke();
        ctx.save();
        ctx.clip();
        ctx.font = `12px ${FONT_FAMILY}`;
        ctx.textBaseline = 'middle';
        const midY = top + WIDGET_HEIGHT / 2 + 0.5;
        if (box.widget.name) {
            ctx.fillStyle = COLORS.widgetLabel;
            ctx.textAlign = 'left';
            ctx.fillText(box.widget.name, left + 10, midY);
        }
        ctx.fillStyle = COLORS.widgetValue;
        ctx.textAlign = 'right';
        const labelWidth = box.widget.name ? ctx.measureText(box.widget.name).width + 24 : 10;
        const valueRoom = width - labelWidth - 10;
        let value = box.widget.value.replace(/\s+/g, ' ');
        if (valueRoom > 0 && ctx.measureText(value).width > valueRoom) {
            while (value.length > 1 && ctx.measureText(`${value}…`).width > valueRoom) value = value.slice(0, -1);
            value = `${value}…`;
        }
        if (valueRoom > 0) ctx.fillText(value, left + width - 10, midY);
        ctx.restore();
    }
};

/** Where a Use Everywhere emitter's implicit link starts: its right edge, level with the carrying input. */
const broadcastStart = (emitter: WorkflowCanvasNode, slot: number): [number, number] => {
    const right = emitter.x + (emitter.collapsed ? collapsedWidth(emitter) : emitter.width);
    if (emitter.collapsed) return [right, emitter.y - TITLE_HEIGHT / 2];
    const anchor = getNodeLayout(emitter).inputAnchors[slot];
    return [right, anchor ? anchor[1] : emitter.y + Math.min(emitter.height / 2, SLOT_HEIGHT)];
};

const drawBroadcastLinks = (
    ctx: CanvasRenderingContext2D,
    graph: WorkflowCanvasGraph,
    links: readonly BroadcastLink[],
    scale: number,
    dpr: number
) => {
    ctx.save();
    ctx.lineCap = 'round';
    ctx.globalAlpha = 0.6;
    // shadowBlur is in device pixels and ignores the canvas transform.
    ctx.shadowBlur = 14 * dpr;
    for (const link of links) {
        const emitter = graph.nodeById.get(link.emitterId);
        const target = graph.nodeById.get(link.targetId);
        if (!emitter || !target) continue;
        const start = broadcastStart(emitter, link.emitterSlot);
        const end = getNodeLayout(target).inputAnchors[link.targetSlot];
        if (!end) continue;
        const dist = Math.max(Math.hypot(end[0] - start[0], end[1] - start[1]) * 0.25, 30);
        const color = linkColor(link.type);
        ctx.strokeStyle = color;
        ctx.shadowColor = color;
        ctx.lineWidth = Math.max(4, 1.5 / scale);
        ctx.beginPath();
        ctx.moveTo(start[0], start[1]);
        ctx.bezierCurveTo(start[0] + dist, start[1], end[0] - dist, end[1], end[0], end[1]);
        ctx.stroke();
    }
    ctx.restore();
};

/** Muted nodes fade the most; bypassed nodes keep their purple and fade slightly. */
export const nodeOpacity = (node: WorkflowCanvasNode) => (node.mode === 2 ? 0.45 : node.mode === 4 ? 0.65 : 1);

const drawNode = (
    ctx: CanvasRenderingContext2D,
    node: WorkflowCanvasNode,
    scale: number,
    isSelected: boolean,
    isDimmed: boolean,
    skipWidgets: boolean
) => {
    const layout = getNodeLayout(node);
    const bypassed = node.mode === 4;
    const width = node.collapsed ? collapsedWidth(node) : node.width;
    const titleTop = node.y - TITLE_HEIGHT;
    const isIo = node.kind === 'subgraph-io';

    ctx.save();
    ctx.globalAlpha = nodeOpacity(node) * (isDimmed ? 0.25 : 1);

    const titleColor = bypassed ? COLORS.bypassTitle : node.color ?? COLORS.nodeTitle;
    const bodyColor = bypassed ? COLORS.bypassBody : node.bgcolor ?? COLORS.nodeBody;

    if (node.collapsed) {
        ctx.fillStyle = titleColor;
        roundRect(ctx, node.x, titleTop, width, TITLE_HEIGHT, TITLE_HEIGHT / 2);
        ctx.fill();
    } else {
        ctx.fillStyle = bodyColor;
        roundRect(ctx, node.x, titleTop, width, node.height + TITLE_HEIGHT, isIo ? 12 : 8);
        ctx.fill();
        ctx.fillStyle = titleColor;
        roundRect(ctx, node.x, titleTop, width, TITLE_HEIGHT, isIo ? [12, 12, 0, 0] : [8, 8, 0, 0]);
        ctx.fill();
    }

    if (node.subgraphId) {
        // Mark subgraph instances so it is clear they can be opened.
        ctx.strokeStyle = 'rgba(126, 182, 255, 0.55)';
        ctx.lineWidth = 2;
        roundRect(ctx, node.x - 1, titleTop - 1, width + 2, (node.collapsed ? 0 : node.height) + TITLE_HEIGHT + 2, 9);
        ctx.stroke();
    }

    if (isSelected) {
        ctx.strokeStyle = COLORS.selection;
        ctx.lineWidth = Math.max(2, 2 / scale);
        roundRect(ctx, node.x - 3, titleTop - 3, width + 6, (node.collapsed ? 0 : node.height) + TITLE_HEIGHT + 6, 10);
        ctx.stroke();
    }

    if (scale >= TITLE_DETAIL_SCALE) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(node.x, titleTop, width - 6, TITLE_HEIGHT);
        ctx.clip();
        ctx.beginPath();
        ctx.arc(node.x + 15, titleTop + TITLE_HEIGHT / 2, 5, 0, Math.PI * 2);
        ctx.fillStyle = bypassed ? '#d58ad5' : node.subgraphId ? '#7eb6ff' : '#777777';
        ctx.fill();
        ctx.font = `bold 14px ${FONT_FAMILY}`;
        ctx.fillStyle = isSelected ? COLORS.selectedTitleText : COLORS.titleText;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(node.title, node.x + 28, titleTop + TITLE_HEIGHT / 2 + 1);
        ctx.restore();
    }

    if (!node.collapsed && scale >= FULL_DETAIL_SCALE) {
        ctx.font = `12px ${FONT_FAMILY}`;
        ctx.textBaseline = 'middle';
        layout.rowInputs.forEach((inputIndex) => {
            const input = node.inputs[inputIndex];
            const [x, y] = layout.inputAnchors[inputIndex];
            drawSlot(ctx, x, y, input.type, input.linked);
            ctx.fillStyle = COLORS.slotText;
            ctx.textAlign = 'left';
            ctx.fillText(input.name, x + 10, y);
        });
        node.inputs.forEach((input, inputIndex) => {
            if (!input.widgetName || !input.linked || layout.rowInputs.includes(inputIndex)) return;
            const [x, y] = layout.inputAnchors[inputIndex];
            drawSlot(ctx, x, y, input.type, true);
        });
        node.outputs.forEach((output, outputIndex) => {
            const [x, y] = layout.outputAnchors[outputIndex];
            drawSlot(ctx, x, y, output.type, output.linked);
            ctx.fillStyle = COLORS.slotText;
            ctx.textAlign = 'right';
            ctx.fillText(output.name, x - 10, y);
        });
        if (!skipWidgets) drawWidgets(ctx, node, layout);
    }

    ctx.restore();
};

export interface DrawWorkflowOptions {
    width: number;
    height: number;
    devicePixelRatio: number;
    selectedNodeIds: ReadonlySet<string>;
    /** Box-selection rectangle in world space, drawn while dragging. */
    selectionRect?: WorkflowBounds | null;
    /** Local node ids to keep at full opacity; everything else is dimmed. Null disables dimming. */
    highlightedNodeIds: ReadonlySet<string> | null;
    /** Nodes whose widgets are rendered as selectable DOM text over the canvas, so the canvas skips them. */
    textWidgetNodeIds?: ReadonlySet<string>;
    /** Implicit Use Everywhere connections to show, drawn as glowing translucent links. */
    broadcastLinks?: readonly BroadcastLink[];
}

export const drawWorkflowGraph = (
    ctx: CanvasRenderingContext2D,
    graph: WorkflowCanvasGraph,
    viewport: WorkflowViewport,
    { width, height, devicePixelRatio: dpr, selectedNodeIds, selectionRect, highlightedNodeIds, textWidgetNodeIds, broadcastLinks }: DrawWorkflowOptions
) => {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = COLORS.background;
    ctx.fillRect(0, 0, width, height);
    drawGrid(ctx, viewport, width, height);

    const { scale, offsetX, offsetY } = viewport;
    const isDimmed = (node: WorkflowCanvasNode) => highlightedNodeIds !== null && !highlightedNodeIds.has(node.id);
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * offsetX, dpr * offsetY);
    const visible: WorkflowBounds = {
        minX: -offsetX / scale,
        minY: -offsetY / scale,
        maxX: (width - offsetX) / scale,
        maxY: (height - offsetY) / scale
    };

    for (const group of graph.groups) {
        const box = { minX: group.x, minY: group.y, maxX: group.x + group.width, maxY: group.y + group.height };
        if (!intersects(box, visible)) continue;
        const titleHeight = groupTitleHeight(group);
        ctx.globalAlpha = 0.22;
        ctx.fillStyle = group.color;
        roundRect(ctx, group.x, group.y, group.width, group.height, 6);
        ctx.fill();
        ctx.globalAlpha = 0.45;
        roundRect(ctx, group.x, group.y, group.width, titleHeight, [6, 6, 0, 0]);
        ctx.fill();
        ctx.globalAlpha = 1;
        if (scale * group.fontSize >= 6) {
            ctx.font = `${group.fontSize}px ${FONT_FAMILY}`;
            ctx.fillStyle = '#e8e8e8';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillText(group.title, group.x + 10, group.y + titleHeight / 2 + 1);
        }
    }

    ctx.lineCap = 'round';
    for (const link of graph.links) {
        const origin = graph.nodeById.get(link.originId);
        const target = graph.nodeById.get(link.targetId);
        if (!origin || !target) continue;
        const start = getNodeLayout(origin).outputAnchors[link.originSlot];
        const end = getNodeLayout(target).inputAnchors[link.targetSlot];
        if (!start || !end) continue;
        const dist = Math.max(Math.hypot(end[0] - start[0], end[1] - start[1]) * 0.25, 30);
        const box = {
            minX: Math.min(start[0], end[0]) - dist,
            minY: Math.min(start[1], end[1]),
            maxX: Math.max(start[0], end[0]) + dist,
            maxY: Math.max(start[1], end[1])
        };
        if (!intersects(box, visible)) continue;
        const muted = origin.mode === 2 || target.mode === 2;
        ctx.globalAlpha = (muted ? 0.35 : 0.9) * (isDimmed(origin) || isDimmed(target) ? 0.25 : 1);
        ctx.strokeStyle = linkColor(link.type === '*' ? origin.outputs[link.originSlot]?.type ?? '*' : link.type);
        ctx.lineWidth = Math.max(3, 1.2 / scale);
        ctx.beginPath();
        ctx.moveTo(start[0], start[1]);
        ctx.bezierCurveTo(start[0] + dist, start[1], end[0] - dist, end[1], end[0], end[1]);
        ctx.stroke();
    }
    ctx.globalAlpha = 1;

    if (broadcastLinks && broadcastLinks.length > 0) drawBroadcastLinks(ctx, graph, broadcastLinks, scale, dpr);

    // Array order is draw order; the canvas brings selected nodes to the front, matching hit-testing.
    for (const node of graph.nodes) {
        if (!intersects(nodeBounds(node), visible)) continue;
        const isSelected = selectedNodeIds.has(node.id);
        drawNode(ctx, node, scale, isSelected, !isSelected && isDimmed(node), textWidgetNodeIds?.has(node.id) ?? false);
    }

    if (selectionRect) {
        ctx.globalAlpha = 1;
        ctx.fillStyle = 'rgba(126, 182, 255, 0.08)';
        ctx.strokeStyle = 'rgba(126, 182, 255, 0.9)';
        ctx.lineWidth = 1 / scale;
        ctx.setLineDash([6 / scale, 4 / scale]);
        ctx.beginPath();
        ctx.rect(selectionRect.minX, selectionRect.minY, selectionRect.maxX - selectionRect.minX, selectionRect.maxY - selectionRect.minY);
        ctx.fill();
        ctx.stroke();
        ctx.setLineDash([]);
    }
};
