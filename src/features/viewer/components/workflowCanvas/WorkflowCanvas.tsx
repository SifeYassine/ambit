import * as React from 'react';
import { ChevronRight, Maximize, RotateCcw, Workflow, ZoomIn, ZoomOut } from 'lucide-react';
import { TooltipButton } from '../../../../components/ui/InfoTooltip';
import {
    applyLayoutEdits,
    EMPTY_LAYOUT_EDITS,
    findBroadcastLinks,
    hasLayoutChanges,
    locateCanvasNode,
    resolveGraphAtPath,
    toDisplayNodeId,
    type GraphLayoutEdits,
    type GroupLayoutEdit,
    type NodeLayoutEdit,
    type WorkflowCanvasDocument,
    type WorkflowCanvasNode
} from './workflowCanvasModel';
import {
    clampScale,
    drawWorkflowGraph,
    fitViewport,
    focusViewport,
    graphBounds,
    groupContents,
    hitTestCanvas,
    minNodeSize,
    nodeOpacity,
    nodesInRect,
    screenToWorld,
    textWidgetNodes,
    type WorkflowBounds,
    type WorkflowCanvasHit,
    type WorkflowViewport
} from './workflowCanvasRenderer';
import { WorkflowWidgetText } from './WorkflowWidgetText';

export interface WorkflowCanvasFocusRequest {
    /** Backend display-node id ("outer:inner" for nodes inside subgraphs). */
    nodeId: string;
    requestId: number;
}

interface WorkflowCanvasProps {
    workflowDocument: WorkflowCanvasDocument;
    selectedNodeId: string | null;
    focusRequest: WorkflowCanvasFocusRequest | null;
    /** Display-node ids to emphasize (search matches or the selected branch); null shows all normally. */
    highlightedNodeIds: ReadonlySet<string> | null;
    onSelectNode: (displayNodeId: string | null) => void;
}

interface DragBase {
    pointerId: number;
    startX: number;
    startY: number;
    moved: boolean;
    scale: number;
}

type MovedNode = { id: string; x: number; y: number };
type MovedGroup = GroupLayoutEdit & { id: string };

type DragState = DragBase & (
    | { kind: 'pan'; origin: WorkflowViewport }
    /** Node drag; a release without movement is resolved as a click. */
    | { kind: 'move'; clickedId: string; toggleSelection: boolean; collapseOnClick: boolean; nodes: MovedNode[] }
    | { kind: 'group'; nodes: MovedNode[]; groups: MovedGroup[] }
    | { kind: 'resize-node'; nodeId: string; width: number; height: number; minWidth: number; minHeight: number }
    | { kind: 'resize-group'; group: MovedGroup }
    | { kind: 'box'; originX: number; originY: number; additive: boolean }
);

const cursorForHit = (hit: WorkflowCanvasHit) => {
    switch (hit.kind) {
        case 'node-resize':
        case 'group-resize':
            return 'nwse-resize';
        case 'node':
        case 'group-title':
            return 'move';
        case 'node-collapse':
            return 'pointer';
        default:
            return 'grab';
    }
};

const CLICK_SLOP_PX = 4;
const BUTTON_ZOOM_STEP = 1.25;

