import * as React from 'react';
import {
    locateCanvasNode,
    resolveGraphAtPath,
    type WorkflowCanvasDocument,
    type WorkflowCanvasGraph,
    type WorkflowCanvasNode
} from './workflowCanvasModel';
import {
    drawWorkflowGraph,
    nodeBounds,
    nodeOpacity,
    textWidgetNodes,
    type WorkflowViewport
} from './workflowCanvasRenderer';
import { WorkflowWidgetText } from './WorkflowWidgetText';

interface WorkflowNodePreviewProps {
    workflowDocument: WorkflowCanvasDocument;
    /** Backend display-node id ("outer:inner" for nodes inside subgraphs). */
    nodeId: string;
}

// Just enough margin to keep the node's anti-aliased edges from being clipped.
const PADDING = 1;
const NO_SELECTION: ReadonlySet<string> = new Set();
const ignorePointerDown = () => undefined;

/** The selected node alone, expanded, as a graph the canvas renderer can draw unchanged. */
const isolateNode = (workflowDocument: WorkflowCanvasDocument, nodeId: string): WorkflowCanvasGraph | null => {
    const located = locateCanvasNode(workflowDocument, nodeId);
    if (!located) return null;
    const { graph } = resolveGraphAtPath(workflowDocument, located.path);
    const node = graph.nodeById.get(located.nodeId);
    if (!node) return null;
    const shown: WorkflowCanvasNode = { ...node, collapsed: false };
    return { ...graph, nodes: [shown], links: [], groups: [], nodeById: new Map([[shown.id, shown]]), recordedBroadcasts: [] };
};

/**
 * The selected workflow node drawn exactly as the graph draws it (same renderer, same text
 * widgets) on a transparent canvas, so it sits directly on the sidebar, scaled to the sidebar width.
 */
export const WorkflowNodePreview: React.FC<WorkflowNodePreviewProps> = ({ workflowDocument, nodeId }) => {
    const containerRef = React.useRef<HTMLDivElement>(null);
    const canvasRef = React.useRef<HTMLCanvasElement>(null);
    const [width, setWidth] = React.useState(0);

    React.useLayoutEffect(() => {
        const element = containerRef.current;
        if (!element) return;
        const measure = () => setWidth(element.clientWidth);
        measure();
        if (typeof ResizeObserver === 'undefined') return;
        const observer = new ResizeObserver(measure);
        observer.observe(element);
        return () => observer.disconnect();
    }, []);

    const graph = React.useMemo(() => isolateNode(workflowDocument, nodeId), [workflowDocument, nodeId]);
    const node = graph?.nodes[0];

    // Fit the node's width (never enlarging it) and size the preview to its height.
    const layout = React.useMemo(() => {
        if (!node || width === 0) return null;
        const bounds = nodeBounds(node);
        const nodeWidth = bounds.maxX - bounds.minX;
        const nodeHeight = bounds.maxY - bounds.minY;
        const scale = Math.min(1, (width - PADDING * 2) / nodeWidth);
        const viewport: WorkflowViewport = {
            scale,
            offsetX: (width - nodeWidth * scale) / 2 - bounds.minX * scale,
            offsetY: PADDING - bounds.minY * scale
        };
        return { viewport, height: Math.ceil(nodeHeight * scale + PADDING * 2) };
    }, [node, width]);

    const textNodes = React.useMemo(
        () => (graph && layout ? textWidgetNodes(graph, layout.viewport, width, layout.height) : []),
        [graph, layout, width]
    );
    const textNodeIds = React.useMemo(() => new Set(textNodes.map(item => item.id)), [textNodes]);

    React.useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas || !graph || !layout) return;
        const dpr = window.devicePixelRatio || 1;
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(layout.height * dpr);
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        drawWorkflowGraph(ctx, graph, layout.viewport, {
            width,
            height: layout.height,
            devicePixelRatio: dpr,
            selectedNodeIds: NO_SELECTION,
            highlightedNodeIds: null,
            textWidgetNodeIds: textNodeIds,
            plain: true,
        });
    }, [graph, layout, textNodeIds, width]);

    if (!node) return null;

    return (
        <div
            ref={containerRef}
            className="relative mt-12 w-full overflow-hidden"
            style={{ height: layout?.height ?? 120 }}
        >
            <canvas
                ref={canvasRef}
                role="img"
                aria-label={`Preview of node ${node.title}`}
                className="block h-full w-full"
            />
            {layout && textNodes.length > 0 && (
                <WorkflowWidgetText
                    nodes={textNodes}
                    viewport={layout.viewport}
                    opacityFor={nodeOpacity}
                    onWidgetPointerDown={ignorePointerDown}
                />
            )}
        </div>
    );
};
