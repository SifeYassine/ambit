import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkflowCanvas } from '../WorkflowCanvas';
import { parseWorkflowCanvasDocument, type WorkflowCanvasGraph } from '../workflowCanvasModel';
import { drawWorkflowGraph, fitViewport, graphBounds, type DrawWorkflowOptions } from '../workflowCanvasRenderer';

vi.mock('../workflowCanvasRenderer', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../workflowCanvasRenderer')>()),
    drawWorkflowGraph: vi.fn()
}));

const WIDTH = 800;
const HEIGHT = 600;

const workflowDocument = parseWorkflowCanvasDocument(JSON.stringify({
    nodes: [
        { id: 1, type: 'CheckpointLoaderSimple', pos: [0, 0], size: [200, 100], widgets_values: ['sdxl_base_1.0.safetensors'] },
        { id: 2, type: 'KSampler', pos: [400, 0], size: [200, 100] }
    ],
    links: [],
    groups: [{ title: 'Models', bounding: [-20, -80, 700, 240], font_size: 24 }]
}))!;
const viewport = fitViewport(graphBounds(workflowDocument.root)!, WIDTH, HEIGHT);
type Point = { clientX: number; clientY: number };
const at = (x: number, y: number): Point => ({
    clientX: x * viewport.scale + viewport.offsetX,
    clientY: y * viewport.scale + viewport.offsetY
});
/** World-space offset expressed as a screen point relative to another world point. */
const offset = (x: number, y: number, dx: number, dy: number) => at(x + dx, y + dy);

/** Screen-to-world conversion leaves float noise, so compare numbers with tolerance. */
const near = (expected: Record<string, unknown>) => Object.fromEntries(
    Object.entries(expected).map(([key, value]) => [key, typeof value === 'number' ? expect.closeTo(value, 6) : value])
);

const lastDraw = () => {
    const call = vi.mocked(drawWorkflowGraph).mock.lastCall!;
    return { graph: call[1] as WorkflowCanvasGraph, options: call[3] as DrawWorkflowOptions };
};

const Harness: React.FC<{ onSelectNode: (id: string | null) => void }> = ({ onSelectNode }) => {
    const [selected, setSelected] = React.useState<string | null>(null);
    return (
        <WorkflowCanvas
            workflowDocument={workflowDocument}
            selectedNodeId={selected}
            focusRequest={null}
            highlightedNodeIds={null}
            onSelectNode={(id) => {
                setSelected(id);
                onSelectNode(id);
            }}
        />
    );
};

