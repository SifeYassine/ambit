import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseWorkflowCanvasDocument, TITLE_HEIGHT, type WorkflowCanvasNode } from '../workflowCanvasModel';
import {
    drawWorkflowGraph,
    fitViewport,
    getNodeLayout,
    graphBounds,
    groupContents,
    hitTestCanvas,
    hitTestNode,
    minNodeSize,
    nodeOpacity,
    nodesInRect,
    textWidgetNodes,
    MAX_SCALE,
    nodeBounds,
    screenToWorld
} from '../workflowCanvasRenderer';

const node = (overrides: Partial<WorkflowCanvasNode>): WorkflowCanvasNode => ({
    id: '1',
    kind: 'node',
    title: 'Node',
    type: 'Node',
    x: 0,
    y: 0,
    width: 200,
    height: 100,
    collapsed: false,
    mode: 0,
    inputs: [],
    outputs: [],
    widgets: [],
    ...overrides
});

describe('workflow canvas geometry', () => {
    it('includes the title bar above the saved position in node bounds', () => {
        expect(nodeBounds(node({ x: 10, y: 50 }))).toEqual({ minX: 10, minY: 50 - TITLE_HEIGHT, maxX: 210, maxY: 150 });
        expect(nodeBounds(node({ collapsed: true })).maxY).toBe(0);
    });

    it('anchors widget inputs on their widget row and other inputs on slot rows', () => {
        const layout = getNodeLayout(node({
            inputs: [
                { name: 'model', type: 'MODEL', linked: true },
                { name: 'seed', type: 'INT', linked: true, widgetName: 'seed' }
            ],
            outputs: [{ name: 'LATENT', type: 'LATENT', linked: true }],
            widgets: [{ name: 'seed', value: '1', multiline: false }]
        }));

        expect(layout.rowInputs).toEqual([0]);
        expect(layout.inputAnchors[0]).toEqual([10, 14]);
        expect(layout.inputAnchors[1][1]).toBeGreaterThan(layout.inputAnchors[0][1]);
        expect(layout.outputAnchors[0]).toEqual([190, 14]);
    });

    it('hit-tests the top-most node and fits the whole graph into the viewport', () => {
        const document = parseWorkflowCanvasDocument(JSON.stringify({
            nodes: [
                { id: 1, type: 'A', pos: [0, 0], size: [200, 100] },
                { id: 2, type: 'B', pos: [100, 50], size: [200, 100] }
            ],
            links: []
        }))!;
        const graph = document.root;

        expect(hitTestNode(graph, 150, 60)?.id).toBe('2');
        expect(hitTestNode(graph, 20, 10)?.id).toBe('1');
        expect(hitTestNode(graph, 900, 900)).toBeNull();

        const bounds = graphBounds(graph)!;
        const viewport = fitViewport(bounds, 800, 600);
        expect(viewport.scale).toBeLessThanOrEqual(1);
        const [left, top] = screenToWorld(viewport, 0, 0);
        const [right, bottom] = screenToWorld(viewport, 800, 600);
        expect(left).toBeLessThan(bounds.minX);
        expect(top).toBeLessThan(bounds.minY);
        expect(right).toBeGreaterThan(bounds.maxX);
        expect(bottom).toBeGreaterThan(bounds.maxY);
        expect(fitViewport(bounds, 1e6, 1e6, 0, 10).scale).toBe(MAX_SCALE);
    });
});

describe('workflow canvas interaction regions', () => {
    const document = parseWorkflowCanvasDocument(JSON.stringify({
        nodes: [
            { id: 1, type: 'A', pos: [0, 0], size: [200, 100] },
            { id: 2, type: 'B', pos: [600, 0], size: [200, 100] }
        ],
        links: [],
        groups: [
            { title: 'Outer', bounding: [-20, -80, 400, 240], font_size: 24 },
            { title: 'Inner', bounding: [0, 120, 100, 30], font_size: 10 }
        ]
    }))!;
    const graph = document.root;

    it('finds collapse dots, resize corners, node bodies and group chrome at 100% zoom', () => {
        expect(hitTestCanvas(graph, 15, -TITLE_HEIGHT / 2, 1)).toMatchObject({ kind: 'node-collapse' });
        expect(hitTestCanvas(graph, 195, 95, 1)).toMatchObject({ kind: 'node-resize' });
        expect(hitTestCanvas(graph, 100, 50, 1)).toMatchObject({ kind: 'node' });
        expect(hitTestCanvas(graph, 300, -70, 1)).toMatchObject({ kind: 'group-title', group: { title: 'Outer' } });
        expect(hitTestCanvas(graph, 375, 155, 1)).toMatchObject({ kind: 'group-resize', group: { title: 'Outer' } });
        expect(hitTestCanvas(graph, 300, 100, 1)).toEqual({ kind: 'none' });
        expect(hitTestCanvas(graph, 2000, 2000, 1)).toEqual({ kind: 'none' });
    });

    it('collects what a group carries when moved and what a selection box touches', () => {
        const outer = graph.groups[0];
        const contents = groupContents(graph, outer);
        expect(contents.nodes.map((node) => node.id)).toEqual(['1']);
        expect(contents.groups.map((group) => group.title)).toEqual(['Inner']);
        expect(nodesInRect(graph, { minX: 150, minY: 0, maxX: 650, maxY: 10 }).map((node) => node.id)).toEqual(['1', '2']);
    });

    it('keeps resized nodes large enough for their slots and widgets', () => {
        const min = minNodeSize(node({
            inputs: [{ name: 'model', type: 'MODEL', linked: true }],
            widgets: [{ name: 'seed', value: '1', multiline: false }, { name: 'text', value: 'long', multiline: true }]
        }));
        expect(min.width).toBe(100);
        expect(min.height).toBeGreaterThanOrEqual(20 + 24 + 44);
    });
});

