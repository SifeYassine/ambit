import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GeneratorTool, type AIImage } from '../../../../types';
import { WorkflowInspector } from '../WorkflowInspector';
import type { WorkflowCanvasFocusRequest } from '../workflowCanvas/WorkflowCanvas';
import type { WorkflowCanvasDocument } from '../workflowCanvas/workflowCanvasModel';

const mockInspectComfyuiWorkflowGraph = vi.hoisted(() => vi.fn());

interface CapturedCanvasProps {
    workflowDocument: WorkflowCanvasDocument;
    selectedNodeId: string | null;
    focusRequest: WorkflowCanvasFocusRequest | null;
    highlightedNodeIds: ReadonlySet<string> | null;
    onSelectNode: (nodeId: string | null) => void;
}
const canvasCapture = vi.hoisted(() => ({ props: null as CapturedCanvasProps | null }));

vi.mock('../workflowCanvas/WorkflowCanvas', () => ({
    WorkflowCanvas: (props: CapturedCanvasProps) => {
        canvasCapture.props = props;
        return <div data-testid="workflow-canvas" />;
    }
}));

vi.mock('../../../../bindings', () => ({
    commands: {
        inspectComfyuiMetadataChunks: vi.fn(),
        inspectComfyuiWorkflowGraph: (...args: unknown[]) => mockInspectComfyuiWorkflowGraph(...args)
    }
}));

vi.mock('../../../../stores/settingsStore', () => ({
    useSettingsStore: (selector: (state: { settings: { devMode: boolean } }) => unknown) =>
        selector({ settings: { devMode: false } })
}));

vi.mock('../../../../services/metadataParser', () => ({ scanImageWorkflow: vi.fn() }));
vi.mock('../../../../services/db/imageRepo', () => ({
    updateImageWorkflow: vi.fn(),
    updateImageWorkflowHint: vi.fn()
}));

const workflowJson = JSON.stringify({
    nodes: [
        { id: 3, type: 'KSampler', pos: [400, 0], size: [300, 260], inputs: [{ name: 'model', type: 'MODEL', link: 1 }], outputs: [{ name: 'LATENT', type: 'LATENT', links: [] }], widgets_values: [7, 'fixed', 20, 6, 'euler', 'normal', 1] },
        { id: 4, type: 'CheckpointLoaderSimple', pos: [0, 0], size: [300, 100], outputs: [{ name: 'MODEL', type: 'MODEL', links: [1] }], widgets_values: ['model.safetensors'] }
    ],
    links: [[1, 4, 0, 3, 0, 'MODEL']]
});

const graphReport = {
    source: 'expanded_workflow',
    nodeCount: 2,
    nodes: [
        { id: '3', nodeType: 'KSampler', title: 'KSampler', inputs: { seed: '7', steps: '20' }, subgraphPath: [] },
        { id: '4', nodeType: 'CheckpointLoaderSimple', title: 'Load Checkpoint', inputs: { ckpt_name: 'model.safetensors' }, subgraphPath: [] }
    ],
    edges: [{ sourceNodeId: '4', sourceOutputSlot: 0, targetNodeId: '3', targetInputName: 'model', targetInputSlot: 0 }],
    selectedOutputNodeIds: [],
    rootSamplerNodeIds: [],
    selectedBranchNodeIds: [],
    outputAmbiguous: false
};

const image: AIImage = {
    id: 'comfy-image',
    url: 'asset://comfy.png',
    thumbnailUrl: 'asset://comfy-thumb.webp',
    filename: 'comfy.png',
    timestamp: 1,
    width: 512,
    height: 512,
    isFavorite: false,
    originalChunks: { workflow: workflowJson },
    metadata: {
        tool: GeneratorTool.COMFYUI,
        model: 'model',
        seed: 7,
        steps: 20,
        cfg: 6,
        sampler: 'euler',
        positivePrompt: '',
        negativePrompt: '',
        workflowJson
    }
};

describe('WorkflowInspector graph stage', () => {
    let stage: HTMLDivElement;

    beforeEach(() => {
        vi.clearAllMocks();
        canvasCapture.props = null;
        document.body.innerHTML = '';
        stage = document.createElement('div');
        document.body.appendChild(stage);
        mockInspectComfyuiWorkflowGraph.mockResolvedValue({ status: 'ok', data: graphReport });
        Element.prototype.scrollIntoView = vi.fn();
    });

    it('draws the saved workflow on the stage and shows the selected node instead of node cards', async () => {
        render(<WorkflowInspector image={image} graphStage={stage} />);

        await waitFor(() => expect(screen.getByText('Expanded Workflow')).toBeTruthy());
        expect(stage.querySelector('[data-testid="workflow-canvas"]')).toBeTruthy();
        const document = canvasCapture.props!.workflowDocument;
        expect(document.hasSavedLayout).toBe(true);
        expect([...document.root.nodeById.keys()]).toEqual(['3', '4']);
        expect(screen.queryByRole('button', { name: /Load Checkpoint/ })).toBeNull();
        expect(screen.getByText(/Click a node in the graph/)).toBeTruthy();

        act(() => canvasCapture.props!.onSelectNode('3'));
        expect(canvasCapture.props!.selectedNodeId).toBe('3');
        expect(screen.getByText('seed:')).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'Open incoming connected node Load Checkpoint (4)' }));
        expect(canvasCapture.props!.selectedNodeId).toBe('4');
        expect(canvasCapture.props!.focusRequest).toEqual({ nodeId: '4', requestId: 1 });
        expect(screen.getByText('ckpt_name:')).toBeTruthy();
    });

    it('keeps a node selected when the backend graph report arrives after the click', async () => {
        let resolveReport: (value: { status: 'ok'; data: typeof graphReport }) => void = () => undefined;
        mockInspectComfyuiWorkflowGraph.mockReturnValue(new Promise((resolve) => { resolveReport = resolve; }));
        render(<WorkflowInspector image={image} graphStage={stage} />);

        await waitFor(() => expect(canvasCapture.props).toBeTruthy());
        act(() => canvasCapture.props!.onSelectNode('3'));
        expect(canvasCapture.props!.selectedNodeId).toBe('3');

        await act(async () => resolveReport({ status: 'ok', data: graphReport }));
        await waitFor(() => expect(mockInspectComfyuiWorkflowGraph).toHaveBeenCalled());
        expect(canvasCapture.props!.selectedNodeId).toBe('3');
    });

    it('highlights search matches on the canvas and focuses a chosen result', async () => {
        render(<WorkflowInspector image={image} graphStage={stage} />);
        await waitFor(() => expect(screen.getByText('Expanded Workflow')).toBeTruthy());

        fireEvent.change(screen.getByPlaceholderText(/Search nodes/), { target: { value: 'checkpoint' } });
        expect([...canvasCapture.props!.highlightedNodeIds!]).toEqual(['4']);

        fireEvent.click(screen.getByRole('button', { name: 'Show node Load Checkpoint (4) in the graph' }));
        expect(canvasCapture.props!.highlightedNodeIds).toBeNull();
        expect(canvasCapture.props!.focusRequest?.nodeId).toBe('4');
    });

    it('shows an explanatory stage when the workflow cannot be drawn', () => {
        const noWorkflow: AIImage = {
            ...image,
            originalChunks: undefined,
            metadata: { ...image.metadata, workflowJson: undefined, hasWorkflowHint: false }
        };
        render(<WorkflowInspector image={noWorkflow} graphStage={stage} />);

        expect(canvasCapture.props).toBeNull();
        expect(stage.textContent).toContain('No workflow data was found for this image.');
    });
});