export const WorkflowCanvas: React.FC<WorkflowCanvasProps> = ({ workflowDocument, selectedNodeId, focusRequest, highlightedNodeIds, onSelectNode }) => {
    const containerRef = React.useRef<HTMLDivElement>(null);
    const canvasRef = React.useRef<HTMLCanvasElement>(null);
    const [size, setSize] = React.useState({ width: 0, height: 0 });
    const [requestedPath, setRequestedPath] = React.useState<string[]>([]);
    const [viewport, setViewport] = React.useState<WorkflowViewport | null>(null);
    const dragRef = React.useRef<DragState | null>(null);
    // Session-only layout edits keyed by graph path. Never written back to the workflow.
    const [layoutEdits, setLayoutEdits] = React.useState<ReadonlyMap<string, GraphLayoutEdits>>(() => new Map());
    // Additional selected nodes in the current graph; the primary selection comes from `selectedNodeId`.
    const [extraSelection, setExtraSelection] = React.useState<ReadonlySet<string>>(() => new Set());
    const [selectionRect, setSelectionRect] = React.useState<WorkflowBounds | null>(null);
    const handledFocusRef = React.useRef<number | null>(null);

    const { graph: savedGraph, path } = React.useMemo(
        () => resolveGraphAtPath(workflowDocument, requestedPath),
        [workflowDocument, requestedPath]
    );
    const pathKey = path.join(':');
    const graph = React.useMemo(
        () => applyLayoutEdits(savedGraph, layoutEdits.get(pathKey)),
        [layoutEdits, pathKey, savedGraph]
    );
    const localSelectedId = React.useMemo(() => {
        if (!selectedNodeId) return null;
        const located = locateCanvasNode(workflowDocument, selectedNodeId);
        return located && located.path.join(':') === pathKey ? located.nodeId : null;
    }, [workflowDocument, pathKey, selectedNodeId]);
    const selectedIds = React.useMemo(() => {
        const ids = new Set(extraSelection);
        if (localSelectedId) ids.add(localSelectedId);
        return ids;
    }, [extraSelection, localSelectedId]);

    const updateEdits = React.useCallback((update: (edits: GraphLayoutEdits) => GraphLayoutEdits) => {
        setLayoutEdits((current) => {
            const next = new Map(current);
            next.set(pathKey, update(current.get(pathKey) ?? EMPTY_LAYOUT_EDITS));
            return next;
        });
    }, [pathKey]);

    const editNodes = React.useCallback((changes: ReadonlyArray<readonly [string, NodeLayoutEdit]>) => {
        updateEdits((edits) => {
            const nodes = new Map(edits.nodes);
            for (const [id, change] of changes) nodes.set(id, { ...nodes.get(id), ...change });
            return { ...edits, nodes };
        });
    }, [updateEdits]);

    const editGroups = React.useCallback((changes: readonly MovedGroup[]) => {
        updateEdits((edits) => {
            const groups = new Map(edits.groups);
            for (const { id, ...change } of changes) groups.set(id, change);
            return { ...edits, groups };
        });
    }, [updateEdits]);

    // Like ComfyUI, the active node draws (and hit-tests) on top of everything else.
    React.useEffect(() => {
        if (!localSelectedId) return;
        updateEdits((edits) => edits.order[edits.order.length - 1] === localSelectedId
            ? edits
            : { ...edits, order: [...edits.order.filter((id) => id !== localSelectedId), localSelectedId] });
    }, [localSelectedId, updateEdits]);

    React.useEffect(() => {
        setExtraSelection(new Set());
    }, [pathKey, workflowDocument]);

    // A subgraph instance stays highlighted when any node inside it is highlighted.
    const localHighlightedIds = React.useMemo(() => {
        if (!highlightedNodeIds) return null;
        const prefix = pathKey ? `${pathKey}:` : '';
        const local = new Set<string>();
        for (const id of highlightedNodeIds) {
            if (!id.startsWith(prefix)) continue;
            local.add(id.slice(prefix.length).split(':')[0]);
        }
        return local;
    }, [highlightedNodeIds, pathKey]);

    React.useLayoutEffect(() => {
        const element = containerRef.current;
        if (!element) return;
        const measure = () => setSize({ width: element.clientWidth, height: element.clientHeight });
        measure();
        if (typeof ResizeObserver === 'undefined') return;
        const observer = new ResizeObserver(measure);
        observer.observe(element);
        return () => observer.disconnect();
    }, []);

    const fitToView = React.useCallback(() => {
        const bounds = graphBounds(graph);
        if (!bounds || size.width === 0 || size.height === 0) return;
        setViewport(fitViewport(bounds, size.width, size.height));
    }, [graph, size.height, size.width]);

    // Fit whenever a different graph is shown (new workflowDocument or entering/leaving a subgraph).
    // Tracked by the saved graph so moving nodes does not refit the view.
    const fittedGraphRef = React.useRef<typeof savedGraph | null>(null);
    React.useEffect(() => {
        if (size.width === 0 || size.height === 0) return;
        if (fittedGraphRef.current === savedGraph) return;
        if (focusRequest && handledFocusRef.current !== focusRequest.requestId) return;
        fittedGraphRef.current = savedGraph;
        fitToView();
    }, [fitToView, focusRequest, savedGraph, size.height, size.width]);

    React.useEffect(() => {
        setRequestedPath([]);
        setLayoutEdits(new Map());
    }, [workflowDocument]);

    React.useEffect(() => {
        if (!focusRequest || handledFocusRef.current === focusRequest.requestId) return;
        if (size.width === 0 || size.height === 0) return;
        const located = locateCanvasNode(workflowDocument, focusRequest.nodeId);
        if (!located) {
            handledFocusRef.current = focusRequest.requestId;
            if (fittedGraphRef.current !== savedGraph) {
                fittedGraphRef.current = savedGraph;
                fitToView();
            }
            return;
        }
        if (located.path.join(':') !== pathKey) {
            setRequestedPath(located.path);
            return;
        }
        const node = graph.nodeById.get(located.nodeId);
        handledFocusRef.current = focusRequest.requestId;
        fittedGraphRef.current = savedGraph;
        if (node) setViewport((current) => focusViewport(node, size.width, size.height, current?.scale ?? 1));
    }, [workflowDocument, fitToView, focusRequest, graph, pathKey, savedGraph, size.height, size.width]);

    // Widget values on screen are real text fields (selectable, Ctrl+A/Ctrl+C). Sorted by id rather
    // than draw order so bringing a node to the front never moves a focused field in the DOM.
    const textNodes = React.useMemo(
        () => viewport
            ? textWidgetNodes(graph, viewport, size.width, size.height).sort((a, b) => a.id.localeCompare(b.id))
            : [],
        [graph, size.height, size.width, viewport]
    );
    const textWidgetNodeIds = React.useMemo(() => new Set(textNodes.map((node) => node.id)), [textNodes]);
    const opacityFor = (node: WorkflowCanvasNode) =>
        nodeOpacity(node) * (!selectedIds.has(node.id) && localHighlightedIds && !localHighlightedIds.has(node.id) ? 0.25 : 1);
    // Selecting a Use Everywhere emitter reveals the inputs it feeds, as the extension does in ComfyUI.
    const broadcastLinks = React.useMemo(
        () => (localSelectedId ? findBroadcastLinks(graph, localSelectedId) : []),
        [graph, localSelectedId]
    );

    React.useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas || !viewport || size.width === 0 || size.height === 0) return;
        const dpr = window.devicePixelRatio || 1;
        const pixelWidth = Math.round(size.width * dpr);
        const pixelHeight = Math.round(size.height * dpr);
        if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
        if (canvas.height !== pixelHeight) canvas.height = pixelHeight;

        const frame = requestAnimationFrame(() => {
            const ctx = canvas.getContext('2d');
            if (!ctx) return;
            drawWorkflowGraph(ctx, graph, viewport, {
                width: size.width,
                height: size.height,
                devicePixelRatio: dpr,
                selectedNodeIds: selectedIds,
                selectionRect,
                highlightedNodeIds: localHighlightedIds,
                textWidgetNodeIds,
                broadcastLinks
            });
        });
        return () => cancelAnimationFrame(frame);
    }, [broadcastLinks, graph, localHighlightedIds, selectedIds, selectionRect, size.height, size.width, textWidgetNodeIds, viewport]);

    const zoomAt = React.useCallback((factor: number, screenX: number, screenY: number) => {
        setViewport((current) => {
            if (!current) return current;
            const scale = clampScale(current.scale * factor);
            const [worldX, worldY] = screenToWorld(current, screenX, screenY);
            return { scale, offsetX: screenX - worldX * scale, offsetY: screenY - worldY * scale };
        });
    }, []);

    // Native listener: React's wheel handler is passive, so it cannot stop the page from scrolling.
    // Attached to the container so the wheel also zooms over widget text; a scrollable prompt box scrolls instead.
    React.useEffect(() => {
        const element = containerRef.current;
        if (!element) return;
        const onWheel = (event: WheelEvent) => {
            const target = event.target;
            if (target instanceof HTMLTextAreaElement && target.scrollHeight > target.clientHeight) return;
            event.preventDefault();
            const rect = element.getBoundingClientRect();
            const delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
            zoomAt(Math.exp(-delta * 0.0015), event.clientX - rect.left, event.clientY - rect.top);
        };
        element.addEventListener('wheel', onWheel, { passive: false });
        return () => element.removeEventListener('wheel', onWheel);
    }, [zoomAt]);

    const pointToWorld = (event: React.PointerEvent | React.MouseEvent): [number, number] | null => {
        const canvas = canvasRef.current;
        if (!canvas || !viewport) return null;
        const rect = canvas.getBoundingClientRect();
        return screenToWorld(viewport, event.clientX - rect.left, event.clientY - rect.top);
    };

    const selectOnly = (nodeId: string | null) => {
        setExtraSelection(new Set());
        onSelectNode(nodeId === null ? null : toDisplayNodeId(path, nodeId));
    };
    const selectOnlyRef = React.useRef(selectOnly);
    selectOnlyRef.current = selectOnly;
    const handleWidgetPointerDown = React.useCallback((nodeId: string) => {
        if (!selectedIds.has(nodeId)) selectOnlyRef.current(nodeId);
    }, [selectedIds]);

    /** Ctrl/Shift+click: add a node to the selection, or remove it if already selected. */
    const toggleSelected = (nodeId: string) => {
        if (selectedIds.has(nodeId)) {
            const remaining = [...selectedIds].filter((id) => id !== nodeId);
            const primary = nodeId === localSelectedId ? remaining[remaining.length - 1] ?? null : localSelectedId;
            setExtraSelection(new Set(remaining.filter((id) => id !== primary)));
            onSelectNode(primary === null ? null : toDisplayNodeId(path, primary));
            return;
        }
        setExtraSelection(new Set(selectedIds));
        onSelectNode(toDisplayNodeId(path, nodeId));
    };

    const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
        if (event.button !== 0 && event.button !== 1) return;
        if (!viewport) return;
        event.currentTarget.setPointerCapture?.(event.pointerId);
        const base = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, moved: false, scale: viewport.scale };
        const point = event.button === 0 ? pointToWorld(event) : null;
        const hit: WorkflowCanvasHit = point ? hitTestCanvas(graph, point[0], point[1], viewport.scale) : { kind: 'none' };
        const modifier = event.ctrlKey || event.metaKey || event.shiftKey;

        switch (hit.kind) {
            case 'node':
            case 'node-collapse': {
                const { node } = hit;
                const movesSelection = selectedIds.has(node.id) && selectedIds.size > 1;
                const moving = movesSelection ? graph.nodes.filter((candidate) => selectedIds.has(candidate.id)) : [node];
                dragRef.current = {
                    ...base,
                    kind: 'move',
                    clickedId: node.id,
                    toggleSelection: modifier,
                    collapseOnClick: hit.kind === 'node-collapse',
                    nodes: moving.map(({ id, x, y }) => ({ id, x, y }))
                };
                return;
            }
            case 'node-resize': {
                const min = minNodeSize(hit.node);
                dragRef.current = {
                    ...base,
                    kind: 'resize-node',
                    nodeId: hit.node.id,
                    width: hit.node.width,
                    height: hit.node.height,
                    minWidth: min.width,
                    minHeight: min.height
                };
                return;
            }
            case 'group-title': {
                const contents = groupContents(graph, hit.group);
                dragRef.current = {
                    ...base,
                    kind: 'group',
                    nodes: contents.nodes.map(({ id, x, y }) => ({ id, x, y })),
                    groups: [hit.group, ...contents.groups].map(({ id, x, y, width, height }) => ({ id, x, y, width, height }))
                };
                return;
            }
            case 'group-resize': {
                const { id, x, y, width, height } = hit.group;
                dragRef.current = { ...base, kind: 'resize-group', group: { id, x, y, width, height } };
                return;
            }
            default:
                dragRef.current = point && modifier
                    ? { ...base, kind: 'box', originX: point[0], originY: point[1], additive: event.shiftKey }
                    : { ...base, kind: 'pan', origin: viewport };
        }
    };

    const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
        const drag = dragRef.current;
        if (!drag || drag.pointerId !== event.pointerId) {
            const point = pointToWorld(event);
            if (point && viewport) event.currentTarget.style.cursor = cursorForHit(hitTestCanvas(graph, point[0], point[1], viewport.scale));
            return;
        }
        const dx = event.clientX - drag.startX;
        const dy = event.clientY - drag.startY;
        if (!drag.moved && Math.hypot(dx, dy) < CLICK_SLOP_PX) return;
        const firstMove = !drag.moved;
        drag.moved = true;
        const worldDx = dx / drag.scale;
        const worldDy = dy / drag.scale;

        switch (drag.kind) {
            case 'pan':
                event.currentTarget.style.cursor = 'grabbing';
                setViewport({ ...drag.origin, offsetX: drag.origin.offsetX + dx, offsetY: drag.origin.offsetY + dy });
                return;
            case 'move':
                // Dragging an unselected node selects it, as in ComfyUI.
                if (firstMove && !selectedIds.has(drag.clickedId) && graph.nodeById.get(drag.clickedId)?.kind === 'node') {
                    selectOnly(drag.clickedId);
                }
                editNodes(drag.nodes.map(({ id, x, y }) => [id, { x: x + worldDx, y: y + worldDy }] as const));
                return;
            case 'group':
                editNodes(drag.nodes.map(({ id, x, y }) => [id, { x: x + worldDx, y: y + worldDy }] as const));
                editGroups(drag.groups.map((group) => ({ ...group, x: group.x + worldDx, y: group.y + worldDy })));
                return;
            case 'resize-node':
                editNodes([[drag.nodeId, {
                    width: Math.max(drag.minWidth, drag.width + worldDx),
                    height: Math.max(drag.minHeight, drag.height + worldDy)
                }]]);
                return;
            case 'resize-group':
                editGroups([{
                    ...drag.group,
                    width: Math.max(140, drag.group.width + worldDx),
                    height: Math.max(80, drag.group.height + worldDy)
                }]);
                return;
            case 'box': {
                const point = pointToWorld(event);
                if (!point) return;
                setSelectionRect({
                    minX: Math.min(drag.originX, point[0]),
                    minY: Math.min(drag.originY, point[1]),
                    maxX: Math.max(drag.originX, point[0]),
                    maxY: Math.max(drag.originY, point[1])
                });
            }
        }
    };

    const handlePointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
        const drag = dragRef.current;
        if (!drag || drag.pointerId !== event.pointerId) return;
        dragRef.current = null;
        event.currentTarget.releasePointerCapture?.(event.pointerId);
        if (drag.kind === 'pan') event.currentTarget.style.cursor = 'grab';

        if (drag.kind === 'box') {
            const rect = selectionRect;
            setSelectionRect(null);
            if (!drag.moved || !rect) return;
            const boxed = nodesInRect(graph, rect).filter((node) => node.kind === 'node').map((node) => node.id);
            const ids = drag.additive ? [...new Set([...selectedIds, ...boxed])] : boxed;
            const primary = localSelectedId && ids.includes(localSelectedId) ? localSelectedId : ids[ids.length - 1] ?? null;
            setExtraSelection(new Set(ids.filter((id) => id !== primary)));
            onSelectNode(primary === null ? null : toDisplayNodeId(path, primary));
            return;
        }
        if (drag.moved || event.button !== 0) return;

        if (drag.kind === 'move') {
            const node = graph.nodeById.get(drag.clickedId);
            if (!node) return;
            if (drag.collapseOnClick) {
                editNodes([[node.id, { collapsed: !node.collapsed }]]);
                return;
            }
            if (node.kind !== 'node') return;
            if (drag.toggleSelection) toggleSelected(node.id);
            else selectOnly(node.id);
            return;
        }
        if (drag.kind === 'pan') selectOnly(null);
    };

    const handleDoubleClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
        const point = pointToWorld(event);
        if (!point || !viewport) return;
        const hit = hitTestCanvas(graph, point[0], point[1], viewport.scale);
        if (hit.kind === 'node' && hit.node.subgraphId && workflowDocument.subgraphs.has(hit.node.subgraphId)) {
            setRequestedPath([...path, hit.node.id]);
        }
    };

    const zoomFromCenter = (factor: number) => zoomAt(factor, size.width / 2, size.height / 2);

    const breadcrumbs = path.map((nodeId, index) => {
        const parent = resolveGraphAtPath(workflowDocument, path.slice(0, index)).graph;
        const node = parent.nodeById.get(nodeId);
        return { label: node?.title ?? nodeId, path: path.slice(0, index + 1) };
    });
    const hasSubgraphs = workflowDocument.subgraphs.size > 0;
    const hasMovedNodes = [...layoutEdits.values()].some(hasLayoutChanges);

    return (
        <div ref={containerRef} className="absolute inset-0 select-none overflow-hidden bg-[#1e1e1e]">
            <canvas
                ref={canvasRef}
                role="img"
                aria-label={`Workflow graph: ${graph.name}, ${graph.nodes.length} nodes`}
                className="block h-full w-full touch-none"
                style={{ width: size.width || '100%', height: size.height || '100%', cursor: 'grab' }}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={() => {
                    dragRef.current = null;
                    setSelectionRect(null);
                }}
                onDoubleClick={handleDoubleClick}
            />

            {viewport && textNodes.length > 0 && (
                <WorkflowWidgetText
                    nodes={textNodes}
                    viewport={viewport}
                    opacityFor={opacityFor}
                    onWidgetPointerDown={handleWidgetPointerDown}
                />
            )}

            <div className="absolute bottom-8 left-1/2 z-20 flex max-w-[calc(100%-2rem)] -translate-x-1/2 items-center gap-2 rounded-full border border-white/10 bg-black/80 px-4 py-2 shadow-2xl backdrop-blur-xl">
                {(hasSubgraphs || !workflowDocument.hasSavedLayout) && (
                    <>
                        <nav aria-label="Workflow graph location" className="flex min-w-0 items-center gap-1 text-xs">
                            <button
                                type="button"
                                onClick={() => setRequestedPath([])}
                                disabled={path.length === 0}
                                title={hasSubgraphs ? 'Double-click a subgraph node to open it' : undefined}
                                className="flex shrink-0 items-center gap-1.5 rounded-full px-2 py-1 font-semibold text-gray-300 enabled:hover:bg-white/10 enabled:hover:text-white disabled:cursor-default"
                            >
                                <Workflow className="h-3.5 w-3.5 text-sage-400" />
                                Workflow
                            </button>
                            {breadcrumbs.map((crumb, index) => (
                                <React.Fragment key={crumb.path.join(':')}>
                                    <ChevronRight className="h-3 w-3 shrink-0 text-gray-500" />
                                    <button
                                        type="button"
                                        onClick={() => setRequestedPath(crumb.path)}
                                        disabled={index === breadcrumbs.length - 1}
                                        className="max-w-48 truncate rounded-full px-2 py-1 font-semibold text-gray-300 enabled:hover:bg-white/10 enabled:hover:text-white disabled:cursor-default disabled:text-white"
                                    >
                                        {crumb.label}
                                    </button>
                                </React.Fragment>
                            ))}
                            {!workflowDocument.hasSavedLayout && (
                                <span
                                    title="This workflow has no saved node positions, so Ambit arranged the nodes automatically."
                                    className="shrink-0 rounded-full border border-white/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-gray-400"
                                >
                                    Auto layout
                                </span>
                            )}
                        </nav>
                        <div className="mx-1 h-4 w-px shrink-0 bg-white/10" />
                    </>
                )}
                <TooltipButton label="Zoom Out" content="Zoom Out" onClick={() => zoomFromCenter(1 / BUTTON_ZOOM_STEP)} className="shrink-0 rounded-full p-1.5 text-gray-400 hover:bg-white/10 hover:text-white">
                    <ZoomOut className="h-4 w-4" />
                </TooltipButton>
                <span className="min-w-[4ch] shrink-0 text-center font-mono text-xs text-sage-400">
                    {Math.round((viewport?.scale ?? 1) * 100)}%
                </span>
                <TooltipButton label="Zoom In" content="Zoom In" onClick={() => zoomFromCenter(BUTTON_ZOOM_STEP)} className="shrink-0 rounded-full p-1.5 text-gray-400 hover:bg-white/10 hover:text-white">
                    <ZoomIn className="h-4 w-4" />
                </TooltipButton>
                <div className="mx-1 h-4 w-px shrink-0 bg-white/10" />
                <TooltipButton label="Fit to View" content="Fit to View" onClick={fitToView} className="shrink-0 rounded-full p-1.5 text-gray-400 hover:bg-white/10 hover:text-white">
                    <Maximize className="h-4 w-4" />
                </TooltipButton>
                {hasMovedNodes && (
                    <TooltipButton
                        label="Reset Layout"
                        content="Reset Layout: restore saved positions, sizes, collapsed states and groups"
                        onClick={() => setLayoutEdits(new Map())}
                        className="shrink-0 rounded-full p-1.5 text-gray-400 hover:bg-white/10 hover:text-white"
                    >
                        <RotateCcw className="h-4 w-4" />
                    </TooltipButton>
                )}
            </div>
        </div>
    );
};