describe('nodeOpacity', () => {
    it('fades muted nodes most and bypassed nodes slightly', () => {
        expect(nodeOpacity(node({ mode: 0 }))).toBe(1);
        expect(nodeOpacity(node({ mode: 4 }))).toBeLessThan(1);
        expect(nodeOpacity(node({ mode: 4 }))).toBeGreaterThan(nodeOpacity(node({ mode: 2 })));
    });
});

describe('textWidgetNodes', () => {
    const graph = parseWorkflowCanvasDocument(JSON.stringify({
        nodes: [
            { id: 1, type: 'CLIPTextEncode', pos: [0, 0], size: [300, 120], widgets_values: ['a cat'] },
            { id: 2, type: 'CLIPTextEncode', pos: [400, 0], size: [300, 120], widgets_values: ['a dog'] },
            { id: 3, type: 'CLIPTextEncode', pos: [550, 60], size: [300, 120], widgets_values: ['covers 2'] },
            { id: 4, type: 'CLIPTextEncode', pos: [0, 400], size: [300, 120], widgets_values: ['folded'], flags: { collapsed: true } },
            { id: 5, type: 'VAEDecode', pos: [0, 700], size: [300, 120] },
            { id: 6, type: 'CLIPTextEncode', pos: [5000, 0], size: [300, 120], widgets_values: ['off screen'] }
        ],
        links: []
    }))!.root;
    const ids = (scale: number) => textWidgetNodes(graph, { scale, offsetX: 0, offsetY: 40 }, 1000, 1000).map((node) => node.id);

    it('keeps visible, expanded, uncovered nodes with widgets at readable zoom', () => {
        expect(ids(1)).toEqual(['1', '3']);
        expect(ids(0.4)).toEqual([]);
    });
});

describe('drawWorkflowGraph on real ComfyUI workflows', () => {
    const fixtureRoot = resolve(process.cwd(), 'src-tauri/src/metadata/comfyui/tests/fixtures');
    const fixtures = ['official_catalog', 'real_world'].flatMap((dir) =>
        readdirSync(resolve(fixtureRoot, dir))
            .filter((name) => name.endsWith('.chunks.json'))
            .map((name) => resolve(fixtureRoot, dir, name))
    );

    /** Records draw calls; measureText approximates a 7px-per-character font. */
    const recordingContext = () => {
        const calls: string[] = [];
        const ctx = new Proxy({} as Record<string | symbol, unknown>, {
            get(target, key) {
                if (key in target) return target[key];
                if (key === 'measureText') return (text: string) => ({ width: text.length * 7 });
                return () => {
                    calls.push(String(key));
                };
            },
            set(target, key, value) {
                target[key] = value;
                return true;
            }
        });
        return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
    };

    it('finds fixtures to exercise', () => {
        expect(fixtures.length).toBeGreaterThan(10);
    });

    it.each(fixtures)('renders %s at overview and detail zoom', (file) => {
        const chunks = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
        const workflow = typeof chunks.workflow === 'string' ? chunks.workflow : undefined;
        const prompt = typeof chunks.prompt === 'string' ? chunks.prompt : undefined;
        const document = parseWorkflowCanvasDocument(workflow, prompt);
        if (!document) return;

        for (const graph of [document.root, ...document.subgraphs.values()]) {
            const bounds = graphBounds(graph);
            if (!bounds) continue;
            for (const viewport of [fitViewport(bounds, 1600, 900), { ...fitViewport(bounds, 1600, 900), scale: 1.2 }]) {
                const { ctx, calls } = recordingContext();
                drawWorkflowGraph(ctx, graph, viewport, {
                    width: 1600,
                    height: 900,
                    devicePixelRatio: 1,
                    selectedNodeIds: new Set(graph.nodes.slice(0, 2).map((node) => node.id)),
                    selectionRect: { minX: bounds.minX, minY: bounds.minY, maxX: bounds.minX + 100, maxY: bounds.minY + 100 },
                    highlightedNodeIds: null
                });
                expect(calls).toContain('fillRect');
            }
        }
    });
});