describe('WorkflowCanvas editing gestures', () => {
    let pointerId = 0;

    beforeEach(() => {
        vi.mocked(drawWorkflowGraph).mockClear();
        vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(WIDTH);
        vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(HEIGHT);
        vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
            { left: 0, top: 0, right: WIDTH, bottom: HEIGHT, width: WIDTH, height: HEIGHT, x: 0, y: 0, toJSON: () => ({}) }
        );
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    const renderCanvas = () => {
        const onSelectNode = vi.fn();
        render(<Harness onSelectNode={onSelectNode} />);
        return { onSelectNode, canvas: screen.getByRole('img', { name: /Workflow graph/ }) };
    };

    const drag = (canvas: HTMLElement, from: Point, to: Point, modifiers: { ctrlKey?: boolean; shiftKey?: boolean } = {}) => {
        pointerId += 1;
        fireEvent.pointerDown(canvas, { pointerId, button: 0, ...modifiers, ...from });
        fireEvent.pointerMove(canvas, { pointerId, ...modifiers, ...to });
        fireEvent.pointerUp(canvas, { pointerId, button: 0, ...modifiers, ...to });
    };

    const click = (canvas: HTMLElement, point: Point, modifiers: { ctrlKey?: boolean; shiftKey?: boolean } = {}) =>
        drag(canvas, point, point, modifiers);

    const nodeAfterDraw = async (id: string) => {
        await waitFor(() => expect(drawWorkflowGraph).toHaveBeenCalled());
        return lastDraw().graph.nodeById.get(id)!;
    };

    it('moves a dragged node, hit-tests it at its new position, and resets to the saved layout', async () => {
        const { onSelectNode, canvas } = renderCanvas();
        expect(screen.queryByRole('button', { name: 'Reset Layout' })).toBeNull();

        drag(canvas, at(100, 50), at(100, 350));
        expect(onSelectNode).toHaveBeenLastCalledWith('1');
        await waitFor(async () => expect(await nodeAfterDraw('1')).toMatchObject(near({ x: 0, y: 300 })));

        click(canvas, at(100, 50));
        expect(onSelectNode).toHaveBeenLastCalledWith(null);
        click(canvas, at(100, 350));
        expect(onSelectNode).toHaveBeenLastCalledWith('1');

        fireEvent.click(screen.getByRole('button', { name: 'Reset Layout' }));
        expect(screen.queryByRole('button', { name: 'Reset Layout' })).toBeNull();
        await waitFor(async () => expect(await nodeAfterDraw('1')).toMatchObject(near({ x: 0, y: 0 })));
    });

    it('resizes a node from its bottom-right corner and clamps to its minimum size', async () => {
        const { canvas } = renderCanvas();

        drag(canvas, at(196, 96), offset(196, 96, 100, 50));
        await waitFor(async () => expect(await nodeAfterDraw('1')).toMatchObject(near({ x: 0, y: 0, width: 300, height: 150 })));

        drag(canvas, at(296, 146), offset(296, 146, -1000, -1000));
        await waitFor(async () => {
            const node = await nodeAfterDraw('1');
            expect(node.width).toBe(100);
            expect(node.height).toBeLessThan(100);
            expect(node.height).toBeGreaterThan(0);
        });
        expect(screen.getByRole('button', { name: 'Reset Layout' })).toBeTruthy();
    });

    it('collapses and expands a node from its title dot', async () => {
        const { onSelectNode, canvas } = renderCanvas();

        click(canvas, at(15, -15));
        await waitFor(async () => expect((await nodeAfterDraw('1')).collapsed).toBe(true));
        click(canvas, at(15, -15));
        await waitFor(async () => expect((await nodeAfterDraw('1')).collapsed).toBe(false));
        expect(onSelectNode).not.toHaveBeenCalled();
    });

    it('moves a group with the nodes inside it, and resizes it from its corner', async () => {
        const { canvas } = renderCanvas();

        drag(canvas, at(300, -70), offset(300, -70, 100, 40));
        await waitFor(() => {
            const { graph } = lastDraw();
            expect(graph.groups[0]).toMatchObject(near({ x: 80, y: -40, width: 700, height: 240 }));
            expect(graph.nodeById.get('1')).toMatchObject(near({ x: 100, y: 40 }));
            expect(graph.nodeById.get('2')).toMatchObject(near({ x: 500, y: 40 }));
        });

        drag(canvas, at(776, 196), offset(776, 196, 50, 60));
        await waitFor(() => expect(lastDraw().graph.groups[0]).toMatchObject(near({ width: 750, height: 300 })));
    });

    it('builds a selection with Ctrl+click and drags all selected nodes together', async () => {
        const { onSelectNode, canvas } = renderCanvas();

        click(canvas, at(100, 50));
        click(canvas, at(500, 50), { ctrlKey: true });
        expect(onSelectNode).toHaveBeenLastCalledWith('2');
        await waitFor(() => expect([...lastDraw().options.selectedNodeIds].sort()).toEqual(['1', '2']));

        drag(canvas, at(100, 50), offset(100, 50, 30, 200));
        await waitFor(() => {
            const { graph } = lastDraw();
            expect(graph.nodeById.get('1')).toMatchObject(near({ x: 30, y: 200 }));
            expect(graph.nodeById.get('2')).toMatchObject(near({ x: 430, y: 200 }));
        });

        click(canvas, at(500, 250), { ctrlKey: true });
        await waitFor(() => expect([...lastDraw().options.selectedNodeIds]).toEqual(['1']));
        expect(onSelectNode).toHaveBeenLastCalledWith('1');
    });

    it('box-selects with Ctrl+drag on empty space and pans with a plain drag', async () => {
        const { onSelectNode, canvas } = renderCanvas();

        drag(canvas, at(-200, 300), at(450, -10), { ctrlKey: true });
        await waitFor(() => expect([...lastDraw().options.selectedNodeIds].sort()).toEqual(['1', '2']));
        expect(lastDraw().options.selectionRect ?? null).toBeNull();

        onSelectNode.mockClear();
        drag(canvas, at(-200, 300), at(-100, 400));
        expect(onSelectNode).not.toHaveBeenCalled();
        expect(screen.queryByRole('button', { name: 'Reset Layout' })).toBeNull();
    });


    it('renders widget values as selectable read-only text and leaves them off the canvas', async () => {
        const { onSelectNode } = renderCanvas();

        const field = await screen.findByRole('textbox', { name: 'ckpt_name' }) as HTMLInputElement;
        expect(field.value).toBe('sdxl_base_1.0.safetensors');
        expect(field.readOnly).toBe(true);
        field.select();
        expect(field.value.slice(field.selectionStart!, field.selectionEnd!)).toBe('sdxl_base_1.0.safetensors');
        await waitFor(() => expect([...(lastDraw().options.textWidgetNodeIds ?? [])]).toEqual(['1']));

        fireEvent.pointerDown(field, { pointerId: 99, button: 0 });
        expect(onSelectNode).toHaveBeenLastCalledWith('1');

        // Too small to read: the canvas draws the widgets and the text fields go away.
        for (let step = 0; step < 4; step += 1) fireEvent.click(screen.getByRole('button', { name: 'Zoom Out' }));
        await waitFor(() => expect(screen.queryByRole('textbox', { name: 'ckpt_name' })).toBeNull());
        await waitFor(() => expect(lastDraw().options.textWidgetNodeIds?.size ?? 0).toBe(0));
    });

    it('hides widget text of a node covered by another node', async () => {
        const { canvas } = renderCanvas();
        await screen.findByRole('textbox', { name: 'ckpt_name' });

        drag(canvas, at(500, 50), at(150, 60));
        await waitFor(() => expect(screen.queryByRole('textbox', { name: 'ckpt_name' })).toBeNull());
    });

    it('passes the implicit links of a selected Use Everywhere emitter to the renderer', async () => {
        const everywhere = parseWorkflowCanvasDocument(JSON.stringify({
            nodes: [
                { id: 1, type: 'CheckpointLoaderSimple', pos: [0, 0], size: [200, 100], outputs: [{ name: 'MODEL', type: 'MODEL', links: [1] }] },
                { id: 2, type: 'Anything Everywhere', pos: [250, 0], size: [150, 60], inputs: [{ name: 'anything', type: '*', link: 1 }] },
                { id: 3, type: 'KSampler', pos: [450, 0], size: [200, 100], inputs: [{ name: 'model', type: 'MODEL', link: null }] }
            ],
            links: [[1, 1, 0, 2, 0, 'MODEL']]
        }))!;
        const { rerender } = render(
            <WorkflowCanvas workflowDocument={everywhere} selectedNodeId="2" focusRequest={null} highlightedNodeIds={null} onSelectNode={vi.fn()} />
        );
        await waitFor(() => expect(lastDraw().options.broadcastLinks).toEqual([
            { emitterId: '2', emitterSlot: 0, targetId: '3', targetSlot: 0, type: 'MODEL' }
        ]));

        rerender(<WorkflowCanvas workflowDocument={everywhere} selectedNodeId="3" focusRequest={null} highlightedNodeIds={null} onSelectNode={vi.fn()} />);
        await waitFor(() => expect(lastDraw().options.broadcastLinks).toEqual([]));
    });
});
